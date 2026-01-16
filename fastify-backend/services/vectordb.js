/**
 * pgvector 向量数据库服务
 * 用于 POI 语义搜索和 Embedding 管理
 *
 * 替代 Milvus，使用 PostgreSQL + pgvector 扩展
 * 优势：统一数据库架构，更轻量，不需要额外容器
 */

import { getPool, query } from "./database.js";

const EMBEDDING_DIM = 768; // nomic-embed-text 输出维度
let vectorTableReady = false;

/**
 * 初始化 pgvector 扩展和表
 */
export async function initVectorDB() {
  try {
    // 1. 确保 pgvector 扩展已安装
    await query("CREATE EXTENSION IF NOT EXISTS vector");
    console.log("✅ pgvector 扩展已启用");

    // 2. 创建向量表（如果不存在）
    await query(`
      CREATE TABLE IF NOT EXISTS poi_embeddings (
        id SERIAL PRIMARY KEY,
        poi_id INTEGER REFERENCES pois(id) ON DELETE CASCADE,
        name VARCHAR(500),
        embedding vector(${EMBEDDING_DIM}),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(poi_id)
      )
    `);

    // 3. 创建向量索引 (使用 IF NOT EXISTS 更加健壮)
    console.log("正在确保向量索引 (HNSW) 已创建...");
    await query(`
      CREATE INDEX IF NOT EXISTS poi_embeddings_vector_idx 
      ON poi_embeddings 
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
    `);
    console.log("✅ 向量索引检查完成");

    vectorTableReady = true;
    console.log("✅ pgvector 向量表已就绪");

    // 统计向量数量
    const countResult = await query("SELECT COUNT(*) FROM poi_embeddings");
    console.log(`📊 向量库中已有 ${countResult.rows[0].count} 条 embedding`);

    return true;
  } catch (err) {
    console.error("❌ pgvector 初始化失败:", err.message);
    if (err.message.includes('extension "vector" is not available')) {
      console.log("💡 提示: 请安装 pgvector 扩展");
      console.log("   参考: https://github.com/pgvector/pgvector#installation");
    }
    vectorTableReady = false;
    return false;
  }
}

/**
 * 检查向量数据库是否可用
 */
export function isVectorDBAvailable() {
  return vectorTableReady;
}

/**
 * 插入单条 POI Embedding
 * @param {Object} record {poi_id, name, embedding}
 */
export async function insertEmbedding(record) {
  if (!vectorTableReady) {
    console.warn("pgvector 不可用，跳过 embedding 插入");
    return;
  }

  const { poi_id, name, embedding } = record;

  // 将数组转换为 pgvector 格式: [1,2,3] -> '[1,2,3]'
  const vectorStr = `[${embedding.join(",")}]`;

  await query(
    `
    INSERT INTO poi_embeddings (poi_id, name, embedding)
    VALUES ($1, $2, $3::vector)
    ON CONFLICT (poi_id) DO UPDATE SET
      name = EXCLUDED.name,
      embedding = EXCLUDED.embedding,
      created_at = NOW()
  `,
    [poi_id, name, vectorStr]
  );
}

/**
 * 批量插入 POI Embedding
 * @param {Array} pois POI 数组
 * @param {Function} embedFn 生成 embedding 的函数
 * @param {number} batchSize 批次大小
 */
export async function batchInsertEmbeddings(pois, embedFn, batchSize = 50) {
  if (!vectorTableReady) {
    console.warn("pgvector 不可用，跳过 embedding 插入");
    return;
  }

  let successCount = 0;

  for (let i = 0; i < pois.length; i += batchSize) {
    const batch = pois.slice(i, i + batchSize);

    // 生成 embedding
    const texts = batch.map((p) => p.searchText || p.name);
    const embeddings = await embedFn(texts);

    // 批量插入
    for (let j = 0; j < batch.length; j++) {
      try {
        await insertEmbedding({
          poi_id: batch[j].id,
          name: batch[j].name,
          embedding: embeddings[j],
        });
        successCount++;
      } catch (err) {
        console.error(`插入 POI ${batch[j].id} 失败:`, err.message);
      }
    }

    console.log(`[pgvector] 已插入 ${successCount}/${pois.length} 条记录`);
  }

  return successCount;
}

