/**
 * Vercel Edge Function - AI 服务状态检查
 * 路径: /api/ai/status
 */

export default async function handler(request) {
  // 处理 CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      }
    })
  }

  // 在 Vercel 环境下，使用 MiMo 云服务
  const mimoApiKey = process.env.MIMO_API_KEY

  if (mimoApiKey) {
    return new Response(JSON.stringify({
      online: true,
      provider: 'mimo',
      providerName: 'Xiaomi MiMo'
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }

  return new Response(JSON.stringify({
    online: false,
    provider: null,
    providerName: 'No AI Service Available'
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  })
}

export const config = {
  runtime: 'edge'
}
