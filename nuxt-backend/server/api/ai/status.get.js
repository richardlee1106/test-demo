/**
 * AI 服务状态检查接口
 * GET /api/ai/status
 * 
 * 返回：
 * {
 *   online: boolean,
 *   provider: 'local' | 'mimo',
 *   providerName: string
 * }
 */

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  
  // 尝试检测本地服务
  try {
    const localResp = await $fetch(`${config.localApiBase}/models`, {
      method: 'GET',
      timeout: 3000
    })
    
    return {
      online: true,
      provider: 'local',
      providerName: 'Local LM Studio'
    }
  } catch (e) {
    console.log('[AI Status] 本地服务不可用:', e.message)
  }

  // 本地不可用，返回 MiMo 状态
  // MiMo 云服务假定可用（有 API Key 即可）
  if (config.mimoApiKey) {
    return {
      online: true,
      provider: 'mimo',
      providerName: 'Xiaomi MiMo'
    }
  }

  return {
    online: false,
    provider: null,
    providerName: 'No AI Service Available'
  }
})