/**
 * 语义搜索
 * @param {Array} queryEmbedding 查询向量
 * @param {number} topK 返回数量
 * @param {Array} candidateIds 候选 ID 列表（用于二次筛选）
 * @returns {Promise<Array>} 搜索结果
 */
export async function semanticSearch(
  queryEmbedding,
  topK = 20,
  candidateIds = null
) {
  if (!vectorTableReady) {
    console.warn("pgvector 不可用，返回空结果");
    return [];
  }

  const vectorStr = `[${queryEmbedding.join(",")}]`;

  let sql;
  let params;

  if (candidateIds && candidateIds.length > 0) {
    // 在候选集中搜索
    sql = `
      SELECT 
        e.poi_id,
        e.name,
        1 - (e.embedding <=> $1::vector) AS score
      FROM poi_embeddings e
      WHERE e.poi_id = ANY($2)
      ORDER BY e.embedding <=> $1::vector
      LIMIT $3
    `;
    params = [vectorStr, candidateIds, topK];
  } else {
    // 全库搜索
    sql = `
      SELECT 
        e.poi_id,
        e.name,
        1 - (e.embedding <=> $1::vector) AS score
      FROM poi_embeddings e
      ORDER BY e.embedding <=> $1::vector
      LIMIT $2
    `;
    params = [vectorStr, topK];
  }

  const result = await query(sql, params);

  return result.rows.map((r) => ({
    id: `poi_${r.poi_id}`,
    poi_id: r.poi_id,
    name: r.name,
    score: parseFloat(r.score),
  }));
}

/**
 * 混合搜索：先空间过滤，再语义排序
 * @param {Array} spatialCandidates 空间过滤后的候选 POI
 * @param {string} semanticQuery 语义查询文本
 * @param {Function} embedFn embedding 函数
 * @param {number} topK 返回数量
 */
export async function hybridSearch(
  spatialCandidates,
  semanticQuery,
  embedFn,
  topK = 20
) {
  if (!vectorTableReady || !semanticQuery) {
    // 如果向量库不可用或没有语义查询，直接返回空间结果
    return spatialCandidates.slice(0, topK);
  }

  // 1. 生成查询 embedding
  const queryEmbedding = await embedFn([semanticQuery]);

  // 2. 在候选集中进行语义搜索
  const candidateIds = spatialCandidates.map((p) => p.id);
  const semanticResults = await semanticSearch(
    queryEmbedding[0],
    topK * 2,
    candidateIds
  );

  // 3. 按语义相关性重排
  const scoreMap = new Map(semanticResults.map((r) => [r.poi_id, r.score]));

  const reranked = spatialCandidates
    .map((poi) => ({
      ...poi,
      semantic_score: scoreMap.get(poi.id) || 0,
    }))
    .sort((a, b) => b.semantic_score - a.semantic_score);

  return reranked.slice(0, topK);
}

/**
 * 清空向量表
 */
export async function clearVectorDB() {
  if (!vectorTableReady) return;

  await query("TRUNCATE TABLE poi_embeddings");
  console.log("✅ 向量表已清空");
}

/**
 * 获取向量统计信息
 */
export async function getVectorStats() {
  if (!vectorTableReady) {
    return { available: false, count: 0 };
  }

  const result = await query("SELECT COUNT(*) as count FROM poi_embeddings");
  return {
    available: true,
    count: parseInt(result.rows[0].count),
  };
}

/**
 * 关闭向量数据库（兼容 Milvus API）
 */
export async function closeVectorDB() {
  // pgvector 使用 PostgreSQL 连接池，无需单独关闭
  vectorTableReady = false;
  console.log("pgvector 服务已关闭");
}

// 向后兼容的别名（保持与 Milvus 相同的 API）
export {
  initVectorDB as initMilvus,
  isVectorDBAvailable as isMilvusAvailable,
  closeVectorDB as closeMilvus,
  insertEmbedding as insertEmbeddings,
};

export default {
  initVectorDB,
  isVectorDBAvailable,
  insertEmbedding,
  batchInsertEmbeddings,
  semanticSearch,
  hybridSearch,
  clearVectorDB,
  closeVectorDB,
  getVectorStats,
};
