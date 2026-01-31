import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// d:\AAA_Edu\TagCloud\vite-project\vite.config.js
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api/ai': {
        target: 'http://localhost:3200',
        changeOrigin: true,
        timeout: 120000,
      },
      '/api/category': {
        target: 'http://localhost:3200',
        changeOrigin: true,
      },
      '/api/spatial': {
        target: 'http://localhost:3200',
        changeOrigin: true,
        timeout: 120000,
      },
      '/api/search': {
        target: 'http://localhost:3200',
        changeOrigin: true,
        timeout: 30000,
      },
    }
  }
})