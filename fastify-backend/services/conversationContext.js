/**
 * Phase 2 优化：多轮对话上下文管理器
 * 
 * 职责：
 * - 维护对话历史
 * - 实现代词消解（如 "那附近" → 上次提到的位置）
 * - 追踪上次提及的 POIs 和位置
 * - 支持上下文衔接
 */

// 会话存储（简单内存实现，生产环境应使用 Redis）
const sessionStore = new Map()

// 会话过期时间（毫秒）
const SESSION_TTL = 30 * 60 * 1000 // 30 分钟

/**
 * 空间对话上下文类
 */
export class SpatialConversationContext {
  constructor(sessionId) {
    this.sessionId = sessionId
    this.history = [] // 对话历史
    this.lastMentionedLocation = null // 上次提到的位置
    this.lastMentionedPOIs = [] // 上次返回的 POI 列表
    this.lastQueryPlan = null // 上次的查询计划
    this.lastAnchor = null // 上次的锚点
    this.createdAt = Date.now()
    this.lastAccessedAt = Date.now()
  }

  /**
   * 添加一轮对话
   * @param {Object} turn - 对话轮次
   */
  addTurn(turn) {
    this.lastAccessedAt = Date.now()
    
    const record = {
      timestamp: Date.now(),
      question: turn.question,
      queryPlan: turn.queryPlan,
      anchor: turn.anchor,
      pois: turn.pois || [],
      summary: turn.summary
    }
    
    this.history.push(record)
    
    // 只保留最近 10 轮
    if (this.history.length > 10) {
      this.history.shift()
    }
    
    // 更新上下文信息
    if (turn.anchor) {
      this.lastMentionedLocation = {
        name: turn.anchor.name,
        lon: turn.anchor.lon,
        lat: turn.anchor.lat
      }
      this.lastAnchor = turn.anchor
    }
    
    if (turn.pois && turn.pois.length > 0) {
      this.lastMentionedPOIs = turn.pois.slice(0, 20) // 只保留前 20 个
    }
    
    if (turn.queryPlan) {
      this.lastQueryPlan = turn.queryPlan
    }
  }

  /**
   * 消解代词和指示词
   * 
   * 例如：
   * - "那附近" → 替换为上次的位置
   * - "它们" → 替换为上次的 POI 列表
   * - "之前提到的" → 引用历史
   * 
   * @param {string} question - 原始问题
   * @returns {Object} { resolvedQuestion, substitutions, needsContext }
   */
  resolvePronouns(question) {
    let resolvedQuestion = question
    const substitutions = []
    let needsContext = false

    // 模式 1: "那附近"、"那里"、"那个位置" → 上次的位置
    const locationPronouns = [
      /那附近/g,
      /那里附近/g,
      /那个位置附近/g,
      /上次那里/g,
      /刚才那里/g,
      /该区域/g,
      /这里/g // 在没有新锚点时，指代上次位置
    ]

    if (this.lastMentionedLocation) {
      locationPronouns.forEach(pattern => {
        if (pattern.test(resolvedQuestion)) {
          const replacement = `「${this.lastMentionedLocation.name}」附近`
          resolvedQuestion = resolvedQuestion.replace(pattern, replacement)
          substitutions.push({
            type: 'location',
            original: pattern.source,
            resolved: this.lastMentionedLocation.name
          })
          needsContext = true
        }
      })
    }

    // 模式 2: "它们"、"这些地方"、"刚才说的" → 上次的 POI 列表
    const poiPronouns = [
      /它们/g,
      /这些地方/g,
      /刚才说的/g,
      /上面提到的/g,
      /这几个/g
    ]

    if (this.lastMentionedPOIs.length > 0) {
      poiPronouns.forEach(pattern => {
        if (pattern.test(resolvedQuestion)) {
          // 取前 5 个 POI 名称
          const poiNames = this.lastMentionedPOIs.slice(0, 5).map(p => p.name)
          const replacement = poiNames.join('、')
          resolvedQuestion = resolvedQuestion.replace(pattern, replacement)
          substitutions.push({
            type: 'poi_list',
            original: pattern.source,
            resolved: poiNames
          })
          needsContext = true
        }
      })
    }

    // 模式 3: "还有什么"、"继续找"、"更多" → 暗示需要更多结果
    const continuationPatterns = [
      /还有什么/,
      /还有哪些/,
      /继续找/,
      /更多/,
      /其他的/
    ]

    continuationPatterns.forEach(pattern => {
      if (pattern.test(resolvedQuestion) && this.lastQueryPlan) {
        needsContext = true
        substitutions.push({
          type: 'continuation',
          original: pattern.source,
          lastCategories: this.lastQueryPlan.categories || []
        })
      }
    })

    return {
      resolvedQuestion,
      substitutions,
      needsContext,
      contextProvided: {
        lastLocation: this.lastMentionedLocation,
        lastPOICount: this.lastMentionedPOIs.length,
        historyLength: this.history.length
      }
    }
  }

