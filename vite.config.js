import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      // 代理 LM Studio API 请求，解决跨域问题
      '/api/ai': {
        target: 'http://localhost:1234',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ai/, '/v1'),
        // 超时设置（大模型响应可能较慢）
        timeout: 120000,
      },
      // 代理 Xiaomi MiMo API
      '/api/mimo': {
        target: 'https://api.xiaomimimo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/mimo/, ''),
        timeout: 120000,
      }
    }
  }
})
