/**
 * LLM 服务模块
 * 
 * 策略：本地优先，云端兜底
 * 1. 首先尝试调用本地 LM Studio (http://localhost:1234/v1)
 * 2. 如果本地不可用，自动切换到云端 GLM-4.5-air
 */

import 'dotenv/config'

// 本地 LM Studio 配置
const LOCAL_CONFIG = {
  baseUrl: 'http://localhost:1234/v1',
  model: process.env.LOCAL_LLM_MODEL || 'qwen3-8b-instruct',
  timeout: 5000,  // 5秒超时检测
}

// 云端智谱 GLM 配置
const CLOUD_CONFIG = {
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  model: 'glm-4.5-air',
  embeddingModel: 'embedding-3', // 智谱最新 Embedding 模型
  apiKey: process.env.GLM_API_KEY || '',
}

// 缓存本地服务状态（避免每次都检测）
let localAvailable = null
let lastCheckTime = 0
const CHECK_INTERVAL = 30000  // 30秒重新检测一次

/**
 * 检测本地 LM Studio 是否可用
 * @returns {Promise<boolean>}
 */
async function checkLocalAvailable() {
  const now = Date.now()
  
  // 使用缓存结果（30秒内不重复检测）
  if (localAvailable !== null && (now - lastCheckTime) < CHECK_INTERVAL) {
    return localAvailable
  }
  
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), LOCAL_CONFIG.timeout)
    
    const response = await fetch(`${LOCAL_CONFIG.baseUrl}/models`, {
      method: 'GET',
      signal: controller.signal,
    })
    
    clearTimeout(timeoutId)
    
    localAvailable = response.ok
    lastCheckTime = now
    
    if (localAvailable) {
      console.log('[LLM] ✅ 本地 LM Studio 可用')
    }
    
    return localAvailable
  } catch (err) {
    localAvailable = false
    lastCheckTime = now
    console.log('[LLM] ⚠️ 本地 LM Studio 不可用，将使用云端 GLM')
    return false
  }
}

/**
 * 获取当前应使用的 LLM 配置
 * @returns {Promise<{baseUrl: string, model: string, apiKey: string, isLocal: boolean}>}
 */
export async function getLLMConfig() {
  const isLocal = await checkLocalAvailable()
  
  if (isLocal) {
    return {
      baseUrl: LOCAL_CONFIG.baseUrl,
      model: LOCAL_CONFIG.model,
      apiKey: '',  // 本地不需要 API Key
      isLocal: true,
    }
  } else {
    return {
      baseUrl: CLOUD_CONFIG.baseUrl,
      model: CLOUD_CONFIG.model,
      apiKey: CLOUD_CONFIG.apiKey,
      isLocal: false,
    }
  }
}

/**
 * 获取当前应使用的 Embedding 配置
 */
export async function getEmbeddingConfig() {
  const isLocal = await checkLocalAvailable()
  
  if (isLocal) {
    return {
      baseUrl: LOCAL_CONFIG.baseUrl,
      model: process.env.LLM_EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5',
      apiKey: '',
      isLocal: true,
    }
  } else {
    return {
      baseUrl: CLOUD_CONFIG.baseUrl,
      model: CLOUD_CONFIG.embeddingModel,
      apiKey: CLOUD_CONFIG.apiKey,
      isLocal: false,
    }
  }
}

/**
 * 调用 LLM Chat Completions API（自动选择本地/云端）
 * 
 * @param {Object} options
 */
export async function callLLM(options) {
  const config = await getLLMConfig()
  
  const headers = { 'Content-Type': 'application/json' }
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  }
  
  console.log(`[LLM] 使用 ${config.isLocal ? '本地' : '云端'} 模型: ${config.model}`)
  
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 1500,
      stream: options.stream ?? false,
    }),
  })
  
  if (!response.ok) {
    if (config.isLocal) {
      console.log('[LLM] 本地调用失败，切换到云端兜底...')
      localAvailable = false
      return callLLM(options)
    }
    throw new Error(`LLM API error: ${response.status} ${response.statusText}`)
  }
  
  return response
}

/**
 * 生成文本向量（统一本地/云端逻辑）
 * @param {string|string[]} input 输入文本
 */
export async function generateEmbedding(input) {
  const config = await getEmbeddingConfig()
  
  const headers = { 'Content-Type': 'application/json' }
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  }
  
  try {
    const response = await fetch(`${config.baseUrl}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        input: input,
      }),
    })
    
    if (!response.ok) {
      if (config.isLocal) {
        console.log('[LLM] 本地 Embedding 失败，切换到云端...')
        localAvailable = false
        return generateEmbedding(input)
      }
      throw new Error(`Embedding API error: ${response.status}`)
    }
    
    const data = await response.json()
    
    if (Array.isArray(input)) {
        return data.data.map(item => item.embedding)
    }
    return data.data?.[0]?.embedding
  } catch (err) {
    console.error('[LLM] Embedding 生成失败:', err.message)
    return null
  }
}

/**
 * 强制刷新本地可用性检测
 */
export function refreshLocalStatus() {
  localAvailable = null
  lastCheckTime = 0
}

/**
 * 获取当前活动的 Provider 信息
 */
export async function getActiveProviderInfo() {
  const isLocal = await checkLocalAvailable()
  return {
    provider: isLocal ? 'local' : 'glm',
    providerName: isLocal ? 'Local LM Studio' : 'GLM'
  }
}

export default {
  getLLMConfig,
  getEmbeddingConfig,
  callLLM,
  generateEmbedding,
  refreshLocalStatus,
  getLLMStatus,
  getActiveProviderInfo
}
