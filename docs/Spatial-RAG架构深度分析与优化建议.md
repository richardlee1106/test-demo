# Spatial RAG 架构深度分析与优化建议

> 文档版本: v1.1  
> 分析日期: 2026-01-25  
> 目标: 提升"地理感知 QA + LLM"模式的最终输出精度
>
> ## 🎉 Phase 1 已实施完成 (2026-01-25)
>
> 已完成以下优化：
>
> - ✅ Planner 置信度评分 + 澄清问题机制  
> - ✅ 类别本体模块 (`categoryOntology.js`)
> - ✅ Writer 幻觉检测 (`detectHallucinations`)
> - ✅ 动态 H3 分辨率选择 (`selectH3Resolution`)

---

## 目录

1. [当前架构回顾](#1-当前架构回顾)
2. [核心不足分析](#2-核心不足分析)
3. [精度优化建议](#3-精度优化建议)
4. [实施优先级与路线图](#4-实施优先级与路线图)

---

## 1. 当前架构回顾

```
┌─────────────────────────────────────────────────────────────────┐
│                    三阶段 Spatial RAG Pipeline                   │
├─────────────────────────────────────────────────────────────────┤
│  Stage 1: Planner (LLM)                                         │
│    用户问题 → 意图解析 → QueryPlan JSON                          │
│    输出: query_type, categories, anchor, radius, semantic_query │
├─────────────────────────────────────────────────────────────────┤
│  Stage 2: Executor (后端)                                       │
│    QueryPlan → PostGIS + pgvector + H3 → 压缩结果               │
│    输出: pois[], area_profile, landmarks[], graph_analysis      │
├─────────────────────────────────────────────────────────────────┤
│  Stage 3: Writer (LLM)                                          │
│    压缩结果 → 自然语言回答                                       │
│    输出: Markdown 格式的分析报告                                 │
└─────────────────────────────────────────────────────────────────┘
```

**当前技术栈:**

- 空间索引: PostGIS (R-Tree) + H3 网格
- 语义索引: pgvector (HNSW)
- 图推理: 内存 H3 拓扑图 (刚实现)
- LLM: 本地 Qwen3-4B / 云端 GLM

---

## 2. 核心不足分析

### 2.1 🔴 Planner 层: 意图解析精度不足

| 问题 | 影响 | 严重程度 |
|------|------|----------|
| **默认偏向宏观** | `QUERY_PLAN_DEFAULTS.query_type = 'area_analysis'`，LLM 输出不完整时回落到宏观模式，微观查询被误杀 | ⭐⭐⭐⭐ |
| **无置信度机制** | 一拍定生死，不会说"我不确定"，混合意图问题被强行归类 | ⭐⭐⭐⭐ |
| **类别映射硬编码** | `inferCategoriesFromQuestion` 依赖关键词表，无法处理长尾表达（如"解闷的地方"→?） | ⭐⭐⭐ |
| **空间表达解析弱** | 无法准确解析"A和B之间"、"沿着X路"、"城东"等复杂空间描述 | ⭐⭐⭐ |
| **多轮上下文缺失** | 每次请求独立处理，无法理解"那附近还有什么"中的"那" | ⭐⭐⭐ |

**示例:**

```
用户: "分析一下武汉理工附近这片区域的餐饮结构"
↓
Planner 困惑: 是宏观(分析结构)还是微观(附近餐饮)?
↓
硬选 area_analysis → 可能返回过于泛化的结果
```

---

### 2.2 🟡 Executor 层: 检索精度与覆盖率

| 问题 | 影响 | 严重程度 |
|------|------|----------|
| **语义检索利用率低** | `semanticRerank` 只在候选集非空时触发，且依赖 embedding 质量 | ⭐⭐⭐ |
| **空间-语义融合简单** | 当前是串行的 `Filter → Rerank`，而非真正的混合检索 | ⭐⭐⭐⭐ |
| **类别匹配过于宽松** | `ILIKE '%关键词%'` 模糊匹配导致噪音（如搜"咖啡"命中"咖啡色家具店"）| ⭐⭐⭐ |
| **无时序/营业状态过滤** | 用户问"现在开门的"无法处理 | ⭐⭐ |
| **代表点选择规则硬编码** | 黑名单/白名单方式难以泛化到新业态 | ⭐⭐ |
| **H3 分辨率固定** | 不同问题适合不同粒度，当前统一 Res 9 | ⭐⭐ |

**关键代码问题:**

```javascript
// database.js:630-645
// 类别过滤使用 ILIKE，精度不高
sql += ` AND (${categoryConditions.join(' OR ')})`
categories.forEach(cat => params.push(`%${cat}%`)) // 模糊匹配
```

```javascript
// executor.js 语义精排只在候选非空时触发
if (plan.semantic_query && vectordb.isVectorDBAvailable() && candidates.length > 0) {
  ranked = await semanticRerank(candidates, plan.semantic_query, ...)
}
// 问题: 如果空间检索为空，语义能力完全失效
```

---

### 2.3 🟡 Writer 层: 生成质量与可控性

| 问题 | 影响 | 严重程度 |
|------|------|----------|
| **幻觉风险** | LLM 可能编造数据中没有的 POI 或距离数值 | ⭐⭐⭐⭐ |
| **格式不稳定** | 有时输出 Markdown 表格，有时纯文本，难以前端解析 | ⭐⭐⭐ |
| **上下文截断** | 如果 POI 太多，`buildResultContext` 只取前 15 条，信息损失 | ⭐⭐ |
| **无 Grounding 机制** | 回答中的数据点无法追溯到具体来源 | ⭐⭐⭐ |
| **专业术语缺乏** | 地理分析应包含更多 GIS 专业表达（如密度梯度、服务半径覆盖率） | ⭐⭐ |

---

### 2.4 🟠 系统层: 架构与数据

| 问题 | 影响 | 严重程度 |
|------|------|----------|
| **POI 数据质量** | 缺少评分、营业时间、价格等级等属性，限制了分析维度 | ⭐⭐⭐⭐ |
| **无路网数据** | 图推理基于 H3 邻接而非真实路网，可达性分析不准确 | ⭐⭐⭐ |
| **Embedding 模型单一** | 仅基于名称生成 embedding，未考虑描述、评论等富文本 | ⭐⭐⭐ |
| **无反馈闭环** | 用户对结果的满意度无法反馈给系统优化 | ⭐⭐⭐ |
| **缓存策略缺失** | 相似查询重复计算，响应时间波动大 | ⭐⭐ |

---

## 3. 精度优化建议

### 3.1 🚀 Planner 层优化

#### 3.1.1 引入置信度评分 + 澄清机制

```javascript
// planner.js 建议新增
function calculatePlanConfidence(plan) {
  let score = 0
  if (plan.query_type && plan.query_type !== QUERY_PLAN_DEFAULTS.query_type) score += 2
  if (plan.intent_mode) score += 2
  if (plan.anchor?.name && plan.anchor.type !== 'unknown') score += 2
  if (plan.categories?.length > 0) score += 1
  if (plan.semantic_query) score += 1
  return score // 0-8
}

// 在 validateAndNormalize 中:
if (confidence < 4 && !plan.clarification_question) {
  return {
    query_type: 'clarification_needed',
    clarification_question: generateClarificationQuestion(plan, userQuestion)
  }
}
```

#### 3.1.2 LLM 意图链式推理 (Chain-of-Thought)

```javascript
// 改进 System Prompt，要求 LLM 先输出推理过程
const PLANNER_SYSTEM_PROMPT_V2 = `
你是空间查询规划器。请按以下步骤分析用户问题：

## Step 1: 实体提取
- 地名: ?
- 类别: ?
- 属性约束: ?

## Step 2: 意图分类
- 核心意图: [poi_search | area_analysis | comparison | ...]
- 置信度: [high | medium | low]
- 若 low，生成澄清问题

## Step 3: 空间约束
- 锚点类型: [name | coordinate | current_view]
- 搜索范围: ?m

请以 JSON 格式输出最终 QueryPlan。
`
```

#### 3.1.3 多轮对话上下文管理

```javascript
// 新增 ConversationContext 管理器
class SpatialConversationContext {
  constructor() {
    this.history = []
    this.lastMentionedLocation = null
    this.lastMentionedPOIs = []
  }
  
  resolvePronouns(question) {
    // "那附近" → 替换为上次提到的位置
    // "它们" → 替换为上次返回的 POI 列表
  }
}
```

---

### 3.2 🚀 Executor 层优化

#### 3.2.1 真正的混合检索 (Hybrid Search)

**当前模式（串行）:**

```
空间过滤 → 候选集 → 语义精排
```

**优化模式（并行融合）:**

```sql
-- 混合检索 SQL 示例
WITH spatial_candidates AS (
  SELECT id, name, geom, embedding,
         1 - (ST_Distance(geom::geography, $anchor) / $radius) AS spatial_score
  FROM pois
  WHERE ST_DWithin(geom::geography, $anchor, $radius)
),
semantic_candidates AS (
  SELECT poi_id, 1 - (embedding <=> $query_vector) AS semantic_score
  FROM poi_embeddings
  ORDER BY embedding <=> $query_vector
  LIMIT 200
)
SELECT s.*, sem.semantic_score,
       0.4 * s.spatial_score + 0.6 * COALESCE(sem.semantic_score, 0) AS hybrid_score
FROM spatial_candidates s
LEFT JOIN semantic_candidates sem ON s.id = sem.poi_id
ORDER BY hybrid_score DESC
LIMIT 50;
```

**关键改进:**

- 语义检索独立执行，不依赖空间结果
- 加权融合公式可根据 query_type 动态调整

#### 3.2.2 类别匹配精确化

```javascript
// 引入类别本体（Category Ontology）
const CATEGORY_ONTOLOGY = {
  '餐饮': {
    children: ['中餐', '西餐', '日料', '快餐', '咖啡', '奶茶'],
    synonyms: ['吃的', '美食', '餐厅', '饭店'],
    exclude: ['食品加工', '餐具']
  },
  // ...
}

// 精确匹配：先规范化用户输入
function normalizeCategoryQuery(userInput) {
  for (const [std, def] of Object.entries(CATEGORY_ONTOLOGY)) {
    if (def.synonyms.includes(userInput)) return std
    if (def.children.includes(userInput)) return userInput
  }
  return userInput // fallback
}
```

#### 3.2.3 空间语义联合索引

```sql
-- 创建联合索引加速混合检索
CREATE INDEX idx_pois_geom_embedding ON pois 
USING gist (geom, embedding vector_cosine_ops);

-- 或者使用 PGVector 的 IVFFlat 与 PostGIS 分区表结合
```

#### 3.2.4 动态 H3 分辨率

```javascript
function selectH3Resolution(queryPlan) {
  if (queryPlan.radius_m > 5000) return 7  // 城市级 (~1.2km 边长)
  if (queryPlan.radius_m > 2000) return 8  // 片区级 (~460m)
  if (queryPlan.radius_m > 500) return 9   // 社区级 (~174m)
  return 10 // 街区级 (~66m)
}
```

---

### 3.3 🚀 Writer 层优化

#### 3.3.1 Grounded Generation (可溯源生成)

```javascript
// 在 buildResultContext 中为每个数据点添加 ID
function buildResultContext(executorResult) {
  // ...
  displayPOIs.forEach((poi, i) => {
    poiText += `${i + 1}. **${poi.name}** [ID:${poi.id}] [${poi.category}]\n`
  })
  // ...
}

// Writer Prompt 要求引用 ID
const WRITER_SYSTEM_PROMPT_V2 = `
...
在回答中引用 POI 时，必须使用格式 [ID:xxx]，便于用户追溯。
例如：推荐「光谷广场」[ID:12345]，距离约 500m。
`
```

#### 3.3.2 结构化输出约束

```javascript
// 使用 JSON Mode 或 Function Calling 强制格式
const response = await fetch(`${baseUrl}/chat/completions`, {
  body: JSON.stringify({
    model,
    messages: [...],
    response_format: { 
      type: "json_schema",
      json_schema: {
        name: "spatial_analysis",
        schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            key_findings: { type: "array", items: { type: "string" } },
            recommended_pois: { type: "array", items: { ... } },
            confidence: { type: "number" }
          }
        }
      }
    }
  })
})
```

#### 3.3.3 幻觉检测与过滤

```javascript
// 后处理：检查 Writer 输出是否引用了不存在的 POI
function validateWriterOutput(writerText, executorResult) {
  const mentionedPOIs = extractMentionedPOIs(writerText)
  const validPOIs = new Set(executorResult.results.pois.map(p => p.name))
  
  const hallucinations = mentionedPOIs.filter(p => !validPOIs.has(p))
  if (hallucinations.length > 0) {
    console.warn('[Writer] 检测到幻觉:', hallucinations)
    // 自动移除或标记
  }
}
```

---

### 3.4 🚀 系统层优化

#### 3.4.1 POI 数据增强

```sql
-- 扩展 POI 表结构
ALTER TABLE pois ADD COLUMN rating FLOAT;
ALTER TABLE pois ADD COLUMN price_level INT; -- 1-4
ALTER TABLE pois ADD COLUMN opening_hours JSONB;
ALTER TABLE pois ADD COLUMN tags TEXT[];
ALTER TABLE pois ADD COLUMN enriched_desc TEXT; -- LLM 生成的语义描述

-- 更新 embedding 生成逻辑
-- 从 name → name + category + enriched_desc
```

#### 3.4.2 路网数据集成

```sql
-- 导入 OSM 路网
CREATE TABLE road_network (
  id SERIAL PRIMARY KEY,
  osm_id BIGINT,
  name VARCHAR(255),
  road_type VARCHAR(50), -- primary, secondary, residential, ...
  geom GEOMETRY(LINESTRING, 4326)
);

CREATE INDEX idx_road_network_geom ON road_network USING GIST (geom);

-- 构建路网可达性图
-- 可使用 pgRouting 扩展
```

#### 3.4.3 查询结果缓存

```javascript
// 引入查询指纹 + Redis 缓存
import { createHash } from 'crypto'

function getQueryFingerprint(queryPlan, spatialContext) {
  const data = JSON.stringify({
    type: queryPlan.query_type,
    categories: queryPlan.categories.sort(),
    h3_center: h3.latLngToCell(spatialContext.center.lat, spatialContext.center.lon, 7),
    radius_bucket: Math.ceil(queryPlan.radius_m / 500) * 500
  })
  return createHash('md5').update(data).digest('hex')
}

// 缓存 Executor 结果 (TTL: 5min)
// 缓存 area_profile (TTL: 1h)
```

#### 3.4.4 用户反馈闭环

```javascript
// 收集隐式反馈
// 1. 用户是否点击了推荐的 POI
// 2. 用户是否继续追问（表示不满意）
// 3. 用户是否在地图上导航到推荐点

// 收集显式反馈
// 1. 回答底部添加 👍👎 按钮
// 2. 定期分析低评分查询，优化 Planner/Executor 规则
```

---

## 4. 实施优先级与路线图

### Phase 1: 快速见效 (1-2 周)

| 优化项 | 预期收益 | 实施复杂度 |
|--------|----------|------------|
| Planner 置信度 + 澄清 | 减少误解析 30%+ | 低 |
| 类别本体 + 精确匹配 | 减少噪音结果 | 低 |
| Writer 幻觉检测 | 提升可信度 | 低 |
| 动态 H3 分辨率 | 提升分析粒度适配 | 低 |

### Phase 2: 核心能力 (2-4 周)

| 优化项 | 预期收益 | 实施复杂度 |
|--------|----------|------------|
| 混合检索 (Hybrid Search) | 显著提升检索精度 | 中 |
| Grounded Generation | 提升可追溯性 | 中 |
| 多轮对话上下文 | 提升交互体验 | 中 |
| 查询缓存 | 降低延迟 50%+ | 中 |

### Phase 3: 深度增强 (1-2 月)

| 优化项 | 预期收益 | 实施复杂度 |
|--------|----------|------------|
| POI 数据增强 (评分/营业时间) | 扩展分析维度 | 高 |
| 路网集成 (pgRouting) | 真实可达性分析 | 高 |
| Embedding 多模态增强 | 语义理解能力 | 高 |
| 用户反馈闭环 | 持续优化 | 中 |

---

## 5. 核心指标建议

为了量化优化效果，建议跟踪以下指标：

| 指标 | 定义 | 目标值 |
|------|------|--------|
| **意图解析准确率** | 人工标注 100 条查询，Planner 正确率 | >90% |
| **检索召回率@20** | Top 20 结果中相关 POI 占比 | >80% |
| **幻觉率** | Writer 输出中不存在于数据的 POI 占比 | <5% |
| **用户满意度** | 显式反馈 👍 占比 | >85% |
| **平均响应时间** | P95 端到端延迟 | <3s |

---

## 6. 总结

当前 Spatial RAG 架构的核心问题可以归纳为：

1. **Planner 层**：意图解析"一刀切"，缺乏不确定性处理
2. **Executor 层**：空间和语义检索割裂，融合策略简单
3. **Writer 层**：生成过程缺乏约束，可信度/可追溯性不足
4. **数据层**：POI 属性不够丰富，限制了分析维度

**最高优先级建议:**

1. ✅ 为 Planner 增加置信度评分 + 澄清问题机制
2. ✅ 实现真正的混合检索 (Hybrid Search)
3. ✅ 引入 Grounded Generation 保证可追溯性

这些改进将使系统从"能用"进化到"好用"，显著提升地理 QA 的精度和用户体验。
