# Spatial-RAG 三阶段架构重构实施方案

> 基于「架构设计融合版.md」和用户需求图，本文档是可直接执行的重构蓝图。

---

## 1. 当前架构 vs 目标架构对比

### 1.1 当前架构的问题

| 问题 | 具体表现 |
|------|----------|
| Token 爆炸 | 前端发送全量 `poiFeatures` 到后端，后端又将其传给 LLM |
| LLM 职责混乱 | LLM 既要解析意图，又要过滤数据，又要生成回答 |
| 数据库利用不足 | PostGIS 的聚合统计能力未充分利用 |
| Milvus 未限定候选集 | 语义搜索是在全量数据上进行，效率低 |
| 缺少图数据库 | 无法处理 POI 间关系推理（路径、连通性） |
| 缺少区域画像 | 没有预聚合的类别统计，每次都重新计算 |

### 1.2 目标架构（三库 + 三阶段）

```
┌─────────────────────────────────────────────────────────────────────┐
│                         数据层（三库）                               │
├─────────────────────────────────────────────────────────────────────┤
│  PostGIS          │  Milvus              │  图数据库 (Neo4j)        │
│  ─────────────    │  ──────────────      │  ──────────────────      │
│  pois (全字段)    │  poi_embeddings      │  POI-POI 关系            │
│  landmarks        │  id + embedding      │  POI-地标 关系           │
│  area_stats (预聚合)│  768 维向量          │  商圈/道路 关系          │
│  空间索引 + GeoHash│  HNSW/IVF_FLAT       │  路径规划                │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         处理层（三阶段）                             │
├─────────────────────────────────────────────────────────────────────┤
│  阶段1: Planner (LLM)                                               │
│  ────────────────────                                                │
│  输入: 用户问题 + 上下文（已选区域、可用类别）                       │
│  输出: 结构化 QueryPlan JSON                                         │
│  特点: 绝不看 POI 原始数据，只做意图解析                             │
├─────────────────────────────────────────────────────────────────────┤
│  阶段2: Executor (后端代码)                                          │
│  ────────────────────────                                            │
│  输入: QueryPlan JSON                                                │
│  执行:                                                               │
│   ├─ 锚点解析 (Geocoder/Landmarks)                                  │
│   ├─ 空间过滤 (PostGIS: ST_DWithin + 类别 + 评分)                   │
│   ├─ 语义精排 (Milvus: 在候选集中按语义偏好排序)                    │
│   ├─ 区域画像 (PostGIS: 预聚合或实时聚合统计)                       │
│   ├─ 代表地标 (PostGIS: 提取地铁站/学校/商圈)                       │
│   └─ 图推理 (Neo4j: 路径/连通性，可选)                              │
│  输出: 压缩后的结果 JSON (≤30 POI + 区域画像 + 地标)                 │
├─────────────────────────────────────────────────────────────────────┤
│  阶段3: Writer (LLM)                                                │
│  ─────────────────                                                   │
│  输入: 用户问题 + 压缩结果 JSON                                      │
│  输出: 自然语言回答（带真实地名、距离、区域画像描述）                 │
│  特点: Token 可控（通常 < 2000 tokens）                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 重构文件清单

### 2.1 需要新建的文件

| 文件路径 | 用途 |
|----------|------|
| `services/graph-database.js` | Neo4j 图数据库连接与查询服务 |
| `services/area-stats.js` | 区域画像统计服务（预聚合+实时） |
| `services/landmark-extractor.js` | 代表性地标提取服务 |
| `services/embedding.js` | Embedding 生成统一服务 |
| `routes/ai/planner.js` | 阶段1: Planner 模块 |
| `routes/ai/executor.js` | 阶段2: Executor 模块 |
| `routes/ai/writer.js` | 阶段3: Writer 模块 |
| `scripts/sql/area_stats_materialized.sql` | 区域画像预聚合视图 SQL |
| `scripts/sql/landmarks_with_score.sql` | 地标代表性打分 SQL |

### 2.2 需要重构的文件

| 文件路径 | 修改内容 |
|----------|----------|
| `routes/ai/index.js` | 重构为调用三阶段管道 |
| `routes/ai/spatial-rag-pipeline.js` | 完全重写，按三阶段拆分 |
| `services/database.js` | 新增区域统计、地标提取 SQL 函数 |
| `services/milvus.js` | 优化为仅在候选集上搜索 |

### 2.3 可保持不变的文件

- `services/geocoder.js` - 锚点解析逻辑完善，无需大改
- `services/ragLogger.js` - 日志服务保持
- `server.js` - 仅需添加图数据库初始化

---

## 3. 核心数据结构定义

### 3.1 QueryPlan JSON Schema

```typescript
interface QueryPlan {
  // 查询类型
  query_type: 'poi_search' | 'area_analysis' | 'distance_query' | 'recommendation' | 'path_query' | 'clarification_needed';
  
