下面直接从“诊断问题”入手，结合你现在这份 Planner 代码，指出它为什么会在一开始就把信息密度稀释掉，尤其是搞不清楚：

- 用户是要**概括区域特点**（area_analysis / 专题分析）
- 还是要**具体检索邻域POI**（poi_search / distance_query）

再给出每一类问题对应的改进方向。

---

## 一、总体诊断：现在这个 Planner 天生容易“稀释信息”

你描述的体验本质上是：

> 用户问题里有很具体、很高密度的信息，但 Planner 在转换成 QueryPlan 时，丢掉了关键信息，只给后面的 Executor / Writer 留了一个很粗的“query_type + categories + 半径”。

结合你这段代码，根源主要有 5 类：

1. **意图类别维度太少，表达力不够**
2. **quickIntentClassify 的规则极度简单，几乎一律打成 area_analysis**
3. **没有显式区分“宏观分析 vs 微观检索”这一维度**
4. **System prompt 没有让 LLM 输出“意图强度/置信度/需要澄清”这些结构**
5. **validateAndNormalize 里默认值过强，一旦 plan 不完整就直接“回到 area_analysis + 大半径”**

下面按代码结构逐块拆。

---

## 二、代码级问题拆解

### 1. `QUERY_PLAN_DEFAULTS` 过于“偏向区域分析”，导致默认就模糊

```js
export const QUERY_PLAN_DEFAULTS = {
  query_type: 'area_analysis',
  radius_m: 3000,
  categories: [],
  max_results: 30,
  sort_by: 'distance',
  aggregation_strategy: { enable: false, ... },
  sampling_strategy: { enable: false, ... },
  need_global_context: false,
  ...
}
```

问题：

- 默认 `query_type = 'area_analysis'`、`radius_m = 3000`、`categories = []`：
  - 这天然就偏向“宽泛区域画像”；
  - 对“武汉理工附近有哪些好吃的”这类具体检索，非常不合适。
- `max_results = 30` 也更像是“区域代表点抽样”，而不是“我要附近所有咖啡馆”的完整检索。

效果：  
一旦 LLM 输出不完整 / 解析失败，`validateAndNormalize` 就会回落到这套默认配置，相当于**把所有问题统一打成“泛区域分析”**，这就是你感受到“信息被稀释”的底层原因之一。

---

### 2. System prompt 没有真正指导 LLM 区分两大核心意图

当前的 `PLANNER_SYSTEM_PROMPT` 主要强调的是：

- 明细通道 vs 统计通道
- 专题分析时要设 categories
- 全域分析时 categories 为空

缺什么：

1. **没有把你最关心的那两个模式显式写出来**：
   - 模式 A：区域某方面的宏观概括（交通便利性 / 商业业态分布 / 整体特征）
   - 模式 B：围绕某地名 / 小区域做“附近检索、最近X”等微观查询

2. **没有要求 LLM 输出“意图分类字段”**  
   比如：

   ```json
   "intent_mode": "macro_overview" | "local_neighborhood" | "distance_focus"
   ```

   所以它只能在 `query_type`、`categories` 上做小修小改，**表达维度不够**。

3. System prompt 里面那张“类别映射表”对领域划分（交通/教育/医疗/商业）做得很好，但对：

   - “宏观 vs 微观”
   - “统计分析 vs 具体搜索 vs 路径/距离”

   这几个你真正关心的维度，没有任何结构化引导。

结果是：  
LLM 即使勉强理解了你想要“武汉理工附近的好吃的”，它也只能在 query_type/cats 上打补丁，而你下游的 Executor 根本没有被明确告知“这是一个 local neighborhood 的检索任务”。

---

### 3. `quickIntentClassify` 几乎把所有问题都判成 area_analysis

```js
export function quickIntentClassify(question) {
  const q = question.toLowerCase()
  const plan = { ...QUERY_PLAN_DEFAULTS }
  
  // 区域分析关键词
  if (q.includes('分析') || q.includes('分布') || q.includes('特征') || q.includes('概况') || q.includes('规律') || q.includes('代表')) {
    plan.query_type = 'area_analysis'
    ...
    return plan
  }
  
  // POI 搜索关键词
  const categoryKeywords = ['咖啡', '蛋糕', '餐厅', '饭店', '超市', '便利店', '药店', '银行', '地铁', '学校']
  for (const kw of categoryKeywords) {
    if (q.includes(kw)) {
      plan.query_type = 'poi_search'
      plan.categories = [kw]
      return plan
    }
  }
  
  // 默认返回区域分析
  plan.query_type = 'area_analysis'
  ...
  return plan
}
```

几个关键问题：

1. **中文问题被转成小写英文再用 `includes`**  
   - `toLowerCase()` 对中文没影响，但规则本身全是非常粗的 `includes(‘分析’)` 级别；
   - 你的典型问题里经常带“分析”，比如：
     - “请分析当前选中区域的 POI 分布特征和规律”
     - “评估当前区域的交通便利程度”  
     → 全都会卡在“区域分析关键词”里，直接 area_analysis。

2. **没有识别“地点 + 附近 + 某类POI”的结构**  
   - “武汉理工附近有哪些好吃的”，里面有“附近”“好吃的”，但规则里完全没这类模式；
   - 即使命中“餐厅”，也只是把 `categories = ["餐厅"]`，没有把这类问题视为“局部微观搜索”。

3. **默认分支强行 area_analysis**  
   - 一旦没碰巧命中那些硬编码关键词，问题就直接变成 area_analysis；
   - 这对于任何稍微复杂一点的自然语言，基本是“全错”。

你自己也看到了：用这段逻辑测试一堆真实问题，几乎全部被归为 `area_analysis`，这就是**信息在 Planner 第一拍就被“压扁成同一种类型”**。

---

