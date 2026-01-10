import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      // 代理 AI API 请求到 Nuxt 后端
      '/api/ai': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // 流式响应支持
        timeout: 120000,
      },
      // 注意：MiMo 代理已移至后端，前端不再需要
    }
  }
})
