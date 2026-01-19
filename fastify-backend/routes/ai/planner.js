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
  intent_mode: null, // 'macro_overview' | 'local_search'
  anchor: {
    type: 'unknown',
    name: null,
    gate: null,
    direction: null,
    lat: null,
    lon: null
  },
  radius_m: 3000,  // 增加默认半径
  categories: [],
  rating_range: [null, null],
  semantic_query: '',
  max_results: 30,  // 增加默认结果数
  sort_by: 'distance',
  
  // 三通道核心配置
  aggregation_strategy: {
    enable: false,
    method: 'h3',       // 'h3' | 'cluster' | 'administrative'
    resolution: 9,      // H3 分辨率
    max_bins: 60        // 传给 Writer 的最大网格/聚类数 (增加)
  },
  sampling_strategy: {
    enable: false,
    method: 'representative', // 'representative' | 'random' | 'top_k'
    count: 50,                // 默认 50，支持 coarse aggregation
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

## 核心职责：区分"宏观概括"与"微观检索"
这是最关键的决策！你必须判断用户是想看**整体区域的统计特征**，还是想找**具体的点**。

### 模式 A: 宏观概括 (Macro Overview) / query_type="area_analysis"
- **用户意图**：了解区域整体情况、分布规律、业态结构、交通便利度等。
- **典型提问**："分析这片区域"、"这里有什么特点"、"交通怎么样"、"商业分布如何"。
- **配置**：
  - \`query_type\`: "area_analysis"
  - \`intent_mode\`: "macro_overview"
  - \`aggregation_strategy.enable\`: true (必须开启! 看统计数据)
  - \`radius_m\`: 3000 ~ 5000 (大范围)
  - \`sampling_strategy.enable\`: true (选代表点)
  - \`categories\`: 
    - 问"交通": ["公交站", "地铁站", "停车场", ...]
    - 问"商业": ["商场", "超市", ...]
    - 问"整体": [] (空数组代表全域)

### 模式 B: 微观检索 (Local Search) / query_type="poi_search"
- **用户意图**：寻找特定的店、设施，或者查询某个具体地点周边的信息。
- **典型提问**："附近有好吃的吗"、"找最近的咖啡馆"、"武汉大学附近有什么"、"哪里有停车场"。
- **配置**：
  - \`query_type\`: "poi_search"
  - \`intent_mode\`: "local_search"
  - \`aggregation_strategy.enable\`: false (看明细!)
  - \`radius_m\`: 500 ~ 1500 (小范围)
  - \`categories\`: 必须指定具体类别! (如 ["咖啡厅", "中餐厅"])
  - \`max_results\`: 10 ~ 20

## JSON 结构定义
{
  "query_type": "area_analysis" | "poi_search" | "distance_query",
  "intent_mode": "macro_overview" | "local_search", // 显式标记意图模式
  "anchor": { ... },
  "radius_m": number,
  "categories": ["cat1", "cat2"], 
  "semantic_query": "...", // 用于 pgvector 搜索
  
  "aggregation_strategy": {
    "enable": boolean,
    "method": "h3",
    "resolution": number
  },
  
  "sampling_strategy": { ... }
}

## 类别映射表 (必须严格遵守)
| 领域 | 关键词 | categories |
|---|---|---|
| **交通/通勤** | 交通,出行,公交,地铁,停车 | ["公交站", "地铁站", "停车场", "加油站", "火车站"] |
| **教育/学校** | 教育,上学,学校,培训 | ["学校", "幼儿园", "小学", "中学", "大学", "培训机构"] |
| **医疗/健康** | 医院,看病,药店 | ["医院", "诊所", "药店", "社区卫生服务中心"] |
| **购物/商业** | 购物,商场,买东西 | ["商场", "购物中心", "超市", "便利店"] |
| **餐饮/美食** | 吃饭,好吃的,餐厅 | ["餐厅", "中餐厅", "快餐", "小吃", "咖啡厅"] |

## 决策逻辑
1. **关键词匹配**：
   - 有"分析"、"概况"、"特征"、"分布"、"便利度" → **Macro Overview**
   - 有"附近"、"最近"、"找..."、"哪里有" → **Local Search**

2. **语义推断**：
   - "评估当前区域交通" → Area Analysis (Traffic Topic)
   - "最近的地铁站在哪" → POI Search (Traffic Topic)

3. **Pgvector 触发**：
   - 凡是意图模糊或涉及形容词（"好玩的", "高档的"），必须生成 \`semantic_query\`。

## 示例

用户："评估当前区域的交通便利程度"
输出：
{
  "query_type": "area_analysis",
  "intent_mode": "macro_overview",
  "categories": ["公交站", "地铁站", "停车场", "加油站", "火车站"],
  "radius_m": 3000,
  "aggregation_strategy": { "enable": true, "method": "h3", "resolution": 9 },
  "sampling_strategy": { "enable": true, "count": 25 },
  "semantic_query": "交通便利度 交通枢纽 公交站 地铁站",
  "need_landmarks": true
}

用户："武汉大学附近有什么好吃的"
输出：
{
  "query_type": "poi_search",
  "intent_mode": "local_search",
  "anchor": { "type": "landmark", "name": "武汉大学" },
  "categories": ["餐厅", "中餐厅", "小吃", "快餐"],
  "radius_m": 1000,
  "aggregation_strategy": { "enable": false },
  "semantic_query": "美食 餐厅 好吃的",
  "max_results": 20
}
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
  
  // intent_mode (支持宏观/微观意图)
  if (['macro_overview', 'local_search'].includes(plan.intent_mode)) {
    normalized.intent_mode = plan.intent_mode
  } else {
    // 简单的推断
    if (normalized.query_type === 'poi_search') normalized.intent_mode = 'local_search'
    else if (normalized.query_type === 'area_analysis') normalized.intent_mode = 'macro_overview'
  }
  
  // aggregation_strategy
  if (plan.aggregation_strategy) {
    normalized.aggregation_strategy = {
      enable: !!plan.aggregation_strategy.enable,
      method: 'h3',
      // 允许根据范围动态调整: 大范围用8，小范围用9或10
      resolution: plan.aggregation_strategy.resolution || (normalized.radius_m > 5000 ? 8 : 9),
      max_bins: plan.aggregation_strategy.max_bins || (normalized.radius_m > 5000 ? 60 : 50)
    }
  }

  // sampling_strategy
  if (plan.sampling_strategy) {
    normalized.sampling_strategy = {
      enable: !!plan.sampling_strategy.enable,
      method: plan.sampling_strategy.method || 'representative',
      // 【强制修复】宏观分析模式下，强制设为 50，不管 LLM 说了什么
      count: (normalized.intent_mode === 'macro_overview' || normalized.query_type === 'area_analysis') ? 50 : (plan.sampling_strategy.count || 20),
      rules: Array.isArray(plan.sampling_strategy.rules) ? plan.sampling_strategy.rules : ['diversity']
    }
  }

  // clarification_question
  if (typeof plan.clarification_question === 'string') {
    normalized.clarification_question = plan.clarification_question
  }
  
  // 语义查询增强逻辑
  if (!normalized.semantic_query) {
    if (normalized.intent_mode === 'macro_overview') {
       // 宏观模式：地标优先
       normalized.semantic_query = '具有代表性的地标 购物中心 商场 大厦 广场 公园 医院 学校 交通枢纽'
       console.log('[Planner] 宏观模式：自动生成全域地标语义查询')
    } else if (normalized.intent_mode === 'local_search' && normalized.categories.length > 0) {
       // 微观搜索：基于类别生成 (e.g. "好吃的 餐厅")
       normalized.semantic_query = `好评 ${normalized.categories.join(' ')}`
       console.log('[Planner] 微观模式：自动生成基于类别的语义查询:', normalized.semantic_query)
    }
  }
  
  return normalized
}

/**
 * 根据用户问题自动推断 POI 类别（后备逻辑）
 * 当 LLM 没有正确识别专题时，后端自动补充
 */
function inferCategoriesFromQuestion(question, existingCategories) {
  // 如果已经有非空 categories，直接返回
  if (existingCategories && existingCategories.length > 0) {
    return existingCategories
  }
  
  const q = question.toLowerCase()
  
  // 专题关键词映射表
  const topicMapping = {
    // 交通相关
    traffic: {
      keywords: ['交通', '出行', '通勤', '公交', '地铁', '火车', '机场', '停车'],
      categories: ['公交站', '地铁站', '停车场', '加油站', '高铁站', '火车站', '汽车站', '机场']
    },
    // 教育相关
    education: {
      keywords: ['教育', '学校', '上学', '幼儿园', '小学', '中学', '大学', '培训'],
      categories: ['学校', '幼儿园', '小学', '中学', '高中', '大学', '培训机构', '图书馆']
    },
    // 医疗相关
    medical: {
      keywords: ['医疗', '看病', '就医', '医院', '诊所', '药店', '卫生'],
      categories: ['医院', '诊所', '卫生院', '药店', '社区卫生服务中心']
    },
    // 购物相关
    shopping: {
      keywords: ['购物', '买东西', '商场', '超市', '商业'],
      categories: ['商场', '超市', '购物中心', '百货', '便利店']
    },
    // 餐饮相关
    food: {
      keywords: ['餐饮', '吃饭', '美食', '餐厅', '小吃'],
      categories: ['餐厅', '饭店', '快餐', '小吃', '咖啡', '奶茶']
    },
    // 休闲娱乐
    entertainment: {
      keywords: ['娱乐', '休闲', '玩', '电影', '公园', '景点'],
      categories: ['电影院', 'KTV', '游乐场', '公园', '景区', '健身房']
    },
    // 金融相关
    finance: {
      keywords: ['银行', '金融', 'ATM', '理财'],
      categories: ['银行', 'ATM', '证券', '保险']
    },
    // 住宿相关
    lodging: {
      keywords: ['住宿', '酒店', '宾馆', '民宿'],
      categories: ['酒店', '宾馆', '民宿', '公寓']
    }
  }
  
  // 检测匹配的专题
  for (const [topic, config] of Object.entries(topicMapping)) {
    for (const keyword of config.keywords) {
      if (q.includes(keyword)) {
        console.log(`[Planner] 后备推断：检测到专题 "${topic}"，自动设置 categories`)
        return config.categories
      }
    }
  }
  
  // 没有匹配的专题，返回空数组（全域分析）
  return []
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
    
    // 关键后备逻辑：如果 LLM 没有正确设置 categories，根据问题自动推断
    queryPlan.categories = inferCategoriesFromQuestion(userQuestion, queryPlan.categories)
    
    const duration = Date.now() - startTime
    console.log(`[Planner] 解析完成 (${duration}ms): ${queryPlan.query_type}`)
    console.log(`[Planner] categories: ${queryPlan.categories.join(', ') || '(全域分析)'}`)
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
  
  // 1. 明确的微观检索 (Local Search)
  // 关键词：附近、周围、周边、最近、找、哪里有、有没有、推荐几个
  const localKeywords = ['附近', '周围', '周边', '最近', '找', '哪里有', '有没有', '推荐几个']
  if (localKeywords.some(kw => q.includes(kw))) {
    plan.query_type = 'poi_search'
    plan.intent_mode = 'local_search'
    plan.radius_m = 1000 // 默认小范围
    plan.aggregation_strategy.enable = false // 不聚合，看明细
    
    // 尝试提取类别
    const categories = inferCategoriesFromQuestion(q, [])
    if (categories.length > 0) {
      plan.categories = categories
    } else {
      // 尝试从问题中截取（简单启发式）
      const match = q.match(/(?:找|哪里有|有没有)(.+)/)
      if (match) {
        plan.semantic_query = match[1].trim()
      }
    }
    return plan
  }
  
  // 2. 明确的宏观分析 (Macro Overview)
  // 关键词：分析、概况、特征、规律、分布、评估、怎么样、如何、特点、报告
  const macroKeywords = ['分析', '概况', '特征', '规律', '分布', '评估', '怎么样', '如何', '特点', '报告']
  if (macroKeywords.some(kw => q.includes(kw))) {
    plan.query_type = 'area_analysis'
    plan.intent_mode = 'macro_overview'
    plan.radius_m = 3000 // 默认大范围
    
    // 必须开启聚合
    plan.aggregation_strategy = { enable: true, method: 'h3', resolution: 9, max_bins: 60 }
    plan.sampling_strategy = { enable: true, method: 'representative', count: 50, rules: ['diversity'] }
    plan.need_global_context = true
    plan.need_landmarks = true
    
    // 专题推断
    plan.categories = inferCategoriesFromQuestion(q, [])
    return plan
  }
  
  // 3. 默认兜底：倾向于分析，但不做强假设
  plan.query_type = 'area_analysis'
  plan.intent_mode = 'macro_overview' // 默认为宏观
  plan.categories = inferCategoriesFromQuestion(q, [])
  
  return plan
}

export default {
  parseIntent,
  quickIntentClassify,
  QUERY_PLAN_DEFAULTS
}
