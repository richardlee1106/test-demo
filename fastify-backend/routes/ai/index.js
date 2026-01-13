/**
 * AI 路由模块 (三阶段 Spatial-RAG 管道)
 * 
 * 架构：
 * ┌───────────────────────────────────────────────────────────
 * │ 阶段1: Planner (LLM)                                            
 * │   用户问题 → LLM → QueryPlan JSON (不看 POI 数据)               
 * ├────────────────────────────────────────────────────────────
 * │ 阶段2: Executor (后端)                                          
 * │   QueryPlan → PostGIS + Milvus → 压缩结果 (不调 LLM)            
 * ├────────────────────────────────────────────────────────────
 * │ 阶段3: Writer (LLM)                                             
 * │   压缩结果 → LLM → 自然语言回答 (Token 可控)                     
 * └────────────────────────────────────────────────────────────
 * 
 * Token 消耗目标: < 2500 tokens/请求
 */

import { createRAGSession } from '../../services/ragLogger.js'

// RAG 会话存储
const ragSessions = new Map()

// 定期清理过期会话
setInterval(() => {
  const now = Date.now()
  const maxAge = 30 * 60 * 1000 // 30 分钟
  
  for (const [id, session] of ragSessions.entries()) {
    if (now - session.createdAt > maxAge) {
      ragSessions.delete(id)
    }
  }
}, 5 * 60 * 1000) // 每 5 分钟清理一次

