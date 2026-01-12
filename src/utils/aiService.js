/**
 * AI 服务模块 - 前端版本（调用后端 API）
 * 
 * 所有敏感配置已移至后端，此模块仅负责：
 * 1. 调用后端 API 接口
 * 2. 处理流式响应
 * 3. 提供前端需要的辅助函数
 */

// 后端 API 基础路径
const API_BASE = '/api/ai'

// 当前服务商信息（从后端获取）
let currentProvider = {
  online: false,
  provider: null,
  providerName: 'Unknown'
}

// 位置相关关键词（前端判断用，后端也会再次判断）
const LOCATION_KEYWORDS = [
  '距离', '最近', '附近', '周边', '临近', '相邻', '多远', '位置', '坐标',
  '公里', '米', '东', '西', '南', '北', '方向', '路线', '到达',
  '哪里', '在哪', '地址', '经纬度', '空间', '分布位置'
]

/**
 * 检测用户问题是否涉及位置/距离
 * @param {string} userMessage - 用户消息
 * @returns {boolean}
 */
export function isLocationRelatedQuery(userMessage) {
  if (!userMessage) return false
  return LOCATION_KEYWORDS.some(keyword => userMessage.includes(keyword))
}

/**
 * 根据名称查找 POI（支持模糊匹配）
 * @param {Array} features - POI 数组
 * @param {string} name - 要查找的名称
 * @returns {Object|null}
 */
export function findPOIByName(features, name) {
  if (!features || !name) return null
  
  // 精确匹配
  let found = features.find(f => {
    const poiName = f.properties?.['名称'] || f.properties?.name || ''
    return poiName === name
  })
  
  // 模糊匹配
  if (!found) {
    found = features.find(f => {
      const poiName = f.properties?.['名称'] || f.properties?.name || ''
      return poiName.includes(name) || name.includes(poiName)
    })
  }
  
  return found
}

/**
 * 计算两点间距离（Haversine 公式）
 * @param {Array} coord1 - [lon, lat]
 * @param {Array} coord2 - [lon, lat]
 * @returns {number} 距离（米）
 */
export function calculateDistance(coord1, coord2) {
  const R = 6371000 // 地球半径（米）
  const lat1 = coord1[1] * Math.PI / 180
  const lat2 = coord2[1] * Math.PI / 180
  const dLat = (coord2[1] - coord1[1]) * Math.PI / 180
  const dLon = (coord2[0] - coord1[0]) * Math.PI / 180
  
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  
  return R * c
}

/**
 * 格式化 POI 上下文（简化版，用于显示）
 * 实际处理已移至后端
 * @param {Array} features - GeoJSON Feature 数组
 * @param {string} userMessage - 用户消息
 * @returns {string}
 */
export function formatPOIContext(features, userMessage = '') {
  if (!features || features.length === 0) {
    return '当前没有选中任何 POI 数据。'
  }
  return `已选中 ${features.length} 个 POI 数据`
}

/**
 * 构建系统提示词（已移至后端，此函数仅为兼容性保留）
 * @param {string} poiContext - POI 上下文信息
 * @param {boolean} isLocationQuery - 是否为位置相关查询
 * @returns {string}
 */
export function buildSystemPrompt(poiContext, isLocationQuery = false) {
  // 实际 system prompt 在后端构建
  return ''
}

/**
 * 发送聊天请求（流式）- 调用后端 API
 * @param {Array} messages - 消息历史
 * @param {Function} onChunk - 每次收到新内容时的回调 (text: string) => void
 * @param {Object} options - 可选配置
 * @param {Array} poiFeatures - POI 数据（将发送到后端处理）
 * @returns {Promise<string>} 完整的 AI 回复
 */
export async function sendChatMessageStream(messages, onChunk, options = {}, poiFeatures = []) {
  console.log('[AI Frontend] 调用后端 API，POI 数量:', poiFeatures.length)

  const response = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messages,
      poiFeatures,
      options
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`AI 请求失败: ${response.status} - ${error}`)
  }

  // 获取当前使用的服务商
  const provider = response.headers.get('X-AI-Provider')
  if (provider) {
    currentProvider.provider = provider
    currentProvider.providerName = provider === 'local' ? 'Local LM Studio' : 'Xiaomi MiMo'
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullContent = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      // 调试：打印原始行
      // console.log('[AI Stream Raw]', line)

      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)
          // 兼容不同的 OpenAIChat 格式
          const choice = parsed.choices?.[0]
          const delta = choice?.delta?.content || choice?.text || ''
          
          // 特殊处理：有些推理引擎可能返回空 delta 但有 finish_reason
          if (choice?.finish_reason) {
             // 结束
          }

          if (delta) {
             fullContent += delta
             onChunk(delta)
          } else {
             // 尝试检查是否包含错误信息
             if (parsed.error) {
                console.error('[AI Stream Error]', parsed.error)
                onChunk(`\n[系统错误: ${parsed.error.message || '未知错误'}]\n`)
             }
          }
        } catch (e) {
          // 如果解析失败，可能是非 JSON 格式的 raw text（罕见情况）
          console.warn('[AI Stream Parse Error]', e, line)
        }
      }
    }
  }

  // 过滤 Qwen3 的思考标签内容
  fullContent = fullContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  
  return fullContent
}

