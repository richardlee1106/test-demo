/**
 * 三阶段 Spatial-RAG 管道协调器
 * 
 * 架构设计：
 * ┌──────────────────────────────────────────────────────────────┐
 * │ 阶段1: Planner (LLM)                                         │
 * │   用户问题 → LLM → QueryPlan JSON                             │
 * │   (不看任何 POI 数据，只解析意图)                              │
 * ├──────────────────────────────────────────────────────────────┤
 * │ 阶段2: Executor (后端)                                        │
 * │   QueryPlan → PostGIS + Milvus + 图库 → 压缩结果              │
 * │   (所有计算在数据库完成，不调 LLM)                             │
 * ├──────────────────────────────────────────────────────────────┤
 * │ 阶段3: Writer (LLM)                                          │
 * │   压缩结果 → LLM → 自然语言回答                                │
 * │   (只看少量结果，Token 可控)                                   │
 * └──────────────────────────────────────────────────────────────┘
 * 
 * Token 控制策略：
 * - Planner: < 500 tokens
 * - Executor: 0 tokens (纯后端)
 * - Writer: < 2000 tokens
 * - 总计: < 2500 tokens/请求
 */

import { parseIntent, quickIntentClassify, QUERY_PLAN_DEFAULTS } from './planner.js'
import { executeQuery } from './executor.js'
import { generateAnswer, buildQuickReply } from './writer.js'

/**
 * 管道配置
 */
const PIPELINE_CONFIG = {
  // 是否启用快速模式（跳过 Planner LLM 调用）
  enableQuickMode: false,
  
  // 快速模式触发条件：POI 数量阈值
  quickModeThreshold: 50,
  
  // 是否记录详细日志
  verboseLogging: true,
  
  // 阶段超时（毫秒）
  stageTimeout: {
    planner: 10000,
    executor: 15000,
    writer: 30000
  }
}

/**
 * 管道执行统计
 */
class PipelineStats {
  constructor() {
    this.startTime = Date.now()
    this.stages = {}
  }
  
  startStage(name) {
    this.stages[name] = { start: Date.now() }
  }
  
  endStage(name, extra = {}) {
    if (this.stages[name]) {
      this.stages[name].duration = Date.now() - this.stages[name].start
      this.stages[name] = { ...this.stages[name], ...extra }
    }
  }
  
  getSummary() {
    return {
      total_duration: Date.now() - this.startTime,
      stages: this.stages
    }
  }
}

/**
 * 完整的三阶段管道执行（流式）
 * 
 * @param {string} userQuestion - 用户问题
 * @param {Array} frontendPOIs - 前端传来的 POI 数据
 * @param {Object} options - 选项
 *   @param {boolean} options.quickMode - 是否启用快速模式
 *   @param {Object} options.context - 额外上下文
 * @yields {string} 流式文本块
 */
