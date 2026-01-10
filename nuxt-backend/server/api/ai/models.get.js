/**
 * 可用模型列表接口
 * GET /api/ai/models
 * 
 * 返回当前服务商的可用模型列表
 */

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  
  // 优先尝试本地服务
  try {
    const response = await $fetch(`${config.localApiBase}/models`, {
      method: 'GET',
      timeout: 3000
    })
    
    return {
      provider: 'local',
      models: response.data || []
    }
  } catch (e) {
    // 本地不可用，返回 MiMo 预设模型
    return {
      provider: 'mimo',
      models: [
        { id: 'mimo-v2-flash', name: 'MiMo v2 Flash' },
        { id: 'mimo-v1-medium', name: 'MiMo v1 Medium' }
      ]
    }
  }
})
