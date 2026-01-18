/**
 * 阶段 1: Planner (查询规划器)
 * 
 * 职责：
 * - 将用户自然语言问题转换为结构化 QueryPlan JSON
 * - 绝不访问 POI 数据，只做意图解析
 * - Token 消耗: < 500
 */

import { getLLMConfig } from '../../services/llm.js'

/**
 * QueryPlan 默认值
 */
export const QUERY_PLAN_DEFAULTS = {
  query_type: 'area_analysis',
  anchor: {
    type: 'unknown',
    name: null,
    gate: null,
    direction: null,
    lat: null,
    lon: null
  },
  radius_m: 1000,
  categories: [],
  rating_range: [null, null],
  semantic_query: '',
  max_results: 20,
  sort_by: 'distance',
  
  // 三通道核心配置
  aggregation_strategy: {
    enable: false,
    method: 'h3',       // 'h3' | 'cluster' | 'administrative'
    resolution: 9,      // H3 分辨率
    max_bins: 50        // 传给 Writer 的最大网格/聚类数
  },
  sampling_strategy: {
    enable: false,
    method: 'representative', // 'representative' | 'random' | 'top_k'
    count: 20,                // 采样数量 (代表点)
    rules: ['diversity']      // 采样规则: 'diversity' (多样性), 'density' (高密区), 'outlier' (异常点)
  },
  
  need_global_context: false,
  need_landmarks: false,
  need_graph_reasoning: false,
  clarification_question: null
}

/**
 * Planner System Prompt
 * 严格约束 LLM 只做意图解析，不做回答
 */
const PLANNER_SYSTEM_PROMPT = `你是一个"空间查询规划器"，职责是将自然语言转换为结构化 QueryPlan。

## 核心职责：决策通道
根据数据规模和问题类型，决定是看"全量明细"还是看"统计聚合"。

### 1. 明细通道 (Small Data / Search)
- **场景**：找具体的店、问某个点详情、数据量小(<50个)。
- **配置**：aggregation_strategy.enable=false
- **结果**：Executor 返回具体的 POI 列表。

### 2. 统计通道 (Big Data / Pattern)
- **场景**：分析区域分布、热力图、业态结构、"这里有什么特点"、数据量大(>500个)。
- **配置**：aggregation_strategy.enable=true (使用 H3 网格聚合)
- **结果**：Executor 返回 H3 网格统计 + 只有少量代表点。

### 3. 混合通道 (Sampling)
- **场景**：既要看整体分布，又想看几个典型例子。
- **配置**：aggregation_strategy.enable=true, sampling_strategy.enable=true (选 representative)

## JSON 结构定义
{
  "query_type": "poi_search" | "area_analysis" | "recommendation",
  "anchor": { ... },
  "radius_m": number,
  "categories": ["cat1", "cat2"],
  "semantic_query": "...",
  
  // 聚合策略 (关键)
  "aggregation_strategy": {
    "enable": boolean,      // 是否启用空间聚合
    "method": "h3",         // 固定为 h3
    "resolution": number,   // 8(大范围) ~ 10(小范围), 默认 9
    "max_bins": number      // 给 Writer 看多少个网格 (建议 20-50)
  },
  
  // 采样策略 (关键)
  "sampling_strategy": {
    "enable": boolean,      // 是否需要代表点
    "method": "representative", 
    "count": number,        // 代表点数量 (建议 5-20)
    "rules": ["diversity", "density"] // 优先展示多样性还是高密区?
  },

  "need_global_context": boolean, // 是否计算全局统计(Gini/分布图)
  "need_landmarks": boolean
}

## 核心规则 (CRITICAL)
1. **禁止臆造类别**：如果用户只说"分析这里","有什么特点"而未指定具体类别（如餐饮,学校）, \`categories\` 必须为 \`[]\` (空数组)，代表全域/全类目分析。
   ❌ 错误：用户问"分析分布"，输出 'categories': ["restaurant", "cafe"]
   ✅ 正确：用户问"分析分布"，输出 'categories': []
2. **类别映射**：如果用户确实提到了类别，请映射为中文标准大类：
   - "吃饭" -> ["餐饮"]
   - "玩" -> ["风景名胜", "休闲娱乐"]
   - "买东西" -> ["购物"]
3. **距离默认值**：分析类请求默认 radius=3000 (3km)，找店类默认 radius=1000 (1km of search).

## 决策逻辑 (Thinking logic)
1. **用户问"分布"、"规律"、"概况"** → enable aggregation(res=9), enable sampling(count=10), need_global_context=true. 并且 categories 设为 [] (除非用户缩范围).
2. **用户问"有没有..."、"找几个..."、"推荐..."** → disable aggregation, result count 10-20.
3. **区域范围大 (>2km) 或 没指定具体类别 (全域)** → enable aggregation(res=8), enable sampling(count=20).
4. **范围小 (<500m) 且 类别明确** → disable aggregation, return raw POIs.

## 示例

用户问："分析一下这片区域的分布特征" (未指定类别 -> 全域)
输出：
{"query_type":"area_analysis","aggregation_strategy":{"enable":true,"method":"h3","resolution":9,"max_bins":30},"sampling_strategy":{"enable":true,"method":"representative","count":10},"categories":[],"need_global_context":true}

用户问："帮我找最近的咖啡馆"
输出：
{"query_type":"poi_search","aggregation_strategy":{"enable":false},"categories":["咖啡","咖啡厅"],"max_results":10}
`

