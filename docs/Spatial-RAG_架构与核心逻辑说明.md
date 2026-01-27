# Spatial-RAG 系统架构深度与技术实现详解

本文档旨在提供 TagCloud Spatial-RAG 系统的**原子级技术实现细节**。不仅仅描述“做了什么”，而是深入“如何实现”以及“为什么这样实现”，供技术架构评审与深度研讨使用。

---

## 1. 核心范式：空间-语义双重索引 (Dual-Index Paradigm)

本系统的核心技术壁垒在于如何在一个查询上下文中，同时处理**欧氏几何空间（Euclidean Space）**与**高维语义空间（Embedding Space）**。

### 1.1 理论模型

我们将每个地理实体（POI）建模为 tuple $P = (G, V, M)$：

* $G$ (Geometry): 物理坐标 `All Points / Polygons`。
* $V$ (Vector): 语义向量 $v \in \mathbb{R}^{1024}$ (使用 `bge-m3` 模型)。
* $M$ (Metadata): 结构化属性（评分、类别、营业时间）。

传统 GIS 查询是 $f(G, M)$，而 Spatial-RAG 的查询是 $f(G, V, M)$，寻找满足条件 $C$ 的集合：
$$ \{ P \mid \text{Spatial}(P.G, \text{User}.Loc) < \delta \land \text{Sim}(P.V, \text{Query}.V) > \theta \} $$

---

## 2. 数据层深度实现 (Data Layer Implementation)

我们选择 **PostgreSQL** 作为单一事实来源（Single Source of Truth），利用其插件生态构建混合引擎。

### 2.1 数据库 Schema 设计

为了支持高性能混合检索，我们设计了精简而高效的表结构。

```sql
-- 核心 POI 表
CREATE TABLE pois (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    category VARCHAR(100),
    
    -- [技术点1] 空间数据列：使用 SRID 4326 (WGS84) 存储经纬度
    geom GEOMETRY(POINT, 4326),
    
    -- [技术点2] 语义向量列：1024维 (对应 BGE-M3 模型维度)
    embedding VECTOR(1024),
    
    -- [技术点3] 扩展属性：JSONB 存储非结构化数据 (LLM生成的标签、描述)
    -- 这允许我们在不改 Schema 情况下灵活增加 LLM 分析出的新字段
    properties JSONB DEFAULT '{}'::jsonb
);

-- [技术点4] 混合索引策略
-- 空间索引：R-Tree (GIST) -> O(log N) 级物理范围过滤
CREATE INDEX idx_pois_geom ON pois USING GIST (geom);

-- 向量索引：HNSW (Hierarchical Navigable Small World)
-- ef_construction=64: 平衡构建速度与召回率
-- vector_cosine_ops: 使用余弦相似度作为距离度量
CREATE INDEX idx_pois_embedding ON pois USING hnsw (embedding vector_cosine_ops) 
WITH (m = 16, ef_construction = 64);
```

### 2.2 语义增强流水线 (Semantic Enrichment Pipeline)

原始 POI 数据通常只有“名称”和“类别”，信息熵极低。我们引入了一个离线增强步骤：

1. **Prompt构造**:
    > "你是一个城市观察家。对于地点 '{pois.name}' (类别: {pois.category})，请推断其环境氛围、适合人群、潜在的活动场景（如约会、独处、亲子）。请生成一段 200 字以内的描述。"
2. **LLM 推理**: 本地 Qwen-14B 模型生成富文本 `enriched_text`。
3. **Embedding**: 使用 `BAAI/bge-m3` 将 `enriched_text` 转为向量。**为什么选 BGE-M3？** 它在中文语义理解和多类召回任务上优于 OpenAI 的 `text-embedding-3`，且支持本地部署，零数据隐私风险。

---

## 3. 核心算法：混合检索执行器 (Hybrid Retrieval Executor)

这是系统最复杂的部分，必须解决“语义强相关但距离太远”的问题。我们没有使用简单的 LangChain Retriever，而是手写了**动态加权的 SQL生成器**。

### 3.1 动态 SQL 生成逻辑

后端 Executor 会根据 User Query 动态构建如下结构的 SQL（伪代码）：

```sql
WITH spatial_candidates AS (
    -- 第一层漏斗：利用 GIST 索引快速圈定 3km 内的候选点
    -- 极大减少向量计算的计算量 (从 100w -> 1k)
    SELECT id, name, geom, embedding
    FROM pois
    WHERE ST_DWithin(
        geom, 
        ST_SetSRID(ST_MakePoint($user_lon, $user_lat), 4326)::geography, 
        3000 -- search_radius
    )
)
SELECT 
    id, name, geom,
    -- 核心公式：混合打分
    (
      -- 语义相似度 (0~1)
      (1 - (embedding <=> $query_vector)) * 0.7 
      + 
      -- 距离衰减分数 (0~1): 距离越近分数越高，使用高斯衰减或线性归一化
      (1 - (ST_Distance(geom::geography, $user_loc) / 3000)) * 0.3
    ) as final_score
FROM spatial_candidates
ORDER BY final_score DESC
LIMIT 50;
```