  // 锚点信息
  anchor: {
    type: 'landmark' | 'coordinate' | 'area' | 'unknown';
    name: string | null;       // 地名，如 "武汉理工大学"
    gate: string | null;       // 门/入口，如 "南门"
    direction: string | null;  // 方向，如 "对面"、"东"
    lat: number | null;
    lon: number | null;
  };
  
  // 空间约束
  radius_m: number | null;     // 搜索半径，默认 1000m
  
  // 内容过滤
  categories: string[];        // 目标类别，如 ["咖啡馆", "蛋糕店"]
  rating_range: [number | null, number | null];  // 评分范围 [min, max]
  
  // 语义偏好
  semantic_query: string;      // 语义关键词，如 "环境安静 适合自习"
  
  // 结果控制
  max_results: number;         // 最大返回数量，默认 20
  sort_by: 'distance' | 'rating' | 'relevance' | null;
  
  // 模式开关
  need_global_context: boolean;    // 是否需要区域画像
  need_landmarks: boolean;          // 是否需要提取代表性地标
  need_graph_reasoning: boolean;    // 是否需要图推理（路径/连通性）
  
  // 澄清问题（query_type 为 clarification_needed 时使用）
  clarification_question: string | null;
}
```

### 3.2 Executor 输出 JSON Schema

```typescript
interface ExecutorResult {
  mode: 'basic' | 'global_context' | 'graph';
  
  // 锚点信息
  anchor: {
    name: string;
    lon: number;
    lat: number;
    resolved_from: 'poi' | 'landmarks' | 'geocoder';
  } | null;
  
  // POI 列表（压缩后，最多 30 条）
  pois: Array<{
    id: number;
    name: string;
    category: string;      // 小类或中类
    rating: number | null;
    distance_m: number;
    tags: string[];        // 从语义字段提取的标签
  }>;
  
  // 区域画像（need_global_context=true 时填充）
  area_profile: {
    total_count: number;
    dominant_categories: Array<{
      category: string;
      count: number;
      percentage: number;
      examples: string[];   // 代表性 POI 名称
    }>;
    rare_categories: Array<{
      category: string;
      count: number;
    }>;
  } | null;
  
  // 代表性地标（need_landmarks=true 时填充）
  landmarks: Array<{
    name: string;
    type: string;   // 地铁站/学校/商圈
    distance_m: number;
    relevance_score: number;  // 代表性打分
  }>;
  
  // 图推理结果（need_graph_reasoning=true 时填充）
  graph_result: {
    paths: Array<{
      from: string;
      to: string;
      hops: number;
      path_description: string;
    }>;
  } | null;
  
  // 统计信息
  stats: {
    total_candidates: number;
    filtered_count: number;
    semantic_rerank_applied: boolean;
    execution_time_ms: number;
  };
}
```

---

## 4. 各模块详细设计

### 4.1 阶段1: Planner 模块

**文件**: `routes/ai/planner.js`

**System Prompt**:

```text
你是一个"空间查询规划器"，职责是把用户的问题转换为结构化查询计划 JSON。

