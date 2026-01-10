/**
 * 语义搜索接口
 * POST /api/ai/search
 * 
 * 请求体：
 * {
 *   keyword: string,           // 搜索关键词
 *   poiNames: string[],        // POI 名称列表
 *   batchIndex?: number        // 批次索引（用于分批处理）
 * }
 * 
 * 返回：
 * {
 *   matchedNames: string[]     // 匹配的 POI 名称
 * }
 */

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody(event)
  
  const { keyword, poiNames = [], batchIndex = 0 } = body
  
  if (!keyword || !keyword.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'keyword 参数不能为空'
    })
  }

  if (!poiNames || poiNames.length === 0) {
    return { matchedNames: [] }
  }

  const kw = keyword.trim()

  // 选择服务商
  let apiBase = config.localApiBase
  let apiKey = 'lm-studio'
  let modelId = 'qwen3-4b-instruct-2507'
  let useLocal = true
  let authHeader = 'Authorization'
  let useBearer = true

  // 检测本地服务是否可用
  try {
    await $fetch(`${config.localApiBase}/models`, {
      method: 'GET',
      timeout: 3000
    })
  } catch (e) {
    useLocal = false
    apiBase = config.mimoApiBase
    apiKey = config.mimoApiKey
    modelId = 'mimo-v2-flash'
    authHeader = 'api-key'
    useBearer = false
  }

  // 构建 Prompt
  const prompt = `你是一个 POI（兴趣点）语义分析专家。

## 任务
用户搜索关键词：「${kw}」

以下是 POI 名称列表：
${poiNames.join('、')}

## 要求
1. 分析每个 POI 名称，判断其是否与搜索关键词「${kw}」语义相关
2. 语义相关包括：
   - 直接包含关键词
   - 属于该类别的品牌（如搜索"奶茶"，"一点点"、"沪上阿姨"、"蜜雪冰城"都相关）
   - 属于该类别的同义词或近义词
3. 仅返回相关的 POI 名称，用「|」分隔
4. 如果没有任何相关的 POI，返回「无」
5. 禁止输出任何解释、思考过程或额外文字，直接返回结果

## 示例
搜索"火锅"的相关 POI：海底捞|呷哺呷哺|小龙坎|捞王`

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
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3, // 降低随机性
    stream: false
  }

  if (!useLocal) {
    requestBody.max_completion_tokens = 1024
    requestBody.thinking = { type: 'disabled' }
    requestBody.top_p = 0.95
  } else {
    requestBody.max_tokens = 1024
  }

  try {
    const response = await $fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers,
      body: requestBody
    })

    const result = response.choices?.[0]?.message?.content?.trim() || ''
    
    if (!result || result === '无') {
      return { matchedNames: [] }
    }

    // 解析结果
    const matchedNames = result
      .split('|')
      .map(name => name.trim())
      .filter(name => name && name !== '无')

    console.log(`[AI Search] 批次 ${batchIndex}: 匹配 ${matchedNames.length} 个 POI`)
    
    return { matchedNames }
  } catch (error) {
    console.error(`[AI Search] 批次 ${batchIndex} 失败:`, error)
    throw createError({
      statusCode: 500,
      statusMessage: 'AI 搜索请求失败'
    })
  }
})
