/**
 * AI 路由模块
 * 提供 chat, search, status 等接口
 */

import { aiHelpers } from './helpers.js'

async function aiRoutes(fastify, options) {
  
  // ========================================
  // GET /api/ai/status - 服务状态检查
  // ========================================
  fastify.get('/status', async (request, reply) => {
    const localApiBase = process.env.LOCAL_LM_API || 'http://localhost:1234/v1'
    
    try {
      // 尝试连接本地 LM Studio
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      
      await fetch(`${localApiBase}/models`, { signal: controller.signal })
      clearTimeout(timeout)
      
      return { online: true, provider: 'local', providerName: 'Local LM Studio' }
    } catch (e) {
      // 本地不可用，检查云端配置
      if (process.env.MIMO_API_KEY) {
        return { online: true, provider: 'mimo', providerName: 'Cloud AI Service' }
      }
      return { online: false, provider: null, providerName: 'No AI Service Available' }
    }
  })

  // ========================================
  // GET /api/ai/models - 获取可用模型列表
  // ========================================
  fastify.get('/models', async (request, reply) => {
    const localApiBase = process.env.LOCAL_LM_API || 'http://localhost:1234/v1'
    
    try {
      // 尝试从本地 LM Studio 获取模型列表
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      
      const response = await fetch(`${localApiBase}/models`, { signal: controller.signal })
      clearTimeout(timeout)
      
      if (response.ok) {
        const data = await response.json()
        return { provider: 'local', models: data.data || [] }
      }
    } catch (e) {
      // 本地不可用，返回云端模型列表
    }
    
    // 返回云端默认模型
    return {
      provider: 'mimo',
      models: [
        { id: 'mimo-v2-flash', name: 'MiMo V2 Flash', description: '快速响应模型' },
        { id: 'mimo-v2-pro', name: 'MiMo V2 Pro', description: '高质量推理模型' }
      ]
    }
  })

  // ========================================
  // POST /api/ai/chat - 流式聊天
  // ========================================
  fastify.post('/chat', async (request, reply) => {
    const { messages = [], poiFeatures = [], options = {} } = request.body || {}

    if (!messages || messages.length === 0) {
      return reply.status(400).send({ error: 'messages 参数不能为空' })
    }

    // 获取最后一条用户消息
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || ''
    const isLocationQuery = aiHelpers.isLocationRelatedQuery(lastUserMessage)
    
    // 构建上下文和系统提示词（始终发送以维持身份设定）
    const poiContext = poiFeatures.length > 0 
      ? aiHelpers.formatPOIContext(poiFeatures, lastUserMessage)
      : '当前未选中任何 POI 数据。'
    
    const systemPrompt = aiHelpers.buildSystemPrompt(poiContext, isLocationQuery)
    const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages]

    // 选择服务商
    let apiBase, apiKey, modelId, headers
    const localApiBase = process.env.LOCAL_LM_API || 'http://localhost:1234/v1'
    
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 2000)
      await fetch(`${localApiBase}/models`, { signal: controller.signal })
      clearTimeout(timeout)
      
      // 使用本地服务
      apiBase = localApiBase
      apiKey = 'lm-studio'
      modelId = 'qwen3-4b-instruct-2507'
      headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }
    } catch (e) {
      // 使用云端服务
      apiBase = 'https://api.xiaomimimo.com/v1'
      apiKey = process.env.MIMO_API_KEY
      modelId = 'mimo-v2-flash'
      headers = { 'Content-Type': 'application/json', 'api-key': apiKey }
    }

    if (!apiKey) {
      return reply.status(500).send({ error: 'AI 服务未配置' })
    }

    // 构建请求体
    const requestBody = {
      model: modelId,
      messages: fullMessages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
      stream: true
    }

    try {
      const response = await fetch(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        const error = await response.text()
        return reply.status(response.status).send({ error: `AI 请求失败: ${error}` })
      }

      // 设置 SSE 响应头
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-AI-Provider': apiBase.includes('localhost') ? 'local' : 'mimo'
      })

      // 流式转发
      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        reply.raw.write(decoder.decode(value, { stream: true }))
      }

      reply.raw.end()
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: `服务器错误: ${error.message}` })
    }
  })

  // ========================================
  // POST /api/ai/search - 语义搜索
  // ========================================
  fastify.post('/search', async (request, reply) => {
    const { keyword, poiNames = [], batchIndex = 0 } = request.body || {}

    if (!keyword || !keyword.trim()) {
      return reply.status(400).send({ error: 'keyword 参数不能为空' })
    }

    if (!poiNames || poiNames.length === 0) {
      return { matchedNames: [] }
    }

    const apiKey = process.env.MIMO_API_KEY
    if (!apiKey) {
      return reply.status(500).send({ error: 'AI 服务未配置' })
    }

    const kw = keyword.trim()
    const prompt = `你是一个 POI（兴趣点）语义分析专家。

## 任务
用户搜索关键词：「${kw}」

以下是 POI 名称列表：
${poiNames.join('、')}

## 要求
1. 分析每个 POI 名称，判断其是否与搜索关键词「${kw}」语义相关
2. 语义相关包括：直接包含关键词、属于该类别的品牌、同义词或近义词
3. 仅返回相关的 POI 名称，用「|」分隔
4. 如果没有任何相关的 POI，返回「无」
5. 禁止输出任何解释，直接返回结果`

    try {
      const response = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          model: 'mimo-v2-flash',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 1024,
          stream: false
        })
      })

      if (!response.ok) {
        const error = await response.text()
        return reply.status(response.status).send({ error: `AI 请求失败: ${error}` })
      }

      const data = await response.json()
      const result = data.choices?.[0]?.message?.content?.trim() || ''

      if (!result || result === '无') {
        return { matchedNames: [] }
      }

      const matchedNames = result.split('|').map(n => n.trim()).filter(n => n && n !== '无')
      return { matchedNames }
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: `服务器错误: ${error.message}` })
    }
  })
}

export default aiRoutes
