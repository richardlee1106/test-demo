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
  need_global_context: false,
  need_landmarks: false,
  need_graph_reasoning: false,
  clarification_question: null
}

/**
 * Planner System Prompt
 * 严格约束 LLM 只做意图解析，不做回答
 */
const PLANNER_SYSTEM_PROMPT = `你是一个"空间查询规划器"，职责是把用户的问题转换为结构化查询计划 JSON。

## 严格规则
1. **只输出 JSON**，不要任何解释、Markdown 标记或额外文本
2. 分析用户问题中的：
   - 锚点信息（地名、地标、门，如"武汉理工大学南门"）
   - 距离条件（半径/步行时间，统一转成米，步行5分钟约400米）
   - 类别（如咖啡馆、蛋糕店、餐饮、教育等）
   - 评分/价格等数值条件
   - 语义偏好（如"环境安静"、"适合学习"、"人少"）
   - 是否需要区域画像（如"这附近以什么为主？"、"分析一下"）
   - 是否涉及路径/连通性（如"从A到B怎么走"）

## 默认值规则
- 半径未指定但说"最近的"或"离XXX最近"：2000 米（确保能找到结果）
- 半径未指定但说"附近"：1000 米
- 半径未指定但说"周边"：2000 米
- 如果用户没有指定距离条件，默认使用 1000 米
- 评分未指定：不限制，rating_range 为 [null, null]
- 结果数未指定：20
- 如果用户问"最近的一个"，max_results 应该为 5（多返回几个以防第一个不合适）

## 语义类别映射（重要！）
将用户口语化表达映射到实际类别：
- "好玩的"、"玩的地方"、"娱乐" → categories: ["景点", "公园", "游乐园", "电影院", "KTV", "网吧", "桌游", "密室逃脱", "娱乐"]
- "吃的"、"美食"、"吃饭" → categories: ["餐饮", "中餐", "快餐", "小吃", "火锅", "烧烤"]
- "喝的"、"饮品" → categories: ["咖啡", "奶茶", "饮品", "茶馆", "酒吧"]
- "买东西"、"购物" → categories: ["商场", "超市", "便利店", "购物"]
- "休闲"、"放松" → categories: ["公园", "广场", "景点", "spa", "按摩", "休闲"]
- "学习"、"看书" → categories: ["图书馆", "书店", "自习室", "咖啡馆"]
- "运动"、"健身" → categories: ["体育馆", "健身房", "游泳馆", "球场", "运动"]

## JSON 结构
{
  "query_type": "poi_search" | "area_analysis" | "distance_query" | "recommendation" | "path_query" | "clarification_needed",
  "anchor": {
    "type": "landmark" | "coordinate" | "area" | "unknown",
    "name": "地名或null",
    "gate": "门名或null",
    "direction": "方向如'对面'或null"
  },
  "radius_m": 数字或null,
  "categories": ["类别1", "类别2"],
  "rating_range": [最低分或null, 最高分或null],
  "semantic_query": "语义关键词",
  "max_results": 数字,
  "sort_by": "distance" | "rating" | "relevance" | null,
  "need_global_context": true/false,
  "need_landmarks": true/false,
  "need_graph_reasoning": true/false,
  "clarification_question": "需要澄清时的问题或null"
}

## 上下文信息
{context}

## 示例

用户问："青鱼嘴地铁站附近有蛋糕店吗？"
输出：
{"query_type":"poi_search","anchor":{"type":"landmark","name":"青鱼嘴地铁站","gate":null,"direction":null},"radius_m":1000,"categories":["蛋糕店","甜品","烘焙"],"rating_range":[null,null],"semantic_query":"","max_results":10,"sort_by":"distance","need_global_context":false,"need_landmarks":true,"need_graph_reasoning":false,"clarification_question":null}

用户问："分析一下当前区域的商业分布特征"
输出：
{"query_type":"area_analysis","anchor":{"type":"area","name":null,"gate":null,"direction":null},"radius_m":null,"categories":[],"rating_range":[null,null],"semantic_query":"商业分布","max_results":20,"sort_by":null,"need_global_context":true,"need_landmarks":true,"need_graph_reasoning":false,"clarification_question":null}

用户问："武理工南门对面500m内评分4.5以上环境安静的咖啡馆"
输出：
{"query_type":"poi_search","anchor":{"type":"landmark","name":"武汉理工大学","gate":"南门","direction":"对面"},"radius_m":500,"categories":["咖啡馆","咖啡厅"],"rating_range":[4.5,null],"semantic_query":"环境安静","max_results":10,"sort_by":"rating","need_global_context":false,"need_landmarks":false,"need_graph_reasoning":false,"clarification_question":null}`

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
