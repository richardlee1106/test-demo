/**
 * TagCloud AI 后端服务
 * 基于 Fastify 构建的轻量级 API 服务
 */

import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'

// 导入路由
import aiRoutes from './routes/ai/index.js'

const fastify = Fastify({
  logger: true
})

// 注册 CORS 插件
await fastify.register(cors, {
  origin: true, // 允许所有来源（开发环境）
  methods: ['GET', 'POST', 'OPTIONS']
})

// 注册 AI 路由
fastify.register(aiRoutes, { prefix: '/api/ai' })

// 健康检查
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() }
})

// 启动服务
const start = async () => {
  try {
    const port = process.env.PORT || 3000
    await fastify.listen({ port, host: '0.0.0.0' })
    console.log(`🚀 TagCloud Backend 运行在 http://localhost:${port}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