* **技术细节**: 这里的 `0.7` 和 `0.3` 系数不是固定的。Planner 会根据用户意图调整：
  * 用户搜“附近的厕所” -> 距离权重调高 (0.8)。
  * 用户搜“全城最好吃的日料” -> 语义权重调高 (0.9)。

---

## 4. 空间分析技术：H3 网格与多尺度聚合 (Multi-Scale Aggregation)

在进行“区域分析”时，直接丢给 LLM 1000 个散点会撑爆 Context Window。我们使用 **Uber H3** 算法进行空间降维。

### 4.1 H3 动态聚合策略

系统根据当前地图的缩放级别 (Zoom Level)，动态选择 H3 分辨率 (Resolution)：

| Map Zoom | H3 Res | Edge Length (km) | 作用 |
| :--- | :--- | :--- | :--- |
| 10 - 12 | 7 | ~1.2 km | **宏观统计**: 统计各网格的主导业态 (Dominant Category)。 |
| 13 - 14 | 9 | ~0.17 km | **高密度分析**: 生成精细的热力图分布。 |
| > 15 | - | - | **Raw Mode**: 直接显示具体的 POI 点，停止聚合。 |

### 4.2 聚合算法实现

1. **Polyfill**: 获取当前视口 (Viewport) 的边界框多边形。
2. **Fill**: 使用 `h3.polyfill()` 填充出数百个 Hexagon ID。
3. **Group By**: 在数据库或内存中，按 `h3_index` 对 POI 进行 Group By。
4. **Feature Extraction**: 对每个六边形，计算：
    * `count`: 热度。
    * `top_tags`: 利用 TF-IDF 提取该网格内 POI 描述的高频词（如“商务”、“嘈杂”、“美食”）。

最终，LLM 看到的不是“1000个点”，而是“20个六边形区域的摘要”，极大地压缩了 Context。

---

## 5. 前端渲染层 (High-Performance Rendering)

### 5.1 Deck.gl 图层架构

常规 OpenLayers/Leaflet 使用 DOM 节点渲染 Marker，超过 500 个点就会卡顿。我们使用 **Deck.gl (WebGL)** 实现 GPU 加速渲染。

* **IconLayer**:
  * **Texture Atlas**: 将所有 POI 图标打包成一张大纹理 (Sprite Sheet)，GPU 只需要一次 Draw Call 即可渲染上万个图标。
  * **Binary Data**: 数据传输使用二进制定型数组 (Float32Array) 而非 JSON，解析速度提升 10 倍。

* **H3HexagonLayer**:
  * 直接接收 H3 Index 数组，GPU 自动计算六边形顶点坐标，无需后端传几何数据，节省 80% 带宽。

### 5.2 状态管理与交互

* **Reactive Viewport**: Vue 的 `watch` 监听地图 `viewState` 变化。一旦停止拖拽 (debounce 300ms)，自动触发后端的 `re-search`，实现“所移即所搜”。

---

## 6. LLM Agent 编排细节 (Agentic Workflow)

我们不使用通用的 Chat 流程，而是设计了专门的 **Planner Agent**。

### 6.1 Planner System Prompt 设计

Prompt 不仅仅是“你是一个助手”，而是包含了严密的逻辑约束：
> "User Input 可能包含显式地理范围（如‘五道口’）或隐式范围（‘当前屏幕’）。
>
> 1. 首先，提取地理实体并进行 Geocoding。
> 2. 其次，判断意图类型：
>    * **INTENT_SEARCH**: 寻找具体地点 -> 输出 keywords。
>    * **INTENT_ANALYZE**: 询问分布/特征 -> 开启 aggregation=True。
> 3. 输出必须是严格的 JSON 格式，包含 `search_params` 和 `explanation`。"

### 6.2 JSON Mode 强制约束

为了防止 LLM 幻觉导致后端解析失败，我们在调用 OpenAI SDK (或兼容接口) 时，强制开启 `{ response_format: { type: "json_object" } }`，并提供 Schema 定义。

---

## 7. 总结：技术先进性 (Technical Superiority)

1. **True Hybrid Search**: 不是简单的 `Filter -> Search` 或 `Search -> Filter`，而是基于数学公式的**加权并归 (Weighted Fusion)**，这是解决“空间-语义”冲突的最优解。
2. **Dynamic LoD (Level of Detail)**: 利用 H3 实现了从微观(POI)到宏观(网格)的无缝切换，解决了 GIS 数据过载的问题。
3. **Vector-Native**: 从数据入库的第一刻起就通过 LLM 增强和向量化，从根本上改变了数据的“可检索性”。