## 严格规则
1. 只输出 JSON，不要任何解释或 Markdown 标记
2. 分析用户问题中的：
   - 锚点信息（地名、地标、门，如"武汉理工大学南门"）
   - 距离条件（半径/步行时间，统一转成米）
   - 类别（如咖啡馆、蛋糕店、餐饮、教育等）
   - 评分/价格等数值条件
   - 语义偏好（如"环境安静"、"适合学习"）
   - 是否需要区域画像（如"这附近以什么为主？"）
   - 是否涉及路径/连通性（如"从A到B经过哪些"）

## 默认值
- 半径未指定但说"附近"：默认 1000 米
- 评分未指定：不限制
- 最大结果数：20

## 上下文信息
{context}
```

**核心逻辑**:

```javascript
export async function parseIntent(userQuestion, context = {}) {
  // 1. 构建上下文提示
  const contextStr = buildContextString(context);
  
  // 2. 调用 LLM
  const response = await callLLM({
    systemPrompt: PLANNER_SYSTEM_PROMPT.replace('{context}', contextStr),
    userMessage: userQuestion,
    temperature: 0.1,  // 低温度保证输出稳定
    maxTokens: 500
  });
  
  // 3. 解析 JSON
  const queryPlan = parseQueryPlanJSON(response);
  
  // 4. 验证和补全默认值
  return validateAndNormalize(queryPlan);
}
```

### 4.2 阶段2: Executor 模块

**文件**: `routes/ai/executor.js`

**核心路由逻辑**:

```javascript
export async function executeQuery(queryPlan) {
  const startTime = Date.now();
  
  // 根据 QueryPlan 决定执行路径
  if (queryPlan.need_graph_reasoning) {
    return await execGraphMode(queryPlan);
  } else if (queryPlan.need_global_context) {
    return await execGlobalContextMode(queryPlan);
  } else {
    return await execBasicMode(queryPlan);
  }
}
```

**Basic 模式**（80% 场景）:

```javascript
async function execBasicMode(plan) {
  // 1. 锚点解析
  const anchor = await resolveAnchor(plan.anchor);
  
  // 2. PostGIS 空间+类别+评分过滤（限制候选 ≤200）
  const candidates = await db.findPOIsFiltered({
    anchor,
    radius_m: plan.radius_m,
    categories: plan.categories,
    rating_range: plan.rating_range,
    limit: 200
  });
  
  // 3. Milvus 语义精排（若有 semantic_query）
  let ranked = candidates;
  if (plan.semantic_query && milvus.isAvailable()) {
    const candidateIds = candidates.map(p => p.id);
    ranked = await milvus.semanticRank(
      plan.semantic_query, 
      candidateIds, 
      plan.max_results
    );
  } else {
    ranked = candidates.slice(0, plan.max_results);
  }
  
  // 4. 压缩结果（只保留必要字段）
  return {
    mode: 'basic',
    anchor,
    pois: compressPOIs(ranked),
    area_profile: null,
    landmarks: [],
    stats: { ... }
  };
}
```

**Global Context 模式**:

```javascript
async function execGlobalContextMode(plan) {
  const anchor = await resolveAnchor(plan.anchor);
  
  // 1. 区域画像统计（SQL 聚合）
  const areaProfile = await db.getCategoryStats(anchor, plan.radius_m);
  
  // 2. 提取代表性地标
  const landmarks = await db.getRepresentativeLandmarks(anchor, plan.radius_m);
  
  // 3. 同时获取 TopK POI
  const pois = await execBasicMode(plan);
  
  return {
    mode: 'global_context',
    anchor,
    pois: pois.pois,
    area_profile: areaProfile,
    landmarks,
    stats: { ... }
  };
}
```

### 4.3 阶段3: Writer 模块

**文件**: `routes/ai/writer.js`

**System Prompt**:

```text
你是「标签云 AI 助手」，一个专业的地理信息分析专家。

## 规则
1. 只根据提供的数据回答，不要虚构地名或店名
2. 使用 Markdown 表格展示 POI 列表
3. 如有区域画像，先描述区域整体特征
4. 如有代表性地标，可以用来辅助定位描述

