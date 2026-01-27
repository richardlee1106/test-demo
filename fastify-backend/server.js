/**
 * GeoLoom-RAG 后端服务
 * 基于 Fastify 构建的轻量级 API 服务
 * 
 * 集成：
 * - PostgreSQL + PostGIS (空间数据存储与查询)
 * - pgvector (向量检索，统一在 PostgreSQL 中)
 * - 本地 LLM (意图解析与回答生成)
 */

import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'

// 导入路由
import aiRoutes from './routes/ai/index.js'
import spatialRoutes from './routes/spatial/index.js'
import searchRoutes from './routes/search.js'
import categoryRoutes from './routes/category.js'

// 导入服务
import { initDatabase, closeDatabase } from './services/database.js'
import { initVectorDB, closeVectorDB } from './services/vectordb.js'

const fastify = Fastify({
  logger: true
})

// 注册 CORS 插件
await fastify.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
})

// 注册路由
fastify.register(aiRoutes, { prefix: '/api/ai' })
fastify.register(spatialRoutes, { prefix: '/api/spatial' })
fastify.register(searchRoutes, { prefix: '/api/search' })
fastify.register(categoryRoutes, { prefix: '/api/category' })

// 健康检查
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() }
})

// 优雅关闭
const gracefulShutdown = async (signal) => {
  console.log(`\n收到 ${signal} 信号，正在关闭服务...`)
  await fastify.close()
  await closeDatabase()
  await closeVectorDB()
  process.exit(0)
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

// 启动服务
const start = async () => {
  try {
    // 初始化数据库连接
    console.log('🔌 正在连接 PostgreSQL + PostGIS...')
    await initDatabase()
    
    // 初始化 pgvector（向量检索，可选，失败不影响启动）
    console.log('🔌 正在初始化 pgvector 向量扩展...')
    await initVectorDB()
    
    // 启动 HTTP 服务
    const port = parseInt(process.env.PORT) || 3100
    const host = '0.0.0.0'
    await fastify.listen({ port, host })
    
    console.log(`\n🚀 GeoLoom-RAG Backend 运行在 http://${host}:${port}`)
    console.log(`🤖 LLM API 端点: ${process.env.LLM_BASE_URL || '未配置'}`)
    console.log(`📍 空间查询 API: http://${host}:${port}/api/spatial/query`)
    console.log(`🔍 快速搜索 API: http://${host}:${port}/api/search/quick\n`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
