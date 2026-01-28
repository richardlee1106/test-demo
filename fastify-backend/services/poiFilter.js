/**
 * Phase 3 优化：POI 智能过滤器
 * 
 * 实现"条件性黑名单"机制：
 * - 默认情况下过滤低价值 POI（公厕、配电房等）
 * - 当用户明确查询这些类别时，自动豁免
 * 
 * 设计原则：
 * - 用户问"附近好吃的" → 过滤公厕
 * - 用户问"厕所在哪" → 不过滤，返回厕所
 */

/**
 * 默认黑名单配置
 * 
 * 这些类别在泛化查询（如"附近有什么"）时会被过滤
 * 但如果用户明确查询，则会被豁免
 */
export const DEFAULT_BLOCKLIST = {
  // 类别关键词（匹配 category_small, category_mid, category_big）
  categories: [
    '公共厕所', '公厕', '卫生间', '洗手间',
    '配电房', '配电室', '变电站', '变电所',
    '垃圾站', '垃圾房', '垃圾处理',
    '传达室', '门卫室', '保安室',
    '消防栓', '消防通道',
    '停车场出入口', '地下车库入口',
    '信号塔', '通信基站',
    '污水处理', '化粪池',
    '仓库', '储物间',
    'ATM', '自动取款机', // 通常不作为推荐目标
  ],
  
  // 名称关键词（匹配 POI 名称）
  namePatterns: [
    /^公厕/,
    /^公共厕所/,
    /配电房$/,
    /配电室$/,
    /垃圾站$/,
    /传达室$/,
    /门卫室$/,
    /^无名/,  // 无名道路、无名小区等
    /^未命名/,
  ]
}

/**
 * 触发词映射表
 * 
 * 当用户查询包含这些词时，对应的黑名单类别会被豁免
 * key: 用户可能使用的查询词
 * value: 对应需要豁免的黑名单关键词
 */
export const EXEMPTION_TRIGGERS = {
  // 厕所相关
  '厕所': ['公共厕所', '公厕', '卫生间', '洗手间'],
  '洗手间': ['公共厕所', '公厕', '卫生间', '洗手间'],
  '卫生间': ['公共厕所', '公厕', '卫生间', '洗手间'],
  '公厕': ['公共厕所', '公厕', '卫生间', '洗手间'],
  '上厕所': ['公共厕所', '公厕', '卫生间', '洗手间'],
  '方便': ['公共厕所', '公厕', '卫生间', '洗手间'],
  
  // 充电/换电相关
  '换电站': ['换电站', '换电'],
  '充电站': ['充电站', '充电桩'],
  '充电桩': ['充电站', '充电桩'],
  '加油站': ['加油站'],
  
  // 停车相关
  '停车': ['停车场', '停车场出入口', '地下车库入口'],
  '停车场': ['停车场', '停车场出入口', '地下车库入口'],
  '车位': ['停车场', '停车场出入口'],
  
  // ATM 相关
  'ATM': ['ATM', '自动取款机'],
  '取款': ['ATM', '自动取款机'],
  '取钱': ['ATM', '自动取款机'],
  
  // 基础设施分析（规划师可能会问）
  '基础设施': ['配电房', '配电室', '变电站', '垃圾站', '污水处理'],
  '市政设施': ['配电房', '配电室', '变电站', '垃圾站', '污水处理'],
  '配电': ['配电房', '配电室', '变电站', '变电所'],
  '垃圾': ['垃圾站', '垃圾房', '垃圾处理'],
}

/**
 * 检测用户查询是否明确指向某个黑名单类别
 * 
 * @param {string} userQuestion - 用户原始问题
 * @param {Array} plannerCategories - Planner 解析出的类别列表
 * @returns {Object} { shouldExempt: boolean, exemptedKeywords: string[] }
 */
export function detectExemption(userQuestion, plannerCategories = []) {
  const exemptedKeywords = new Set()
  const questionLower = userQuestion.toLowerCase()
  
  // 方式1: 检查用户问题中是否包含触发词
  for (const [trigger, keywords] of Object.entries(EXEMPTION_TRIGGERS)) {
    if (questionLower.includes(trigger.toLowerCase())) {
      keywords.forEach(kw => exemptedKeywords.add(kw))
    }
  }
  
  // 方式2: 检查 Planner 解析出的类别是否在黑名单中
  // 如果 Planner 明确识别出用户想查"公厕"，则豁免
  plannerCategories.forEach(cat => {
    const catLower = cat.toLowerCase()
    DEFAULT_BLOCKLIST.categories.forEach(blocked => {
      if (catLower.includes(blocked.toLowerCase()) || blocked.toLowerCase().includes(catLower)) {
        exemptedKeywords.add(blocked)
      }
    })
  })
  
  const shouldExempt = exemptedKeywords.size > 0
  
  if (shouldExempt) {
    console.log(`[POI Filter] 检测到明确查询，豁免关键词: ${[...exemptedKeywords].join(', ')}`)
  }
  
  return {
    shouldExempt,
    exemptedKeywords: [...exemptedKeywords]
  }
}