## 当前数据
{result_context}
```

**核心逻辑**:

```javascript
export async function* generateAnswer(userQuestion, executorResult) {
  // 1. 构建精简上下文
  const resultContext = buildResultContext(executorResult);
  
  // 2. 流式调用 LLM
  yield* callLLMStream({
    systemPrompt: WRITER_SYSTEM_PROMPT.replace('{result_context}', resultContext),
    userMessage: userQuestion,
    temperature: 0.7,
    maxTokens: 1500
  });
}
```

---

## 5. 数据库增强 SQL

### 5.1 区域类别统计函数

```sql
CREATE OR REPLACE FUNCTION get_category_stats(
  center_lon FLOAT, 
  center_lat FLOAT, 
  radius_m FLOAT
) RETURNS TABLE(
  category TEXT,
  cnt BIGINT,
  avg_rating FLOAT,
  percentage FLOAT,
  example_names TEXT[]
) AS $$
WITH area AS (
  SELECT ST_SetSRID(ST_MakePoint(center_lon, center_lat), 4326)::geography AS g
),
filtered AS (
  SELECT 
    p.category_big AS category,
    p.name,
    p.rating
  FROM pois p, area a
  WHERE ST_DWithin(p.geom::geography, a.g, radius_m)
),
stats AS (
  SELECT 
    category,
    COUNT(*) AS cnt,
    AVG(rating) AS avg_rating,
    array_agg(name ORDER BY rating DESC NULLS LAST) FILTER (WHERE name IS NOT NULL) AS names
  FROM filtered
  GROUP BY category
),
total AS (
  SELECT SUM(cnt) AS total_count FROM stats
)
SELECT 
  s.category,
  s.cnt,
  s.avg_rating,
  ROUND((s.cnt::FLOAT / t.total_count * 100)::NUMERIC, 1) AS percentage,
  s.names[1:2] AS example_names
FROM stats s, total t
ORDER BY s.cnt DESC;
$$ LANGUAGE sql;
```

### 5.2 代表性地标提取函数

```sql
CREATE OR REPLACE FUNCTION get_representative_landmarks(
  center_lon FLOAT,
  center_lat FLOAT,
  radius_m FLOAT,
  top_k INT DEFAULT 5
) RETURNS TABLE(
  name TEXT,
  type TEXT,
  distance_m FLOAT,
  relevance_score FLOAT
) AS $$
WITH area AS (
  SELECT ST_SetSRID(ST_MakePoint(center_lon, center_lat), 4326)::geography AS g
),
landmark_categories AS (
  SELECT unnest(ARRAY['地铁站', '学校', '大学', '医院', '商场', '广场', '公园']) AS lc
),
candidates AS (
  SELECT 
    p.name,
    COALESCE(p.category_mid, p.category_big) AS type,
    ST_Distance(p.geom::geography, a.g) AS distance_m,
    -- 代表性打分：类别权重 + 距离衰减
    CASE 
      WHEN p.category_mid ILIKE '%地铁%' THEN 10
      WHEN p.category_mid ILIKE '%学校%' OR p.category_mid ILIKE '%大学%' THEN 8
      WHEN p.category_mid ILIKE '%医院%' THEN 7
      WHEN p.category_mid ILIKE '%商场%' OR p.category_mid ILIKE '%购物%' THEN 6
      ELSE 1
    END * (1 - ST_Distance(p.geom::geography, a.g) / radius_m) AS relevance_score
  FROM pois p, area a, landmark_categories lc
  WHERE ST_DWithin(p.geom::geography, a.g, radius_m)
    AND (p.category_mid ILIKE '%' || lc.lc || '%' OR p.category_big ILIKE '%' || lc.lc || '%')
)
SELECT DISTINCT ON (type) 
  name, type, distance_m, relevance_score
