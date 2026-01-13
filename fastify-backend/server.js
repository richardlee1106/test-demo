/**
 * TagCloud AI 后端服务
 * 基于 Fastify 构建的轻量级 API 服务
 * 
 * 集成：
 * - PostgreSQL + PostGIS (空间数据存储与查询)
 * - Milvus (向量检索，可选)
 * - 本地 LLM (意图解析与回答生成)
 */

import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'

// 导入路由
import aiRoutes from './routes/ai/index.js'
import spatialRoutes from './routes/spatial/index.js'

// 导入服务
import { initDatabase, closeDatabase } from './services/database.js'
import { initMilvus, closeMilvus } from './services/milvus.js'

const fastify = Fastify({
  logger: true
})

// 注册 CORS 插件
await fastify.register(cors, {
  origin: true, // 允许所有来源（开发环境）
  methods: ['GET', 'POST', 'OPTIONS']
})

// 注册路由
fastify.register(aiRoutes, { prefix: '/api/ai' })
fastify.register(spatialRoutes, { prefix: '/api/spatial' })

// 健康检查
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() }
})

// 优雅关闭
const gracefulShutdown = async (signal) => {
  console.log(`\n收到 ${signal} 信号，正在关闭服务...`)
  await fastify.close()
  await closeDatabase()
  await closeMilvus()
  process.exit(0)
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

// 启动服务
const start = async () => {
  try {
    // 初始化数据库连接
    console.log('🔌 正在连接数据库...')
    await initDatabase()
    
    // 初始化 Milvus（可选，失败不影响启动）
    console.log('🔌 正在连接 Milvus...')
    await initMilvus()
    
    // 启动 HTTP 服务
    const port = process.env.PORT || 3000
    await fastify.listen({ port, host: '0.0.0.0' })
    console.log(`🚀 TagCloud Backend 运行在 http://localhost:${port}`)
    console.log(`📍 空间查询 API: http://localhost:${port}/api/spatial/query`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
