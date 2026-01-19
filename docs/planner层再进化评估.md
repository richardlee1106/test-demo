下面直接回答你问的那句：**“现在更新过后呢？”**——也就是这版 Planner 更新后，在“能不能精准区分宏观概括 vs 微观检索、减少信息稀释”方面，整体效果如何，还有哪些遗留问题。

我分三块说：

- 现在这版相比旧版到底改对了什么
- 还存在哪些关键问题（特别是你在意的“意图没 get 到”）
- 在这版基础上，如何小改就能再上一个台阶

---

## 一、这版 Planner 更新后，已经解决了哪些大问题？

### 1. 把你最关心的“宏观 vs 微观”显式编码了

关键变化：

- 新增字段：`intent_mode: 'macro_overview' | 'local_search'`
- System prompt 顶层就强调：  
  > 核心职责：区分"宏观概括"与"微观检索"

并且给了清晰配置：

- **模式 A 宏观概括**（area_analysis）
  - `intent_mode = "macro_overview"`
  - `aggregation_strategy.enable = true`
  - 半径 3000–5000
  - `sampling_strategy.enable = true`
- **模式 B 微观检索**（poi_search）
  - `intent_mode = "local_search"`
  - `aggregation_strategy.enable = false`
  - 半径 500–1500
  - 必须指定 `categories`
  - `max_results` 10–20

同时在 `validateAndNormalize` 里加了兜底推断：

```js
if (['macro_overview', 'local_search'].includes(plan.intent_mode)) {
  normalized.intent_mode = plan.intent_mode
} else {
  if (normalized.query_type === 'poi_search') normalized.intent_mode = 'local_search'
  else if (normalized.query_type === 'area_analysis') normalized.intent_mode = 'macro_overview'
}
```

**效果**：  
后端和 Executor 不再只看到“query_type = poi_search / area_analysis”这种模糊信息，而是能明确知道：

- 这是“看统计特征 + 代表点”的**宏观通道**
- 还是“给我具体列表”的**微观通道**

这对减少后续阶段的信息稀释，是一个非常实质的改进。

---

### 2. “专题类别”识别比以前可靠多了

你现在有两层类别推断：

1. **LLM 端（在 prompt 里指导）**：  
   给出**严格类别映射表**（交通/教育/医疗/购物/餐饮），并反复强调：

   > 专题分析必须指定类别；  
   > 全域分析才用空数组 `categories: []`。

2. **后端兜底：`inferCategoriesFromQuestion`**

   ```js
   if (existingCategories && existingCategories.length > 0) {
     return existingCategories
   }
   // 否则用关键词 → categories 映射表
   ```

也就是说，只要问题里出现“交通/出行/通勤/公交/地铁/停车”等词，即便 LLM 没识别到，你的后端也会自动把：

```js
categories = ['公交站','地铁站','停车场','加油站','高铁站','火车站','汽车站','机场']
```

补上。

**效果**：  
即使 Planner 这一步不够聪明，下游也**基本不会出现“问交通却不筛交通类POI”的致命错误**，这比之前靠 LLM 自己自由发挥要稳定多了。

---

### 3. 语义查询（semantic_query）的生成更贴合“宏观 vs 微观”了

在 `validateAndNormalize` 里新增了分支：

```js
if (!normalized.semantic_query) {
  if (normalized.intent_mode === 'macro_overview') {
    normalized.semantic_query = '具有代表性的地标 购物中心 商场 大厦 广场 公园 医院 学校 交通枢纽'
  } else if (normalized.intent_mode === 'local_search' && normalized.categories.length > 0) {
    normalized.semantic_query = `好评 ${normalized.categories.join(' ')}`
  }
}
```

**效果：**

- 宏观模式：缺语义时，自动走“地标 +主业态”的语义检索，偏向“区域画像 + 代表点”；
- 微观模式：缺语义时，基于类别自动长出类似“好评 餐厅 小吃 咖啡”的向量检索文本，更适合“找好吃的、好评的店”。

这对于后续 pgvector / 语义 rerank 的表现，是一个合理的增强，比之前“一刀切的地标语义”要聪明很多。

---

### 4. 快速模式 quickIntentClassify 明确考虑了“附近/最近 vs 分析/规律”这组关键词

新版 `quickIntentClassify` 的核心逻辑：

- 如果包含 “附近 / 周围 / 周边 / 最近 / 找 / 哪里有 / 有没有 / 推荐几个”  
  → 直接判定为：
  ```js
  plan.query_type = 'poi_search'
  plan.intent_mode = 'local_search'
  plan.radius_m = 1000
  plan.aggregation_strategy.enable = false
  plan.categories = inferCategoriesFromQuestion(...)
  ```
- 如果包含 “分析 / 概况 / 特征 / 规律 / 分布 / 评估 / 怎么样 / 如何 / 特点 / 报告”  
  → 判定为：
  ```js
  plan.query_type = 'area_analysis'
  plan.intent_mode = 'macro_overview'
  plan.radius_m = 3000
  aggregation_strategy.enable = true
  sampling_strategy.enable = true
  need_global_context = true
  need_landmarks = true
  ```

