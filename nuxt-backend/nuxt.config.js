// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  
  // 禁用 TypeScript 严格模式，使用纯 JS
  typescript: {
    strict: false,
    shim: false
  },
  
  // 运行时配置（环境变量）
  runtimeConfig: {
    // 私有配置（仅服务端可访问） - 来自 .env 文件
    mimoApiKey: process.env.MIMO_API_KEY || '',
    mimoApiBase: 'https://api.xiaomimimo.com/v1',
    localApiBase: process.env.LOCAL_LM_API || 'http://localhost:1234/v1',
    
    // 公共配置（前后端都可访问）
    public: {
      apiBase: '/api'
    }
  },
  
  // Nitro 服务器配置
  nitro: {
    // 允许跨域（开发环境）
    routeRules: {
      '/api/**': {
        cors: true,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      }
    }
  }
})
