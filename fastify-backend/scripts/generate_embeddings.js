/**
 * 为已导入的 POI 生成 Embedding
 * 仅处理那些还没有 Embedding 的记录
 * 
 * 使用方法:
 *   node scripts/generate_embeddings.js
 */

import 'dotenv/config';
import { initDatabase, query, closeDatabase } from '../services/database.js';
import { initMilvus, closeMilvus, isMilvusAvailable, insertEmbeddings, clearCollection } from '../services/milvus.js';

const BATCH_SIZE = 50;
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:1234/v1';
const EMBEDDING_MODEL = process.env.LLM_EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5';

/**
 * 生成单个文本的 Embedding
 */
async function generateEmbedding(text) {
  const response = await fetch(`${LLM_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  
  if (!response.ok) {
    throw new Error(`Embedding API 返回错误: ${response.status}`);
  }
  
  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * 检查 Embedding API 是否可用
 */
async function checkEmbeddingAPI() {
  console.log('🔍 检查 Embedding API...');
  
  try {
    const embedding = await generateEmbedding('测试文本');
    console.log(`✅ Embedding API 可用，向量维度: ${embedding.length}`);
    return embedding.length;
  } catch (err) {
    console.error(`❌ Embedding API 不可用: ${err.message}`);
    console.error(`\n请确保 LM Studio 已启动并加载了 Embedding 模型：`);
    console.error(`  1. 打开 LM Studio`);
    console.error(`  2. 加载 nomic-embed-text 或类似的 embedding 模型`);
    console.error(`  3. 确保服务运行在 ${LLM_BASE_URL}\n`);
    return 0;
  }
}

/**
 * 从 PostgreSQL 获取所有 POI
 */
async function getAllPOIs() {
  const result = await query(`
    SELECT id, name, search_text 
    FROM pois 
    ORDER BY id
  `);
  return result.rows;
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 开始生成 POI Embeddings...\n');
  
  // 1. 检查 Embedding API
  const embeddingDim = await checkEmbeddingAPI();
  if (embeddingDim === 0) {
    process.exit(1);
  }
  
  // 2. 初始化数据库
  await initDatabase();
  
  // 3. 初始化 Milvus
  await initMilvus();
  if (!isMilvusAvailable()) {
    console.error('❌ Milvus 不可用');
    process.exit(1);
  }
  
  // 4. 询问是否清空现有 Embedding
  console.log('\n⚠️  将清空现有 Milvus 集合并重新生成所有 Embedding');
  console.log('如果不想清空，请按 Ctrl+C 取消\n');
  
  // 等待 3 秒
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // 5. 清空现有集合
  console.log('🗑️  清空现有 Milvus 集合...');
  await clearCollection();
  
  // 6. 获取所有 POI
  const pois = await getAllPOIs();
  console.log(`📦 共有 ${pois.length} 个 POI 需要处理\n`);
  
  let processed = 0;
  let failed = 0;
  
  // 7. 批量处理
  for (let i = 0; i < pois.length; i += BATCH_SIZE) {
    const batch = pois.slice(i, i + BATCH_SIZE);
    const records = [];
    
    for (const poi of batch) {
      try {
        const text = poi.search_text || poi.name;
        const embedding = await generateEmbedding(text);
        
        records.push({
          id: `poi_${poi.id}`,
          poi_id: poi.id,
          name: poi.name,
          embedding: embedding,
        });
        
        processed++;
      } catch (err) {
        console.warn(`  ⚠️ ${poi.name}: ${err.message}`);
        failed++;
      }
    }
    
    // 插入到 Milvus
    if (records.length > 0) {
      await insertEmbeddings(records);
    }
    
    // 显示进度
    const progress = Math.round((i + batch.length) / pois.length * 100);
    console.log(`[${progress}%] 已处理 ${i + batch.length}/${pois.length}，成功 ${processed}，失败 ${failed}`);
  }
  
  console.log(`\n✅ Embedding 生成完成！`);
  console.log(`   成功: ${processed}`);
  console.log(`   失败: ${failed}`);
  
  await closeDatabase();
  await closeMilvus();
}

main().catch(err => {
  console.error('生成失败:', err);
  process.exit(1);
});