这恰好对齐了你反复强调的那两个主模式：

- “分析当前区域的 POI 分布特征和规律” → 宏观
- “武汉理工附近有什么好吃的 / 最近的地铁站在哪” → 微观

**效果**：  
在不调 LLM 的情况下，**只靠关键词就能在七八成场景里**把这两个模式分开，用于低成本/低延迟场景。

---

## 二、更新后仍然存在的关键问题（尤其是你在意的“信息稀释”点）

更新之后，问题确实缓和了一些，但有几个“深层坑”还在：

### 1. 默认值依然“偏向宏观”，一旦 LLM 输出不完整就容易误伤

`QUERY_PLAN_DEFAULTS` 还是：

```js
query_type: 'area_analysis',
intent_mode: null,
radius_m: 3000,
categories: [],
aggregation_strategy.enable: false,
...
```

并且在 `validateAndNormalize(plan)` 顶部：

```js
if (!plan || typeof plan !== 'object') {
  return { ...QUERY_PLAN_DEFAULTS }
}
```

含义是：

- 只要 LLM 输出不对、解析失败、或没填某些字段，就会**整体回落到“area_analysis + 大半径 + 空类别”**；
- 再加上兜底逻辑：
  ```js
  if (!intent_mode) {
    if (query_type === 'poi_search') intent_mode = 'local_search'
    else if (query_type === 'area_analysis') intent_mode = 'macro_overview'
  }
  ```
  于是绝大多数 fallback 情况，都会被定性为“宏观概括”。

**对你的影响：**

- 对一些原本是“很明确的微观检索”的问题，一旦 LLM 在 `query_type` 上掉链子，你就会退回到“泛区域分析”，信息密度被压扁；
- 简单说：**默认模板依然过分偏向 area_analysis。**

---

### 2. 没有“置信度 + 澄清问题”的通道，还是“一拍定生死”

虽然 `QueryPlan` 结构里有：

```js
clarification_question: null
query_type 可为 'clarification_needed'
```

但：

- System prompt 并没有让 LLM 在“不确定时选择 clarification_needed”；
- `validateAndNormalize` 也只是在 plan 里看有没有 `clarification_question` 文本，有就抄，没有就拉倒；
- `parseIntent` 里不对“低置信度/冲突情况”做任何判断，**永远返回 `success: true`**，最多 categories 用 infer 补一补。

因此：

- 当一个问题既有“附近”又有“分析”（比如“分析一下武汉理工附近这片区域的餐饮结构”），  
  **Planner 没有机制去说：“我不确定，你先告诉我你更关心宏观还是微观？”**；
- 而是硬选一个模式（往往偏向 area_analysis），然后整条 pipeline 被带跑偏。

这就是你说的那种：  
> “一开始 100% 信息密度，在 Planner 这里一下被压成一个很粗的标签。”

---

### 3. quickIntentClassify 依然是“规则版的一刀切”

虽然它比旧版好了不少，但机制还是非常粗糙：

- 只看“有没有某些关键词”，**不看问题的整体结构**；
- 不识别“地名 + 附近 + 类别”这种组合模式，仅依赖 `inferCategoriesFromQuestion` 里那套广义话题映射；
- 对混合意图（既有“分析”又有“附近”）默认按第一匹配走，而不是标记为“需要澄清”。

在你真实业务里的很多问句，**远比示例里的两三词复杂**。只靠 `includes` 匹配，很容易：

- 把“我想大致分析一下武汉理工南门附近这片区域的商业分布”  
  判成“微观 poi_search”（因为有“附近”）
- 或者反过来，判成 area_analysis（因为有“分析 / 分布”）

这两种判法都不完全错，但**差别很大**，而目前 Planner 没有给下游留下“模糊程度/不确定性”的信息，一律当成“我非常确定是 A”。

---

### 4. `semantic_query` 自动生成还是偏“模板化”

现在的逻辑：

- 宏观 → 固定句子“具有代表性的地标 购物中心 商场 大厦 广场 公园 医院 学校 交通枢纽”
- 微观 → “好评 + categories 拼一串”

问题在于：

- 如果用户问的是“评估当前区域的医疗资源分布”，  
  你在 categories 里已经限定了医疗类（医院/诊所/药店），  
  但 semantic_query 仍然是“具有代表性的地标 购物中心 商场 大厦 广场 公园 医院 学校 交通枢纽”，  
  这会在 pgvector 检索里**强行引入一堆和医疗无关的地标类型**；
- 微观场景下，“好评 餐厅 小吃 咖啡”这类模板可以用，但对于“安静”、“自习氛围好”这种语义偏好，还是太弱。

简单说，现在的 semantic_query 自动补全是**一个不错的兜底**，但没有真正贴着用户原始 problem 的语义去构造，仍然有信息丢失/错位的风险。

