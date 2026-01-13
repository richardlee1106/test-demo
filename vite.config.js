import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      // 代理 AI API 请求到 Fastify 后端
      '/api/ai': {
        target: 'http://localhost:3456',
        changeOrigin: true,
        // 流式响应支持
        timeout: 120000,
      },
      // 代理空间查询 API
      '/api/spatial': {
        target: 'http://localhost:3456',
        changeOrigin: true,
        timeout: 60000,
      },
    }
  }
})