/**
 * 构建上下文提示字符串
 * @param {Object} context - 上下文信息
 * @returns {string} 格式化的上下文字符串
 */
function buildContextString(context) {
  const lines = []
  
  if (context.hasSelectedArea) {
    lines.push('- 用户已选择了一个地图区域')
  } else {
    lines.push('- 用户尚未选择区域，需要根据问题中的地名定位')
  }
  
  if (context.poiCount) {
    lines.push(`- 当前选区内 POI 总数: ${context.poiCount}`)
  }
  
  if (context.selectedCategories?.length > 0) {
    lines.push(`- 已筛选的类别: ${context.selectedCategories.slice(0, 5).join(', ')}`)
  }
  
  if (context.viewportCenter) {
    lines.push(`- 当前视图中心: ${context.viewportCenter.lat.toFixed(4)}, ${context.viewportCenter.lon.toFixed(4)}`)
  }
  
  return lines.length > 0 ? lines.join('\n') : '无额外上下文'
}

/**
 * 清理 LLM 输出，提取 JSON
 * @param {string} content - LLM 原始输出
 * @returns {Object|null} 解析后的 JSON 或 null
 */
function extractJSON(content) {
  if (!content) return null
  
  // 1. 移除 <think> 标签
  let cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  
  // 2. 移除 Markdown 代码块标记
  cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  
  // 3. 尝试提取 JSON 对象
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  
  try {
    return JSON.parse(jsonMatch[0])
  } catch (err) {
    console.error('[Planner] JSON 解析失败:', err.message)
    console.error('[Planner] 原始内容:', jsonMatch[0].slice(0, 200))
    return null
  }
}

/**
 * 验证并规范化 QueryPlan
 * @param {Object} plan - 原始解析的 plan
 * @returns {Object} 规范化后的 QueryPlan
 */
function validateAndNormalize(plan) {
  if (!plan || typeof plan !== 'object') {
    return { ...QUERY_PLAN_DEFAULTS }
  }
  
  const normalized = { ...QUERY_PLAN_DEFAULTS }
  
  // query_type
  const validTypes = ['poi_search', 'area_analysis', 'distance_query', 'recommendation', 'path_query', 'clarification_needed']
  if (validTypes.includes(plan.query_type)) {
    normalized.query_type = plan.query_type
  }
  
  // anchor
  if (plan.anchor && typeof plan.anchor === 'object') {
    normalized.anchor = {
      type: ['landmark', 'coordinate', 'area', 'unknown'].includes(plan.anchor.type) 
        ? plan.anchor.type 
        : 'unknown',
      name: plan.anchor.name || null,
      gate: plan.anchor.gate || null,
      direction: plan.anchor.direction || null,
      lat: typeof plan.anchor.lat === 'number' ? plan.anchor.lat : null,
      lon: typeof plan.anchor.lon === 'number' ? plan.anchor.lon : null
    }
  }
  
  // radius_m
  if (typeof plan.radius_m === 'number' && plan.radius_m > 0) {
    normalized.radius_m = Math.min(plan.radius_m, 10000) // 最大 10km
  }
  
  // categories
  if (Array.isArray(plan.categories)) {
    normalized.categories = plan.categories.filter(c => typeof c === 'string').slice(0, 10)
  }
  
  // rating_range
  if (Array.isArray(plan.rating_range) && plan.rating_range.length === 2) {
    normalized.rating_range = [
      typeof plan.rating_range[0] === 'number' ? plan.rating_range[0] : null,
      typeof plan.rating_range[1] === 'number' ? plan.rating_range[1] : null
    ]
  }
  
  // semantic_query
  if (typeof plan.semantic_query === 'string') {
    normalized.semantic_query = plan.semantic_query.slice(0, 200)
  }
  
  // max_results
  if (typeof plan.max_results === 'number' && plan.max_results > 0) {
    normalized.max_results = Math.min(plan.max_results, 50)
  }
  
  // sort_by
  if (['distance', 'rating', 'relevance'].includes(plan.sort_by)) {
    normalized.sort_by = plan.sort_by
  }
  
  // 布尔开关
  normalized.need_global_context = !!plan.need_global_context
  normalized.need_landmarks = !!plan.need_landmarks
  normalized.need_graph_reasoning = !!plan.need_graph_reasoning
  
  // aggregation_strategy
  if (plan.aggregation_strategy) {
    normalized.aggregation_strategy = {
      enable: !!plan.aggregation_strategy.enable,
      method: 'h3',
      resolution: plan.aggregation_strategy.resolution || 9,
      max_bins: plan.aggregation_strategy.max_bins || 50
    }
  }

  // sampling_strategy
  if (plan.sampling_strategy) {
    normalized.sampling_strategy = {
      enable: !!plan.sampling_strategy.enable,
      method: plan.sampling_strategy.method || 'representative',
      count: plan.sampling_strategy.count || 20,
      rules: Array.isArray(plan.sampling_strategy.rules) ? plan.sampling_strategy.rules : ['diversity']
    }
  }

  // clarification_question
  if (typeof plan.clarification_question === 'string') {
    normalized.clarification_question = plan.clarification_question
  }
  
  return normalized
}