FROM candidates
ORDER BY type, relevance_score DESC
LIMIT top_k;
$$ LANGUAGE sql;
```

---

## 6. Token 控制策略

| 策略 | 实现方式 |
|------|----------|
| POI 数量限制 | Executor 最多返回 30 条 POI |
| 字段裁剪 | 只传 name, category, rating, distance_m, tags |
| 统计下沉 | 区域画像在 SQL 中完成，不逐条传 |
| 地标精选 | 每类最多 1-2 个代表性地标 |
| 预期 Token | Planner < 500, Writer < 2000 |

---

## 7. 实施步骤（优先级排序）

### Phase 1: 核心管道重构（1-2 天）

- [ ] 创建 `planner.js` - Planner 模块
- [ ] 创建 `executor.js` - Executor 模块
- [ ] 创建 `writer.js` - Writer 模块
- [ ] 重构 `spatial-rag-pipeline.js` 为管道协调器
- [ ] 更新 `index.js` 调用新管道

### Phase 2: 数据库增强（1 天）

- [ ] 添加 `get_category_stats` SQL 函数
- [ ] 添加 `get_representative_landmarks` SQL 函数
- [ ] 优化 `database.js` 增加新查询方法

### Phase 3: Milvus 优化（0.5 天）

- [ ] 确保 `semanticSearch` 支持候选集过滤
- [ ] 添加 `semanticRank` 方法用于精排

### Phase 4: 图数据库集成（可选，2 天）

- [ ] 创建 `graph-database.js` 服务
- [ ] 在 Executor 中添加图推理路径
- [ ] 添加路径查询和连通性分析

### Phase 5: 测试与优化（1 天）

- [ ] 端到端测试各场景
- [ ] Token 消耗监控
- [ ] 性能优化

---

## 8. 典型请求流转示例

**用户问题**: "武理工南门对面500m内有哪些评分高于4.5分、环境安静适合自习的咖啡馆？"

### Stage 1 输出 (Planner)

```json
{
  "query_type": "poi_search",
  "anchor": {
    "type": "landmark",
    "name": "武汉理工大学",
    "gate": "南门",
    "direction": "对面"
  },
  "radius_m": 500,
  "categories": ["咖啡馆"],
  "rating_range": [4.5, null],
  "semantic_query": "环境安静 适合自习",
  "need_global_context": true,
  "need_landmarks": true,
  "max_results": 10
}
```

### Stage 2 输出 (Executor)

```json
{
  "mode": "global_context",
  "anchor": {
    "name": "武汉理工大学南门",
    "lon": 114.3456,
    "lat": 30.5678
  },
  "pois": [
    {"id": 101, "name": "星巴克咖啡", "category": "咖啡馆", "rating": 4.7, "distance_m": 120, "tags": ["安静", "适合自习"]},
    {"id": 102, "name": "瑞幸咖啡", "category": "咖啡馆", "rating": 4.6, "distance_m": 230, "tags": ["便捷"]}
  ],
  "area_profile": {
    "total_count": 140,
    "dominant_categories": [
      {"category": "餐饮", "count": 134, "percentage": 95.7, "examples": ["张记烧烤"]},
      {"category": "咖啡馆", "count": 5, "percentage": 3.6, "examples": ["星巴克"]}
    ]
  },
  "landmarks": [
    {"name": "青鱼嘴地铁站", "type": "地铁站", "distance_m": 300}
  ]
}
```

### Stage 3 输出 (Writer)
>
> 武汉理工大学南门 500 米范围内，符合"环境安静、适合自习，评分高于 4.5 分"的咖啡馆主要有：
>
> | 名称 | 类别 | 距离 | 评分 |
> |------|------|------|------|
> | 星巴克咖啡 | 咖啡馆 | 120m | 4.7 |
> | 瑞幸咖啡 | 咖啡馆 | 230m | 4.6 |
>
> 从整体来看，该区域以餐饮类为主（约 134 家，占 95.7%），咖啡馆数量不多但评分整体较高。附近有青鱼嘴地铁站（约 300m），交通便利。

---

**文档版本**: v1.0  
**创建时间**: 2026-01-13  
**状态**: 待实施