export async function* executePipeline(userQuestion, frontendPOIs = [], options = {}) {
  const stats = new PipelineStats()
  const session = options.session // 从 options 中获取 RAG Session
  
  // 构建上下文
  const context = {
    hasSelectedArea: frontendPOIs.length > 0,
    poiCount: frontendPOIs.length,
    selectedCategories: extractCategories(frontendPOIs),
    ...options.context
  }
  
  if (PIPELINE_CONFIG.verboseLogging) {
    console.log('\n' + '='.repeat(60))
    console.log('[Pipeline] 开始处理')
    console.log(`[Pipeline] 问题: "${userQuestion.slice(0, 80)}${userQuestion.length > 80 ? '...' : ''}"`)
    console.log(`[Pipeline] POI 数量: ${frontendPOIs.length}`)
    console.log('='.repeat(60))
  }
  
  // ========================================
  // 阶段 1: Planner - 意图解析
  // ========================================
  stats.startStage('planner')
  
  let queryPlan
  const useQuickMode = options.quickMode || 
    (PIPELINE_CONFIG.enableQuickMode && frontendPOIs.length < PIPELINE_CONFIG.quickModeThreshold)
  
  if (useQuickMode) {
    // 快速模式：跳过 LLM，使用规则匹配
    console.log('[Pipeline] 阶段1 (快速模式): 规则意图分类')
    queryPlan = quickIntentClassify(userQuestion)
  } else {
    // 正常模式：调用 LLM
    console.log('[Pipeline] 阶段1: LLM 意图解析...')
    const plannerResult = await parseIntent(userQuestion, context)
    queryPlan = plannerResult.queryPlan
    
    stats.endStage('planner', {
      success: plannerResult.success,
      query_type: queryPlan.query_type,
      token_usage: plannerResult.tokenUsage
    })
  }
  
  console.log(`[Pipeline] 阶段1完成: ${queryPlan.query_type}`)
  console.log(`[Pipeline] QueryPlan: ${JSON.stringify(queryPlan).slice(0, 150)}...`)
  
  // 记录 Planner 结果到 session
  if (session) {
    session.setIntent(queryPlan)
  }
  
  // 检查是否需要澄清
  if (queryPlan.query_type === 'clarification_needed' && queryPlan.clarification_question) {
    console.log('[Pipeline] 需要澄清，直接返回澄清问题')
    yield queryPlan.clarification_question
    return
  }
  
  // ========================================
  // 阶段 2: Executor - 数据库执行
  // ========================================
  stats.startStage('executor')
  console.log('[Pipeline] 阶段2: 数据库执行...')
  
  const executorResult = await executeQuery(queryPlan, frontendPOIs, options)
  
  stats.endStage('executor', {
    success: executorResult.success,
    poi_count: executorResult.results?.pois?.length || 0,
    mode: executorResult.results?.mode
  })
  
  console.log(`[Pipeline] 阶段2完成: ${executorResult.results?.pois?.length || 0} POIs, 模式: ${executorResult.results?.mode}`)
  
  // 记录 Executor 结果到 session
  if (session) {
    // 记录空间追觅踪迹
    const trace = executorResult.results?.stats?.spatial_trace
    if (trace) {
      session.log('Executor', 'SpatialDecision', trace)
    }

    // 记录详细调试信息 (暴露给前端)
    const debugInfo = executorResult.results?.stats?.debug_info
    if (debugInfo && debugInfo.length > 0) {
      session.log('Executor', 'DebugDetail', debugInfo)
    }

    // 检查是否调用了数据库

    // 检查是否调用了数据库
    if (executorResult.results?.anchor) {
      session.log('PostGIS', 'SpatialQuery', { 
        anchor: executorResult.results.anchor.name,
        source: executorResult.results.anchor.resolved_from,
        poiCount: executorResult.results?.pois?.length || 0
      })
    }
    // 检查是否调用了 Milvus
    if (executorResult.results?.stats?.semantic_rerank_applied) {
      session.log('Milvus', 'SemanticRerank', { applied: true })
    }
    // 记录最终 POI
    if (executorResult.results?.pois?.length > 0) {
      session.setFinalPOIs(executorResult.results.pois)
    }
  }
  
  // 如果执行失败，返回错误信息
  if (!executorResult.success) {
    yield `抱歉，查询过程中出现问题: ${executorResult.error || '未知错误'}。请稍后重试。`
    return
  }
  
  // 如果是纯搜索模式（仅获取 POI 数据），跳过 Writer 生成
  if (options.isSearchOnly) {
    console.log('[Pipeline] 纯搜索模式: 跳过 Writer 阶段')
    stats.endStage('writer', { skipped: true })
    return
  }

  // ========================================
  // 阶段 3: Writer - 生成回答
  // ========================================
  stats.startStage('writer')
  console.log('[Pipeline] 阶段3: 生成回答...')
  
  // 将 queryPlan 附加到结果中，供 Writer 参考
  executorResult.results.query_executed = queryPlan
  
  let charCount = 0
  for await (const chunk of generateAnswer(userQuestion, executorResult, options)) {
    charCount += chunk.length
    yield chunk
  }
  
  stats.endStage('writer', {
    char_count: charCount
  })
  
  // ========================================
  // 完成统计
  // ========================================
  const summary = stats.getSummary()
  
  if (PIPELINE_CONFIG.verboseLogging) {
    console.log('\n' + '='.repeat(60))
    console.log('[Pipeline] 执行完成')
    console.log(`[Pipeline] 总耗时: ${summary.total_duration}ms`)
    console.log('[Pipeline] 各阶段:')
    Object.entries(summary.stages).forEach(([name, data]) => {
      console.log(`  - ${name}: ${data.duration}ms`)
    })
    console.log('='.repeat(60) + '\n')
  }
}

/**
 * 非流式管道执行（用于测试）
 * 
 * @param {string} userQuestion - 用户问题
 * @param {Array} frontendPOIs - 前端 POI 数据
 * @param {Object} options - 选项
 * @returns {Promise<{answer: string, stats: Object}>}
 */
export async function executePipelineSync(userQuestion, frontendPOIs = [], options = {}) {
  let answer = ''
  
  for await (const chunk of executePipeline(userQuestion, frontendPOIs, options)) {
    answer += chunk
  }
  
  return { answer }
}

/**
 * 仅执行阶段 1 和 2（用于调试或预检）
 * 
 * @param {string} userQuestion - 用户问题
 * @param {Array} frontendPOIs - 前端 POI 数据
 * @param {Object} context - 上下文
 * @returns {Promise<{queryPlan: Object, executorResult: Object}>}
 */
export async function executePlanAndQuery(userQuestion, frontendPOIs = [], context = {}) {
  // 阶段 1
  const { queryPlan } = await parseIntent(userQuestion, {
    hasSelectedArea: frontendPOIs.length > 0,
    poiCount: frontendPOIs.length,
    ...context
  })
  
  // 阶段 2
  const executorResult = await executeQuery(queryPlan, frontendPOIs)
  
  return { queryPlan, executorResult }
}

/**
 * 从 POI 数组中提取类别列表
 */
function extractCategories(pois) {
  const categories = new Set()
  
  for (const poi of pois.slice(0, 100)) { // 只检查前 100 个
    const props = poi.properties || poi
    if (props['大类']) categories.add(props['大类'])
  }
  
  return [...categories]
}

// =====================================================
// 导出原有函数以保持向后兼容
// =====================================================

// 重新导出各阶段函数
export { parseIntent } from './planner.js'
export { executeQuery } from './executor.js'
export { generateAnswer, buildQuickReply } from './writer.js'

export default {
  executePipeline,
  executePipelineSync,
  executePlanAndQuery,
  PIPELINE_CONFIG
}
