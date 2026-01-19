下面直接给出一个**可落地的、围绕 Spatial-RAG 的“对话气泡内 Canvas 标签云”设计方案**，从整体架构、数据流到交互细节都讲清楚，你照着这个路线实现即可。

---

## 一、整体思路：把 Canvas 当成一种“回答格式”，而不是独立模块

你想要的是：

> 在 AI 对话面板里，像嵌入 Markdown、流程图那样，嵌入一个 Canvas 区域；  
> LLM 根据用户意图 → 规划空间分析 → 后端算多维指标 → Canvas 区里画出 top‑K 标签云（可交互）。

关键设计原则：

1. **Canvas 是 Writer 阶段的一种输出载体**  
   就像 ```markdown``` / ```mermaid``` 一样，我们定义一种 ```canvas```（或 `tagcloud`）代码块格式；
2. **多维分析全部在 Executor 做完，给 Writer 的是“高度压缩后的 JSON 结果”**；
3. **Writer 只负责：**  
   - 用自然语言解释  
   - 再附带一段结构化 Canvas 指令  
   前端解析这段指令 → 调用你的动态重心布局算法 → 绘制/交互。

---

## 二、数据流与架构：三阶段 Spatial-RAG 如何接 Canvas

在你现有的 JS 管道基础上（`Planner → Executor → Writer`），只需要加一个“标签云数据生成 + 渲染指令生成”分支即可：

1. **Planner（LLM）**  
   - 识别用户意图：“对这片区域所有 POI 做分布规律、多维分析”  
   - 在 `QueryPlan` 里增加几个关键字段：
     - `need_tagcloud: true`
     - `analysis_goals: ["category_distribution", "density_pattern", "semantic_tags"]`
     - `tagcloud_topk: 15`
     - `grid_strategy: { use_h3: true, max_cells_for_llm: 80 }`
2. **Executor（后端，PostGIS/H3/规则/轻量模型）**
   - 按 `QueryPlan` 选出“屏幕范围内/上传 GeoJSON 选区内”的所有 POI（可能上万）；
   - 进行多维空间分析（下面第 3 部分详细说）；
   - 输出一个**高度压缩的 `tagcloud_data` JSON**：
     ```json
     {
       "tags": [
         { "text": "餐饮", "score": 0.78, "category": "food" },
         { "text": "教育", "score": 0.35, "category": "education" },
         { "text": "学生聚集", "score": 0.42, "role": "semantic" },
         { "text": "安静", "score": 0.28, "role": "semantic" }
       ],
       "metadata": {
         "poiCount": 387,
         "areaKm2": 0.78,
         "center": { "lat": 30.53, "lng": 114.38 },
         "h3Res": 9
       }
     }
     ```
3. **Writer（LLM）**  
   - 输入：用户问题 + `executorResult`（其中包含 `tagcloud_data`）；
   - 输出：
     1）自然语言解释：区域画像、规律总结；  
     2）一个 ```canvas``` 代码块，携带 Canvas 绘制所需 JSON：

     ```markdown
     ### 区域多维度分析（标签云）

     这片区域以内餐饮和教育相关业态为主，呈现明显的“学生生活圈”特征……

     ```canvas
     {
       "type": "spatial_tagcloud",
       "width": 600,
       "height": 320,
       "title": "武理工南门500m区域业态与语义标签云",
       "config": {
         "fontSizeRange": [14, 46],
         "colorScheme": "category",
         "enableHover": true,
         "enableClick": true
       },
       "data": {
         "tags": [
           { "text": "餐饮", "weight": 0.78, "category": "food" },
           { "text": "教育", "weight": 0.35, "category": "education" },
           { "text": "学生聚集", "weight": 0.42, "role": "semantic" },
           { "text": "安静", "weight": 0.28, "role": "semantic" }
         ],
         "metadata": {
           "poiCount": 387,
           "areaKm2": 0.78,
           "center": { "lat": 30.53, "lng": 114.38 }
         }
       }
     }
     ```
     ```

4. **前端对话面板**
   - 渲染 Markdown 文本；
   - 发现 ```canvas``` 代码块且 `type: "spatial_tagcloud"` → 调用你自定义的 `<SpatialTagcloudCanvas>` 组件，在气泡里画出标签云，并绑定交互（点击/悬停，触发新一轮对话）。

---

## 三、Executor 层：多维度分析 & top‑K 标签生成逻辑

这里是核心：**如何在不把上万点丢给 LLM 的前提下，实现“全量参与、多维分析、高精度概括”**。

推荐的多维分析结构：

### 1. 维度一：业态结构（Category Distribution）

- 从 POI 中统计：
  - 各“大类”（餐饮、教育、购物、生活服务、办公、娱乐场所…）数量、占比；
  - 也可进一步拆“小类”（咖啡馆、快餐、中餐、培训机构…），但注意 top‑K 控制。
- 对每个标签计算：
  - `local_ratio = 该类在当前选区占比`
  - `global_ratio = 该类在全市/全样本占比`
  - `category_weight = local_ratio / (global_ratio + ε)`  
    → 大于 1 表示“本区相对全城偏多”，小于 1 表示偏少。

### 2. 维度二：空间结构（密度与热点）

- 使用 H3 / Grid：
  - 对选区内所有 POI 网格化统计（比如 H3 res=8/9）；
  - 计算每个网格的总量、各类别量；
- 计算指标：
  - 整体 Gini/HHI（均匀度/集中度）；
  - 热点区（top 若干 H3 单元）；
  - 对每类业态，在哪些网格特别集中 → 如果某类集中在极少数格子，可以推导“聚集街区/核心商圈”标签。