async function aiRoutes(fastify, options) {
  
  // ========================================
  // GET /api/ai/status - 服务状态检查
  // ========================================
  fastify.get('/status', async (request, reply) => {
    const localApiBase = process.env.LOCAL_LM_API || process.env.LLM_BASE_URL || 'http://localhost:1234/v1'
    
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      
      await fetch(`${localApiBase}/models`, { signal: controller.signal })
      clearTimeout(timeout)
      
      return { 
        online: true, 
        provider: 'local', 
        providerName: 'Local LM Studio',
        architecture: 'three-stage-spatial-rag'
      }
    } catch (e) {
      if (process.env.MIMO_API_KEY) {
        return { 
          online: true, 
          provider: 'mimo', 
          providerName: 'Cloud AI Service',
          architecture: 'three-stage-spatial-rag'
        }
      }
      return { 
        online: false, 
        provider: null, 
        providerName: 'No AI Service Available' 
      }
    }
  })

  // ========================================
  // GET /api/ai/models - 获取可用模型列表
  // ========================================
  fastify.get('/models', async (request, reply) => {
    const localApiBase = process.env.LOCAL_LM_API || process.env.LLM_BASE_URL || 'http://localhost:1234/v1'
    
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      
      const response = await fetch(`${localApiBase}/models`, { signal: controller.signal })
      clearTimeout(timeout)
      
      if (response.ok) {
        const data = await response.json()
        return { provider: 'local', models: data.data || [] }
      }
    } catch (e) {
      // 本地不可用
    }
    
    return {
      provider: 'mimo',
      models: [
        { id: 'mimo-v2-flash', name: 'MiMo V2 Flash', description: '快速响应模型' },
        { id: 'mimo-v2-pro', name: 'MiMo V2 Pro', description: '高质量推理模型' }
      ]
    }
  })

  // ========================================
  // POST /api/ai/chat - 三阶段 Spatial-RAG 管道
  // ========================================
  fastify.post('/chat', async (request, reply) => {
    const { messages = [], poiFeatures = [], options = {} } = request.body || {}

    if (!messages || messages.length === 0) {
      return reply.status(400).send({ error: 'messages 参数不能为空' })
    }

    // 获取或创建 RAG 会话
    const sessionId = options.sessionId || `session_${Date.now()}`
    let session = ragSessions.get(sessionId)
    if (!session) {
      session = createRAGSession()
      session.createdAt = Date.now()
      ragSessions.set(sessionId, session)
    }

    // 获取最后一条用户消息
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || ''
    session.setUserQuery(lastUserMessage)
    
    try {
      // 动态导入三阶段管道（支持热重载）
      const { executePipeline } = await import('./spatial-rag-pipeline.js')
      
      session.log('Pipeline', 'Started', { 
        userQuery: lastUserMessage.slice(0, 50),
        poiCount: poiFeatures.length,
        architecture: 'three-stage'
      })

      // 设置 SSE 响应头
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no' // 禁用 nginx 缓冲
      })

      let fullContent = ''
      
      // 执行三阶段管道，传递 session 用于日志记录
      const pipelineOptions = { ...options, session }
      for await (const chunk of executePipeline(lastUserMessage, poiFeatures, pipelineOptions)) {
        if (chunk) {
          reply.raw.write(`data: ${JSON.stringify({ content: chunk })}\n\n`)
          fullContent += chunk
        }
      }
      
      // 循环结束后，发送最终使用的 POI 数据给前端（用于地图渲染）
      const finalPOIs = session.getFinalPOIs()
      if (finalPOIs && finalPOIs.length > 0) {
        reply.raw.write(`event: pois\n`)
        reply.raw.write(`data: ${JSON.stringify(finalPOIs)}\n\n`)
      }
      
      // 发送完成标记
      reply.raw.write('data: [DONE]\n\n')
      
      session.log('Pipeline', 'Completed', { 
        responseLength: fullContent.length,
        architecture: 'three-stage'
      })
      session.markSuccess()
      session.save()
      
      reply.raw.end()
    } catch (err) {
      console.error('[AI Chat] 管道执行错误:', err)
      session.log('Pipeline', 'Error', { error: err.message })
      session.save()
      
      if (!reply.raw.headersSent) {
        return reply.status(500).send({ error: `AI 服务错误: ${err.message}` })
      }
      
      // 如果已经开始流式输出，发送错误信息
      try {
        const errorData = JSON.stringify({
          choices: [{
            delta: { content: `\n\n⚠️ 发生错误: ${err.message}` },
            index: 0
          }]
        })
        reply.raw.write(`data: ${errorData}\n\n`)
        reply.raw.write('data: [DONE]\n\n')
      } catch {}
      
      reply.raw.end()
    }
  })

  // ========================================
  // POST /api/ai/plan - 仅执行阶段1（调试用）
  // ========================================
  fastify.post('/plan', async (request, reply) => {
    const { question, context = {} } = request.body || {}
    
    if (!question) {
      return reply.status(400).send({ error: '缺少 question 参数' })
    }
    
    try {
      const { parseIntent } = await import('./planner.js')
      const result = await parseIntent(question, context)
      return result
    } catch (err) {
      return reply.status(500).send({ error: err.message })
    }
  })

  // ========================================
  // POST /api/ai/execute - 仅执行阶段2（调试用）
  // ========================================
  fastify.post('/execute', async (request, reply) => {
    const { queryPlan, poiFeatures = [] } = request.body || {}
    
    if (!queryPlan) {
      return reply.status(400).send({ error: '缺少 queryPlan 参数' })
    }
    
    try {
      const { executeQuery } = await import('./executor.js')
      const result = await executeQuery(queryPlan, poiFeatures)
      return result
    } catch (err) {
      return reply.status(500).send({ error: err.message })
    }
  })

  // ========================================
  // POST /api/ai/session/end - 结束对话会话
  // ========================================
  fastify.post('/session/end', async (request, reply) => {
    const { sessionId } = request.body || {}
    
    if (sessionId && ragSessions.has(sessionId)) {
      const session = ragSessions.get(sessionId)
      session.log('Session', 'Ended', { reason: 'user_clear' })
      session.save()
      ragSessions.delete(sessionId)
      return { success: true, message: '会话已结束并保存日志' }
    }
    
    return { success: false, message: '会话不存在' }
  })

  // ========================================
  // POST /api/ai/search - 语义搜索（快速模式）
  // ========================================
  fastify.post('/search', async (request, reply) => {
    const { query, poiFeatures = [] } = request.body || {}

    if (!query) {
      return reply.status(400).send({ error: '缺少 query 参数' })
    }

    // 简单的关键词匹配搜索
    const keywords = query.toLowerCase().split(/\s+/)
    
    const results = poiFeatures.filter(poi => {
      const props = poi.properties || {}
      const searchText = `${props['名称'] || ''} ${props['大类'] || ''} ${props['中类'] || ''} ${props['小类'] || ''} ${props['地址'] || ''}`.toLowerCase()
      return keywords.some(kw => searchText.includes(kw))
    })

    // 按相关性排序（匹配关键词数量）
    results.sort((a, b) => {
      const textA = `${a.properties?.['名称'] || ''} ${a.properties?.['小类'] || ''}`.toLowerCase()
      const textB = `${b.properties?.['名称'] || ''} ${b.properties?.['小类'] || ''}`.toLowerCase()
      const scoreA = keywords.filter(kw => textA.includes(kw)).length
      const scoreB = keywords.filter(kw => textB.includes(kw)).length
      return scoreB - scoreA
    })

    return {
      success: true,
      query,
      total: results.length,
      results: results.slice(0, 50)
    }
  })

  // ========================================
  // GET /api/ai/architecture - 获取架构信息
  // ========================================
  fastify.get('/architecture', async (request, reply) => {
    return {
      name: 'Three-Stage Spatial-RAG Pipeline',
      version: '2.0.0',
      stages: [
        {
          name: 'Planner',
          type: 'LLM',
          description: '将用户问题转换为结构化 QueryPlan JSON',
          tokenBudget: '< 500 tokens',
          dataAccess: 'None (不访问 POI 数据)'
        },
        {
          name: 'Executor',
          type: 'Backend',
          description: '执行空间查询、语义精排、区域统计',
          tokenBudget: '0 tokens',
          dataAccess: 'PostGIS + Milvus + Graph DB'
        },
        {
          name: 'Writer',
          type: 'LLM',
          description: '基于压缩结果生成自然语言回答',
          tokenBudget: '< 2000 tokens',
          dataAccess: '压缩后的结果 JSON (≤30 POIs)'
        }
      ],
      benefits: [
        'Token 消耗可控 (< 2500/请求)',
        'LLM 不做数据库该做的事',
        '支持复杂空间查询',
        '可扩展图推理能力'
      ]
    }
  })
}

export default aiRoutes
