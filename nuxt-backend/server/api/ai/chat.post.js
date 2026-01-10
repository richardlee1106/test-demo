/**
 * AI 聊天接口 - 流式响应
 * POST /api/ai/chat
 * 
 * 请求体：
 * {
 *   messages: [{ role: 'user'|'assistant'|'system', content: string }],
 *   poiFeatures: GeoJSON Feature[],  // 可选，POI 上下文数据
 *   options: { temperature?, maxTokens? }
 * }
 */

import { 
  formatPOIContext, 
  buildSystemPrompt, 
  isLocationRelatedQuery 
} from '../../utils/aiHelpers.js'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody(event)
  
  const { messages = [], poiFeatures = [], options = {} } = body
  
  if (!messages || messages.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'messages 参数不能为空'
    })
  }

  // 获取最后一条用户消息，用于判断是否为位置查询
  const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || ''
  const isLocationQuery = isLocationRelatedQuery(lastUserMessage)
  
  // 如果有 POI 数据，构建上下文
  let systemPrompt = ''
  if (poiFeatures.length > 0) {
    const poiContext = formatPOIContext(poiFeatures, lastUserMessage)
    systemPrompt = buildSystemPrompt(poiContext, isLocationQuery)
  }

  // 构建完整消息列表
  const fullMessages = systemPrompt 
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages

  // 选择服务商：优先尝试本地，失败则使用 MiMo
  let apiBase = config.localApiBase
  let apiKey = 'lm-studio'
  let modelId = 'qwen3-4b-instruct-2507'
  let useLocal = true
  let authHeader = 'Authorization'
  let useBearer = true

  // 检测本地服务是否可用
  try {
    const localCheck = await $fetch(`${config.localApiBase}/models`, {
      method: 'GET',
      timeout: 3000
    })
    console.log('[AI Backend] 本地 LM Studio 在线')
  } catch (e) {
    console.log('[AI Backend] 本地服务离线，切换到 MiMo')
    useLocal = false
    apiBase = config.mimoApiBase
    apiKey = config.mimoApiKey
    modelId = 'mimo-v2-flash'
    authHeader = 'api-key'
    useBearer = false
  }

  // 构建请求头
  const headers = {
    'Content-Type': 'application/json'
  }
  if (useBearer) {
    headers['Authorization'] = `Bearer ${apiKey}`
  } else {
    headers[authHeader] = apiKey
  }

  // 构建请求体
  const requestBody = {
    model: modelId,
    messages: fullMessages,
    temperature: options.temperature ?? 0.7,
    stream: true
  }

  // 不同服务商的参数差异
  if (!useLocal) {
    requestBody.max_completion_tokens = options.maxTokens ?? 2048
    requestBody.thinking = { type: 'disabled' }
    requestBody.top_p = 0.95
  } else {
    requestBody.max_tokens = options.maxTokens ?? 2048
  }

  // 调用 AI 服务
  const response = await $fetch.raw(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers,
    body: requestBody,
    responseType: 'stream'
  })

  // 设置 SSE 响应头
  setResponseHeader(event, 'Content-Type', 'text/event-stream')
  setResponseHeader(event, 'Cache-Control', 'no-cache')
  setResponseHeader(event, 'Connection', 'keep-alive')
  setResponseHeader(event, 'X-AI-Provider', useLocal ? 'local' : 'mimo')

  // 返回流
  return response._data
})
