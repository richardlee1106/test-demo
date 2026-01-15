#!/usr/bin/env node
/**
 * 向量迁移脚本：从 Milvus 迁移到 pgvector
 * 
 * 用法:
 *   node scripts/migrate_to_pgvector.js
 * 
 * 功能:
 *   1. 读取 POI 数据
 *   2. 生成 embedding
 *   3. 写入 PostgreSQL pgvector 表
 */

import 'dotenv/config';
import { initDatabase, closeDatabase, query } from '../services/database.js';
import { initVectorDB, batchInsertEmbeddings, getVectorStats } from '../services/vectordb.js';

const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:1234/v1';
const EMBEDDING_MODEL = process.env.LLM_EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5';

/**
 * 生成文本的 embedding
 * @param {string[]} texts 文本数组
 * @returns {Promise<Array<number[]>>} embedding 数组
 */
async function generateEmbeddings(texts) {
  try {
    const response = await fetch(`${LLM_BASE_URL}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Embedding API 返回 ${response.status}`);
    }
    
    const data = await response.json();
    return data.data.map(d => d.embedding);
  } catch (err) {
    console.error('[Embedding] 生成失败:', err.message);
    // 返回空数组，跳过这批
    return texts.map(() => null);
  }
}

/**
 * 获取所有 POI 数据
 */
async function getAllPOIs() {
  const sql = `
    SELECT 
      id,
      name,
      COALESCE(category_big, '') as category_big,
      COALESCE(category_mid, '') as category_mid,
      COALESCE(category_small, '') as category_small,
      COALESCE(type, '') as type
    FROM pois
    WHERE name IS NOT NULL AND name != ''
    ORDER BY id
  `;
  
  const result = await query(sql);
  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    // 构建用于 embedding 的搜索文本
    searchText: [
      row.name,
      row.category_big,
      row.category_mid,
      row.category_small,
      row.type
    ].filter(Boolean).join(' ')
  }));
}

/**
 * 主迁移函数
 */
async function migrate() {
  console.log('='.repeat(60));
  console.log('🚀 GeoLoom-RAG 向量迁移工具');
  console.log('   Milvus → PostgreSQL pgvector');
  console.log('='.repeat(60));
  
  try {
    // 1. 连接数据库
    console.log('\n📡 连接 PostgreSQL...');
    await initDatabase();
    
    // 2. 初始化 pgvector
    console.log('\n🔧 初始化 pgvector 扩展...');
    const vectorReady = await initVectorDB();
    if (!vectorReady) {
      console.error('❌ pgvector 初始化失败，请先安装 pgvector 扩展');
      console.log('\n安装方法 (Debian/Ubuntu):');
      console.log('  sudo apt install postgresql-16-pgvector');
      console.log('\n或使用 Docker:');
      console.log('  docker pull pgvector/pgvector:pg16');
      process.exit(1);
    }
    
    // 3. 检查现有向量数量
    const stats = await getVectorStats();
    console.log(`\n📊 当前 pgvector 表已有 ${stats.count} 条记录`);
    
    // 4. 获取 POI 数据
    console.log('\n📦 读取 POI 数据...');
    const pois = await getAllPOIs();
    console.log(`   共 ${pois.length} 条 POI`);
    
    if (pois.length === 0) {
      console.log('⚠️ 没有 POI 数据，迁移结束');
      return;
    }
    
    // 5. 批量生成 embedding 并插入
    console.log('\n🧬 开始生成 embedding 并写入 pgvector...');
    console.log(`   (使用模型: ${EMBEDDING_MODEL})`);
    
    const startTime = Date.now();
    await batchInsertEmbeddings(pois, generateEmbeddings, 50);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    // 6. 验证结果
    const finalStats = await getVectorStats();
    console.log(`\n✅ 迁移完成!`);
    console.log(`   - 耗时: ${elapsed} 秒`);
    console.log(`   - pgvector 表记录数: ${finalStats.count}`);
    
    console.log('\n💡 提示: 您可以安全地停止 Milvus 服务并删除相关容器');
    console.log('   docker-compose down milvus etcd minio');
    
  } catch (err) {
    console.error('\n❌ 迁移失败:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

// 运行迁移
migrate();