/**
 * 获取当前有效的黑名单（排除豁免项）
 * 
 * @param {string[]} exemptedKeywords - 需要豁免的关键词
 * @returns {Object} 过滤后的黑名单配置
 */
export function getActiveBlocklist(exemptedKeywords = []) {
  const exemptSet = new Set(exemptedKeywords.map(k => k.toLowerCase()))
  
  return {
    categories: DEFAULT_BLOCKLIST.categories.filter(
      cat => !exemptSet.has(cat.toLowerCase())
    ),
    namePatterns: DEFAULT_BLOCKLIST.namePatterns
  }
}

/**
 * 过滤 POI 列表，移除黑名单中的低价值点
 * 
 * @param {Array} pois - POI 列表
 * @param {Object} options - 选项
 * @param {string} options.userQuestion - 用户问题（用于检测豁免）
 * @param {string[]} options.plannerCategories - Planner 解析的类别
 * @param {boolean} options.strict - 是否严格模式（默认 true）
 * @returns {Object} { filtered: Array, removed: number, exempted: string[] }
 */
export function filterPOIs(pois, options = {}) {
  const { 
    userQuestion = '', 
    plannerCategories = [],
    strict = true 
  } = options
  
  if (!strict || !pois || pois.length === 0) {
    return { filtered: pois, removed: 0, exempted: [] }
  }
  
  // 检测是否需要豁免
  const { exemptedKeywords } = detectExemption(userQuestion, plannerCategories)
  const blocklist = getActiveBlocklist(exemptedKeywords)
  
  const originalCount = pois.length
  
  const filtered = pois.filter(poi => {
    const props = poi.properties || poi
    const name = (props.name || poi.name || '').toLowerCase()
    const categorySmall = (props['小类'] || props.category_small || '').toLowerCase()
    const categoryMid = (props['中类'] || props.category_mid || '').toLowerCase()
    const categoryBig = (props['大类'] || props.category_big || '').toLowerCase()
    const category = (poi.category || '').toLowerCase()
    
    // 检查类别是否在黑名单中
    for (const blocked of blocklist.categories) {
      const blockedLower = blocked.toLowerCase()
      if (
        categorySmall.includes(blockedLower) ||
        categoryMid.includes(blockedLower) ||
        categoryBig.includes(blockedLower) ||
        category.includes(blockedLower)
      ) {
        return false // 过滤掉
      }
    }
    
    // 检查名称是否匹配黑名单模式
    for (const pattern of blocklist.namePatterns) {
      if (pattern.test(name)) {
        return false // 过滤掉
      }
    }
    
    return true // 保留
  })
  
  const removed = originalCount - filtered.length
  
  if (removed > 0) {
    console.log(`[POI Filter] 过滤了 ${removed} 个低价值 POI (${originalCount} → ${filtered.length})`)
  }
  
  return {
    filtered,
    removed,
    exempted: exemptedKeywords
  }
}

/**
 * 快速检查单个 POI 是否应该被过滤
 * 
 * @param {Object} poi - 单个 POI
 * @param {string[]} exemptedKeywords - 豁免关键词
 * @returns {boolean} true = 保留, false = 过滤
 */
export function shouldKeepPOI(poi, exemptedKeywords = []) {
  const blocklist = getActiveBlocklist(exemptedKeywords)
  
  const props = poi.properties || poi
  const name = (props.name || poi.name || '').toLowerCase()
  const category = (
    props['小类'] || props.category_small ||
    props['中类'] || props.category_mid ||
    poi.category || ''
  ).toLowerCase()
  
  // 检查类别
  for (const blocked of blocklist.categories) {
    if (category.includes(blocked.toLowerCase())) {
      return false
    }
  }
  
  // 检查名称模式
  for (const pattern of blocklist.namePatterns) {
    if (pattern.test(name)) {
      return false
    }
  }
  
  return true
}

export default {
  DEFAULT_BLOCKLIST,
  EXEMPTION_TRIGGERS,
  detectExemption,
  getActiveBlocklist,
  filterPOIs,
  shouldKeepPOI
}