/**
 * 发送聊天请求（非流式）- 兼容性保留
 * @param {Array} messages - 消息历史 [{role, content}, ...]
 * @param {Object} options - 可选配置
 * @returns {Promise<string>} AI 回复内容
 */
export async function sendChatMessage(messages, options = {}) {
  let result = ''
  await sendChatMessageStream(messages, (chunk) => {
    result += chunk
  }, options)
  return result
}

/**
 * 语义搜索 - 调用后端 API
 * @param {string} keyword - 用户搜索关键词
 * @param {Array} features - 所有 POI 的 GeoJSON Feature 数组
 * @param {Object} options - 可选配置
 * @returns {Promise<Array>} 语义相关的 POI 数组
 */
export async function semanticSearch(keyword, features, options = {}) {
  if (!keyword || !keyword.trim() || !features || features.length === 0) {
    return []
  }

  const kw = keyword.trim()
  
  // 提取所有 POI 名称
  const poiNames = features.map(f => {
    return f?.properties?.['名称'] ?? f?.properties?.name ?? f?.properties?.Name ?? ''
  }).filter(name => name)

  // 分批处理
  const BATCH_SIZE = 200
  const batches = []
  for (let i = 0; i < poiNames.length; i += BATCH_SIZE) {
    batches.push(poiNames.slice(i, i + BATCH_SIZE))
  }

  console.log(`[AI Search] 关键词: "${kw}", 共 ${poiNames.length} 个 POI, 分 ${batches.length} 批处理`)

  // 收集所有匹配的名称
  const matchedNames = new Set()

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex]
    
    try {
      const response = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          keyword: kw,
          poiNames: batch,
          batchIndex
        })
      })

      if (!response.ok) {
        console.error(`[AI Search] 批次 ${batchIndex + 1} 失败:`, response.status)
        continue
      }

      const result = await response.json()
      if (result.matchedNames) {
        result.matchedNames.forEach(name => matchedNames.add(name))
      }

      console.log(`[AI Search] 批次 ${batchIndex + 1}/${batches.length} 完成，当前匹配 ${matchedNames.size} 个`)
    } catch (error) {
      console.error(`[AI Search] 批次 ${batchIndex + 1} 失败:`, error)
    }
  }

  // 根据匹配的名称过滤原始 features
  const matchedFeatures = features.filter(f => {
    const name = f?.properties?.['名称'] ?? f?.properties?.name ?? f?.properties?.Name ?? ''
    return matchedNames.has(name)
  })

  console.log(`[AI Search] 最终匹配 ${matchedFeatures.length} 个 POI`)
  return matchedFeatures
}

/**
 * 检查 AI 服务可用性 - 调用后端 API
 * @returns {Promise<boolean>}
 */
export async function checkAIService() {
  try {
    const response = await fetch(`${API_BASE}/status`)
    if (!response.ok) {
      currentProvider.online = false
      return false
    }
    
    const data = await response.json()
    currentProvider = data
    console.log(`[AI] 服务状态: ${data.providerName} (${data.provider})`)
    return data.online
  } catch (e) {
    console.error('[AI] 服务检查失败:', e)
    currentProvider.online = false
    return false
  }
}

/**
 * 获取当前服务商信息
 */
export function getCurrentProviderInfo() {
  return {
    id: currentProvider.provider,
    name: currentProvider.providerName,
    apiBase: API_BASE,
    modelId: currentProvider.provider === 'local' ? 'qwen3-4b-instruct-2507' : 'mimo-v2-flash'
  }
}

/**
 * 获取可用模型列表 - 调用后端 API
 * @returns {Promise<Array>}
 */
export async function getAvailableModels() {
  try {
    const response = await fetch(`${API_BASE}/models`)
    if (!response.ok) return []
    const data = await response.json()
    return data.models || []
  } catch {
    return []
  }
}