/**
 * 阶段 1 主入口：解析用户意图
 * 
 * @param {string} userQuestion - 用户问题
 * @param {Object} context - 上下文信息
 *   @param {boolean} context.hasSelectedArea - 是否已选区域
 *   @param {number} context.poiCount - 选区内 POI 数量
 *   @param {string[]} context.selectedCategories - 已选类别
 *   @param {Object} context.viewportCenter - 当前视图中心 {lat, lon}
 * @returns {Promise<{success: boolean, queryPlan: Object, error?: string, tokenUsage?: Object}>}
 */
export async function parseIntent(userQuestion, context = {}) {
  const startTime = Date.now()
  
  console.log(`[Planner] 开始解析意图: "${userQuestion.slice(0, 50)}..."`)
  
  // 构建上下文
  const contextStr = buildContextString(context)
  const systemPrompt = PLANNER_SYSTEM_PROMPT.replace('{context}', contextStr)
  
  try {
    // 获取 LLM 配置（自动选择本地或云端）
    const { baseUrl, model, apiKey, isLocal } = await getLLMConfig()
    
    console.log(`[Planner] 使用 ${isLocal ? '本地' : '云端'} 模型: ${model}`)
    
    // 构建请求头
    const headers = { 'Content-Type': 'application/json' }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }
    
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userQuestion }
        ],
        temperature: 0.1,  // 低温度保证输出稳定
        max_tokens: 500,   // 限制输出 token
      }),
    })
    
    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status} ${response.statusText}`)
    }
    
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    
    // 提取并解析 JSON
    const rawPlan = extractJSON(content)
    const queryPlan = validateAndNormalize(rawPlan)
    
    const duration = Date.now() - startTime
    console.log(`[Planner] 解析完成 (${duration}ms): ${queryPlan.query_type}`)
    console.log(`[Planner] QueryPlan:`, JSON.stringify(queryPlan).slice(0, 200))
    
    return {
      success: true,
      queryPlan,
      tokenUsage: data.usage,
      duration
    }
  } catch (err) {
    console.error('[Planner] 意图解析失败:', err.message)
    
    // 返回默认的区域分析 plan
    return {
      success: false,
      error: err.message,
      queryPlan: {
        ...QUERY_PLAN_DEFAULTS,
        query_type: 'area_analysis',
        need_global_context: true,
        need_landmarks: true
      }
    }
  }
}

/**
 * 快速意图分类（不调用 LLM，用于简单场景）
 * @param {string} question - 用户问题
 * @returns {Object} 简化的 QueryPlan
 */
export function quickIntentClassify(question) {
  const q = question.toLowerCase()
  const plan = { ...QUERY_PLAN_DEFAULTS }
  
  // 区域分析关键词
  if (q.includes('分析') || q.includes('分布') || q.includes('特征') || q.includes('概况')) {
    plan.query_type = 'area_analysis'
    plan.need_global_context = true
    plan.need_landmarks = true
    plan.aggregation_strategy = { enable: true, method: 'h3', resolution: 9, max_bins: 50 }
    plan.sampling_strategy = { enable: true, method: 'representative', count: 20, rules: ['diversity'] }
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
  plan.need_global_context = true
  return plan
}

export default {
  parseIntent,
  quickIntentClassify,
  QUERY_PLAN_DEFAULTS
}