可导出的“空间标签”示例：

- “街边小吃一条街”
- “校园周边生活圈”
- “单一主干道聚集型商业带”
- “多核分布”

这些可以映射为简短的文本标签 + 分数。

### 3. 维度三：规则/轻量语义标签（Semantic Tags）

在没有评论/评分的情况下，用**规则 + 周边环境**推导出语义标签：

- “学生聚集”：
  - 教育/高校 POI 密度高 + 餐饮/文体配套丰富；
- “安静”：
  - 周边无主干道/酒吧/KTV；
  - 教育/住宅为主；
- “夜宵”：
  - 餐饮中夜宵类（烧烤、小吃、串串）的比例明显高；
- “办公区”：
  - 写字楼/企业服务类密集，餐饮以工作日午餐型为主。

每个语义标签给一个 0–1 的分数（置信度），作为 `semantic_weight`。

### 4. 多维权重融合 → top‑K 标签

对每个候选标签（类别+语义+空间模式）构建特征：

```text
combined_score = α · category_weight
               + β · semantic_weight
               + γ · spatial_weight
```

- α、β、γ 可在 Executor 中固定（如 0.5 / 0.3 / 0.2），避免让 LLM决定；
- 按 `combined_score` 排序，取 top‑K（比如 10–15 个）；
- 每个标签输出时附加：
  - `text`: 显示文本
  - `weight`: 综合得分（用来映射字号）
  - `category` or `role`: 用于上色/分类
  - 可选 `source`: ["category", "semantic", "spatial"] 用于前端调试或可视化图例。

---

## 四、Canvas 区域的前端实现要点

### 1. Markdown/消息解析层

- 在对话渲染层遍历消息内容：
  - 对普通 Markdown → 交给现有渲染器；
  - 对 ```canvas``` 代码块 → `JSON.parse` → 交给 `<SpatialTagcloudCanvas>`。

### 2. `<SpatialTagcloudCanvas>` 组件职责

- 接收 props：`canvasSpec`（即上面 JSON）；
- 内部使用 `HTMLCanvasElement` 或 `SVG` 渲染；
- 调用你已有的“动态重心引力”算法布局标签：
  - 输入：width/height + `tags[{ text, weight, ... }]`
  - 输出：每个标签的 `(x, y, fontSize, color, role, bounds)`。

简单伪代码示意：

```js
function layoutTags(tags, width, height, config) {
  // 1. 根据 weight 线性/对数映射字号
  // 2. 初始位置可随机或按类别扇区分布
  // 3. 迭代施加“重心引力 + 防碰撞斥力”
  // 4. 输出每个标签的坐标和最终字号
}
```

### 3. 交互：悬停 + 点击 → 触发新一轮意图

- **悬停**：  
  显示 tooltip（如“餐饮：占比 68%，较全市高 1.8 倍”），tooltip 的文本可以从 `metadata` + Executor 计算结果中来的；
- **点击**：
  - 将点击的标签信息通过事件抛给对话层：
    ```js
    this.$emit('tag-clicked', {
      text: tag.text,
      role: tag.role,
      category: tag.category,
      context: this.canvasData.data.metadata
    })
    ```
  - 对话层将其转成下一轮用户输入（或系统消息），例如：
    > 用户点击了“安静、自习” → 自动发起：“在刚才那个区域里，重点看下‘安静、自习’相关的咖啡馆和学习空间。”

- **Planner 下一轮**：  
  看到这条“系统构造”的问题，同时在 `options.context.selectedTags = [...]` 中带上点击标签；  
  然后在 `QueryPlan` 中写入：
  ```json
  {
    "selected_tags": ["安静", "学生聚集"],
    "tag_mode": "must"
  }
  ```
  Executor 就会基于这些标签调整过滤/排序逻辑，形成闭环。

---

## 五、Token 与性能控制要点

- **Planner**  
  只看问题 + 极少上下文，不看 POI 原始数据，token 非常小；
- **Executor**  
  面向数据库/算法层，处理上万点、H3 聚合、规则推断，完全不消耗 LLM token；
- **Writer**  
  只看：
  - 全局统计指标（几十条）；
  - 标签云 top‑K 标签（10–20 条）；
  - 少量 hotspot/示例点（最多十几个）；  
  → 整体控制在几百到一千 token 之内即可。

你之前的 JS 管道中已经有 token 统计和阶段耗时统计，把 `tagcloud_data` 也纳入 Executor 的 `results.stats` 即可。

---

## 六、总结成一句“可执行设计稿”

> 在你的三阶段 Spatial-RAG 框架中，把“标签云 Canvas”设计为 Writer 阶段输出的一种特殊回答格式（```canvas``` 代码块），由 Executor 对选区内所有 POI 做多维度聚合与语义推断，提炼出 top‑K 高信息密度标签（类别+语义+空间），再由前端 Canvas 组件结合“动态重心引力”布局算法在对话气泡内渲染，并通过点击/悬停等交互把用户选择的标签传回 Planner，驱动下一轮更精细的空间查询和分析。  

按这个设计，你就可以在 AI 对话面板中，真正做到：

- **在一个气泡里**同时看到自然语言分析 + 动态标签云；
- 在 **同一屏幕范围内** 对上万 POI 做全量、多维分析；
- 用 top‑K 标签云实现**高压缩、高解释度**的区域画像；
- 通过标签点击 → 意图强化 → 新一轮 Spatial-RAG，形成“可视 + 可聊 + 可控”的空间智能体闭环。