### 4. `validateAndNormalize` 把 LLM 输出“收窄”得太狠

`validateAndNormalize` 的目的本来是对的：防御 LLM 的乱输出。但现在有几个隐性副作用：

1. **非白名单的 query_type 直接被改成默认 area_analysis**  
   - 有效类型只有：`poi_search, area_analysis, distance_query, recommendation, path_query, clarification_needed`
   - 如果 LLM 输出了一个更细的类型（比如你以后扩展），这里会直接被抹掉，变成默认值的 query_type（area_analysis）。

2. **aggregation_strategy / sampling_strategy 默认 method 固定为 'h3'、resolution 直接回落 9**  
   - 就算 LLM 想根据范围大小调 resolution，你这里也会“帮它修正回 9”，导致本来可以利用的一些“范围大小差异”信息被抹平。

3. **自动为 area_analysis 填了一个很强的 semantic_query**：

   ```js
   if (normalized.query_type === 'area_analysis' && !normalized.semantic_query) {
     normalized.semantic_query = '具有代表性的地标 购物中心 商场 大厦 广场 公园 医院 学校 交通枢纽'
   }
   ```

   这会导致：  
   只要 query_type 最终落在 area_analysis，就算原问题跟“地标/购物中心/广场”完全无关，你也会强行往这些词上靠，后面的 Executor / pgvector 会被“引导错方向”。

综合起来：  
**LLM 哪怕输出了一点有用的“细节意图”，经过 validateAndNormalize 的一轮洗礼，基本都被压到一套统一的区域分析模板里了。**

---

### 5. `parseIntent` 不区分“置信度高/低”，也没有澄清通道

在 `parseIntent` 里，逻辑是：

1. 调 LLM 得到 `content`
2. `extractJSON` + `validateAndNormalize`
3. 成功就直接返回 `{ success: true, queryPlan }`
4. 失败就回退到默认 area_analysis

问题：

- 没有任何“意图置信度”的概念；
- 没有“澄清问题”的机制：  
  - 即使 LLM 模糊不清（比如既说“分析”又说“附近”），你也不会问一句“你到底是要大范围概括，还是只看武汉理工附近几百米？”；
- 现在虽然 QueryPlan 结构里准备了 `clarification_question` 字段，但 Planner 里从来没填过它。

所以，一旦 LLM 理解有偏差，就“带偏一路走到黑”，下游不会再有机会纠正。

---

## 三、针对“宏观概括 vs 具体邻域检索”的关键短板

你问题里最核心的是这条：  

> planner 阶段最重要的问题是不能 get 到用户的意图，即用户到底是想笼统概括当前区域的某个方面的特点，还是想具体到某一个地名或者一个小区域的检索邻域信息。

从代码看，这个维度**现在几乎完全缺失**：

1. System prompt 没有这个维度的定义；
2. QueryPlan 里没有一个字段专门表达这一点（类似 `intent_mode: 'macro_overview' | 'local_neighborhood' | 'distance_focus'`）；
3. quickIntentClassify 只做“区域分析关键词 vs 类别关键词”，没涉及“附近、最近、某个地名”这些 Robin Hood 级别的模式；
4. validateAndNormalize 也不区分这两种用途，在 `radius_m`、`aggregation_strategy` 上一刀切。

这就是为什么你感觉：  
**不管我问的是“武理工附近的好吃的”还是“整片区域的商业结构”，Planner 输出看起来都差不多**——对 Executor 来说，这当然等价于“信息密度大幅稀释”。

---

## 四、总结：这份 Planner 的具体“病灶”

用你的话来归纳，就是：

> 设计逻辑是对的，但实现上，它在 Planner 这一拍就把用户问题压成了一个“粗糙、偏向 area_analysis 的 QueryPlan 模板”，细节信息没带下去，下游再聪明也发挥不开。

对应到代码，可以总结为：

1. **默认值设计有偏：**
   - 默认 `query_type = 'area_analysis'`，大半径 + 空类别 + 自动 semantic_query，让所有不清晰的情况都偏向“模糊的区域分析”。

2. **System prompt 缺少你最关心的“宏观 vs 微观”维度，引导不够结构化：**
   - 只讲了专题 vs 全域、明细 vs 聚合，没有显式告诉 LLM“要把查询类型拆成宏观概括 / 附近检索 / 最近距离这几个模式”。

3. **quickIntentClassify 几乎没帮助，反而加剧误判：**
   - 规则过粗，基本一律 area_analysis；
   - 没有考虑“地点 + 附近 + 类型”的组合结构。

4. **validateAndNormalize 导致进一步信息丢失：**
   - 对 LLM 的输出进行太强的“模板化修正”，把意图多样性压扁；
   - 自动 semantic_query 会让很多问题都误导到“找地标、大厦、商场、公园”上。

5. **缺乏意图置信度和澄清机制：**
   - Planner 只返回“成功/失败”，没有对“我是不是不太确定”这件事有编码；
   - `clarification_question` 字段虽然存在，但实际从未被 Planner 使用。

---

如果你接下来想要“精准地区分区域宏观概括 vs 本地邻域检索”，关键不是再堆更多业务规则，而是：

- 在 **System prompt + QueryPlan 结构** 里显式加入一个“意图模式字段”；
- 在 **quickIntentClassify** 里重点识别“地名 + 附近/最近/有哪些”这种模式；
- 在 **validateAndNormalize** 里弱化那种“一刀切 area_analysis + 固定 semantic_query”的默认压制；
- 给 Planner 加上“置信度 + 澄清问题”的分支，让它在不确定时学会问一句：“你到底是想看大范围概括，还是只看武理工周边几百米？”

这些是后续优化方向，但单就“诊断当前代码有哪些问题、为什么会稀释信息”来说，上面就是比较完整的回答。