---

## 三、结合这版的现状，你可以怎么“再小改一轮”？

你现在这版 Planner，已经做到：

- 明确有 `intent_mode`
- 有 decent 的类别映射 & 后备逻辑
- 能够在绝大部分“典型宏观 vs 典型微观”问题上跑通

接下来，为了进一步避免“Planner 一步把信息压扁”，**可以考虑三点小升级**，都可以在这版基础上增量修改：

### 1. 默认值去偏置 + 加简单置信度判断

- 把 `QUERY_PLAN_DEFAULTS.query_type` 改成 `null`，不要一上来就锁死 area_analysis；
- 在 `validateAndNormalize` 里写一个很轻量的“置信度分数”，比如：

  ```js
  function calcConfidence(plan) {
    let score = 0
    if (plan.query_type) score++
    if (plan.intent_mode) score++
    if (plan.anchor && plan.anchor.type && plan.anchor.name) score++
    if (Array.isArray(plan.categories) && plan.categories.length > 0) score++
    return score   // 0~4
  }
  ```

- 当 `confidence < 2` 且没有 `clarification_question` 时，**自动生成一条澄清问题**：

  ```js
  if (confidence < 2 && !normalized.clarification_question) {
    normalized.query_type = 'clarification_needed'
    normalized.clarification_question = '你是想看这片区域的整体特征，还是只查某个地点附近的具体点？'
  }
  ```

这样 parseIntent 返回后，pipeline 可以直接：

```js
if (queryPlan.query_type === 'clarification_needed') {
  yield queryPlan.clarification_question
  return
}
```

**效果**：  
遇到“Planner 有点懵”的问题时，**不再硬凹出一个 area_analysis / poi_search**，而是请用户用一句话帮你 disambiguate 一次，后面两阶段就不会跟着一起跑偏。

---

### 2. quickIntentClassify 增加“冲突检测 + 混合标记”

现在 quick 的逻辑是“谁先命中算谁”。你可以只加很小一段：

```js
const isLocal = localKeywords.some(kw => q.includes(kw))
const isMacro = macroKeywords.some(kw => q.includes(kw))

if (isLocal && isMacro) {
  plan.query_type = 'clarification_needed'
  plan.clarification_question = '你这次更想要的是：1）整体分析，还是 2）附近具体推荐？回复 1 或 2 即可。'
  return plan
}
```

这样在“附近 + 分析”共存的句子上，quick 模式会直接抛出澄清，而不是盲选一个。

---

### 3. semantic_query 改为“基于类别和原问题混合生成”

语义补全可以稍微智能一点，但仍保持在 Planner 这一层：

- 宏观模式下：

  ```js
  if (!semantic_query) {
    const topicWords = inferTopicFromCategoriesOrQuestion(...)
    semantic_query = `${topicWords} ${原始问题里的形容词/名词若干}`
  }
  ```

  比如“评估当前区域的医疗资源分布” →  
  `semantic_query = "医疗资源分布 医院 诊所 药店 社区卫生服务"`  
  而不是一股脑的“地标+商场+公园”。

- 微观模式下，如果用户带了明显偏好词（“好吃的”“安静一点”“适合学习”），可以直接拼进去：

  ```js
  semantic_query = `${偏好词} ${categories.join(' ')}`
  // 如 "安静 自习 咖啡馆 奶茶店"
  ```

这样 semantic_query 就真正成了“用户原话 + 结构化类别”的混合体，而不是和原问题割裂的模板。

---

## 四、一句话总结这版 Planner 的状态

- **相比旧版**：  
  这版 Planner 已经把你最关心的“宏观概括 vs 微观检索”显式抽象成 `intent_mode`，并在 prompt、默认配置、quick 规则和后备类别推断上做了比较系统的一轮升级，**大部分典型问题已经能正确走到对应通道**，比之前那种“统统被打成 area_analysis”的情况好很多。

- **但从“信息密度不被稀释”的严格要求来看**：  
  目前仍然存在“默认偏宏观 + 没有置信度/澄清 + quick 规则偏粗 + semantic_query 模板化”这几类残余问题；一旦 LLM 输出不完整或问题本身混合意图，Planner 还是有机会把原本很细腻的用户意图压扁成一个模板化 QueryPlan。

- **下一步最值得做的三个小改动**是：
  1. 去掉默认 query_type=area_analysis，增加一个简单的置信度评分，低置信时改成 `clarification_needed` 并返回澄清问题；
  2. 在 quickIntentClassify 里检测“附近 + 分析”共存时，不直接下结论，而是明确要求用户二选一；
  3. semantic_query 从“固定模板”升级为“原问题关键词 + 类别”的混合，减少语义错位。

做到这三点后，你这个 Planner 基本就从一个“规则+LLM 的粗糙筛子”，变成了一个**能显式区分模式、有兜底、有自我怀疑（澄清）的空间意图解析器**，后面的 Executor / Writer 才能真正吃到“高信息密度”的 QueryPlan。