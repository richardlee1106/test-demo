/**
 * Vercel Edge Function - 语义搜索接口
 * 路径: /api/ai/search
 */

export default async function handler(request) {
  // 处理 CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    })
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const body = await request.json()
  const { keyword, poiNames = [], batchIndex = 0 } = body

  if (!keyword || !keyword.trim()) {
    return new Response(JSON.stringify({ error: 'keyword 参数不能为空' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  if (!poiNames || poiNames.length === 0) {
    return new Response(JSON.stringify({ matchedNames: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }

  // 获取 API Key
  const mimoApiKey = process.env.MIMO_API_KEY
  if (!mimoApiKey) {
    return new Response(JSON.stringify({ error: 'AI 服务未配置' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const kw = keyword.trim()

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

  try {
    const response = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': mimoApiKey
      },
      body: JSON.stringify({
        model: 'mimo-v2-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_completion_tokens: 1024,
        thinking: { type: 'disabled' },
        top_p: 0.95,
        stream: false
      })
    })

    if (!response.ok) {
      const error = await response.text()
      return new Response(JSON.stringify({ error: `AI 请求失败: ${error}` }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const data = await response.json()
    const result = data.choices?.[0]?.message?.content?.trim() || ''

    if (!result || result === '无') {
      return new Response(JSON.stringify({ matchedNames: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    }

    // 解析结果
    const matchedNames = result
      .split('|')
      .map(name => name.trim())
      .filter(name => name && name !== '无')

    return new Response(JSON.stringify({ matchedNames }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  } catch (error) {
    console.error('AI Search Error:', error)
    return new Response(JSON.stringify({ error: `服务器错误: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

export const config = {
  runtime: 'edge'
}