  /**
   * 获取对话摘要（供 Planner 参考）
   * @returns {string}
   */
  getHistorySummary() {
    if (this.history.length === 0) {
      return null
    }

    const recentTurns = this.history.slice(-3) // 取最近 3 轮
    const summaryParts = recentTurns.map((turn, i) => {
      const poiSummary = turn.pois?.length > 0 
        ? `返回了 ${turn.pois.length} 个 POI，如 ${turn.pois.slice(0, 3).map(p => p.name).join('、')}`
        : '无 POI 结果'
      return `[第${this.history.length - recentTurns.length + i + 1}轮] 用户问: "${turn.question.slice(0, 30)}..." → ${poiSummary}`
    })

    return summaryParts.join('\n')
  }

  /**
   * 获取上下文增强的查询计划
   * @param {Object} queryPlan - 原始查询计划
   * @returns {Object} 增强后的查询计划
   */
  enhanceQueryPlan(queryPlan) {
    const enhanced = { ...queryPlan }

    // 如果没有锚点但有历史锚点，使用历史锚点
    if ((!enhanced.anchor || enhanced.anchor.type === 'unknown') && this.lastAnchor) {
      console.log(`[ConversationContext] 使用历史锚点: ${this.lastAnchor.name}`)
      enhanced.anchor = {
        ...this.lastAnchor,
        source: 'conversation_history'
      }
      enhanced._contextEnhanced = true
    }

    // 如果是"继续"类查询，继承上次的类别
    if (queryPlan._isContinuation && this.lastQueryPlan?.categories) {
      enhanced.categories = this.lastQueryPlan.categories
      enhanced._contextEnhanced = true
    }

    return enhanced
  }

  /**
   * 将上下文序列化（用于存储）
   */
  serialize() {
    return {
      sessionId: this.sessionId,
      lastMentionedLocation: this.lastMentionedLocation,
      lastMentionedPOIs: this.lastMentionedPOIs.slice(0, 10), // 只保留前 10 个
      lastAnchor: this.lastAnchor,
      lastQueryPlan: this.lastQueryPlan ? {
        query_type: this.lastQueryPlan.query_type,
        categories: this.lastQueryPlan.categories,
        anchor: this.lastQueryPlan.anchor
      } : null,
      historyLength: this.history.length,
      createdAt: this.createdAt,
      lastAccessedAt: this.lastAccessedAt
    }
  }
}

// =====================================================
// 会话管理函数
// =====================================================

/**
 * 获取或创建会话上下文
 * @param {string} sessionId - 会话 ID
 * @returns {SpatialConversationContext}
 */
export function getOrCreateContext(sessionId) {
  if (!sessionId) {
    // 如果没有 sessionId，返回一个临时上下文
    return new SpatialConversationContext(`temp_${Date.now()}`)
  }

  if (sessionStore.has(sessionId)) {
    const context = sessionStore.get(sessionId)
    context.lastAccessedAt = Date.now()
    return context
  }

  const context = new SpatialConversationContext(sessionId)
  sessionStore.set(sessionId, context)
  return context
}

/**
 * 清理过期会话
 */
export function cleanupExpiredSessions() {
  const now = Date.now()
  let cleaned = 0

  for (const [sessionId, context] of sessionStore) {
    if (now - context.lastAccessedAt > SESSION_TTL) {
      sessionStore.delete(sessionId)
      cleaned++
    }
  }

  if (cleaned > 0) {
    console.log(`[ConversationContext] 清理了 ${cleaned} 个过期会话`)
  }

  return cleaned
}

/**
 * 获取会话统计
 */
export function getSessionStats() {
  return {
    activeSessions: sessionStore.size,
    sessions: Array.from(sessionStore.entries()).map(([id, ctx]) => ({
      sessionId: id,
      historyLength: ctx.history.length,
      lastAccess: new Date(ctx.lastAccessedAt).toISOString(),
      hasLocation: !!ctx.lastMentionedLocation
    }))
  }
}

/**
 * 删除指定会话
 * @param {string} sessionId
 */
export function deleteSession(sessionId) {
  return sessionStore.delete(sessionId)
}

// 定期清理过期会话（每 5 分钟）
setInterval(cleanupExpiredSessions, 5 * 60 * 1000)

export default {
  SpatialConversationContext,
  getOrCreateContext,
  cleanupExpiredSessions,
  getSessionStats,
  deleteSession
}
