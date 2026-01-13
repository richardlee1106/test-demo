/**
 * Milvus 向量数据库服务
 * 用于 POI 语义搜索和 Embedding 管理
 */

import { MilvusClient, DataType } from '@zilliz/milvus2-sdk-node';

let client = null;
const COLLECTION_NAME = process.env.MILVUS_COLLECTION || 'poi_embeddings';
const EMBEDDING_DIM = 768; // nomic-embed-text 输出维度，根据实际模型调整

/**
 * 初始化 Milvus 连接
 */
export async function initMilvus() {
  if (client) return client;
  
  const host = process.env.MILVUS_HOST || 'localhost';
  const port = process.env.MILVUS_PORT || '19530';
  
  client = new MilvusClient({
    address: `${host}:${port}`,
  });
  
  try {
    // 检查连接
    const health = await client.checkHealth();
    console.log(`✅ Milvus 连接成功 (${health.isHealthy ? 'healthy' : 'unhealthy'})`);
    
    // 确保集合存在
    await ensureCollection();
    
  } catch (err) {
    console.error('❌ Milvus 连接失败:', err.message);
    console.log('💡 提示: 请确保 Milvus 服务已启动 (docker-compose up -d)');
    // 不抛出错误，允许系统在没有 Milvus 时降级运行
    client = null;
  }
  
  return client;
}

/**
 * 确保集合存在
 */
async function ensureCollection() {
  const hasCollection = await client.hasCollection({ collection_name: COLLECTION_NAME });
  
  if (!hasCollection.value) {
    console.log(`创建 Milvus 集合: ${COLLECTION_NAME}`);
    
    await client.createCollection({
      collection_name: COLLECTION_NAME,
      fields: [
        {
          name: 'id',
          data_type: DataType.VarChar,
          is_primary_key: true,
          max_length: 100,
        },
        {
          name: 'poi_id',
          data_type: DataType.Int64,
          description: 'PostgreSQL POI ID',
        },
        {
          name: 'name',
          data_type: DataType.VarChar,
          max_length: 500,
        },
        {
          name: 'embedding',
          data_type: DataType.FloatVector,
          dim: EMBEDDING_DIM,
        },
      ],
    });
    
    // 创建索引
    await client.createIndex({
      collection_name: COLLECTION_NAME,
      field_name: 'embedding',
      index_type: 'IVF_FLAT',
      metric_type: 'COSINE',
      params: { nlist: 1024 },
    });
    
    console.log(`✅ Milvus 集合 ${COLLECTION_NAME} 创建完成`);
  }
  
  // 加载集合到内存
  await client.loadCollection({ collection_name: COLLECTION_NAME });
}

/**
 * 获取 Milvus 客户端
 */
export function getMilvusClient() {
  return client;
}

/**
 * 检查 Milvus 是否可用
 */
export function isMilvusAvailable() {
  return client !== null;
}

/**
 * 插入 POI Embedding
 * @param {Array} records [{id, poi_id, name, embedding}]
 */
export async function insertEmbeddings(records) {
  if (!client) {
    console.warn('Milvus 不可用，跳过 embedding 插入');
    return;
  }
  
  await client.insert({
    collection_name: COLLECTION_NAME,
    data: records,
  });
}

/**
 * 批量插入 POI Embedding
 * @param {Array} pois POI 数组
 * @param {Function} embedFn 生成 embedding 的函数
 * @param {number} batchSize 批次大小
 */
export async function batchInsertEmbeddings(pois, embedFn, batchSize = 100) {
  if (!client) {
    console.warn('Milvus 不可用，跳过 embedding 插入');
    return;
  }
  
  for (let i = 0; i < pois.length; i += batchSize) {
    const batch = pois.slice(i, i + batchSize);
    
    // 生成 embedding
    const texts = batch.map(p => p.searchText || p.name);
    const embeddings = await embedFn(texts);
    
    // 构造记录
    const records = batch.map((poi, idx) => ({
      id: `poi_${poi.id}`,
      poi_id: poi.id,
      name: poi.name,
      embedding: embeddings[idx],
    }));
    
    await insertEmbeddings(records);
    console.log(`[Milvus] 已插入 ${i + batch.length}/${pois.length} 条记录`);
  }
}

/**
 * 语义搜索
 * @param {Array} queryEmbedding 查询向量
 * @param {number} topK 返回数量
 * @param {Array} candidateIds 候选 ID 列表（用于二次筛选）
 * @returns {Promise<Array>} 搜索结果
 */
export async function semanticSearch(queryEmbedding, topK = 20, candidateIds = null) {
  if (!client) {
    console.warn('Milvus 不可用，返回空结果');
    return [];
  }
  
  let filter = null;
  if (candidateIds && candidateIds.length > 0) {
    // 只在候选集中搜索
    filter = `poi_id in [${candidateIds.join(',')}]`;
  }
  
  const searchResult = await client.search({
    collection_name: COLLECTION_NAME,
    vector: queryEmbedding,
    limit: topK,
    filter: filter,
    output_fields: ['id', 'poi_id', 'name'],
  });
  
  return searchResult.results.map(r => ({
    id: r.id,
    poi_id: r.poi_id,
    name: r.name,
    score: r.score,
  }));
}

/**
 * 混合搜索：先空间过滤，再语义排序
 * @param {Array} spatialCandidates 空间过滤后的候选 POI
 * @param {string} semanticQuery 语义查询文本
 * @param {Function} embedFn embedding 函数
 * @param {number} topK 返回数量
 */
export async function hybridSearch(spatialCandidates, semanticQuery, embedFn, topK = 20) {
  if (!client || !semanticQuery) {
    // 如果 Milvus 不可用或没有语义查询，直接返回空间结果
    return spatialCandidates.slice(0, topK);
  }
  
  // 1. 生成查询 embedding
  const queryEmbedding = await embedFn([semanticQuery]);
  
  // 2. 在候选集中进行语义搜索
  const candidateIds = spatialCandidates.map(p => p.id);
  const semanticResults = await semanticSearch(queryEmbedding[0], topK * 2, candidateIds);
  
  // 3. 按语义相关性重排
  const scoreMap = new Map(semanticResults.map(r => [r.poi_id, r.score]));
  
  const reranked = spatialCandidates
    .map(poi => ({
      ...poi,
      semantic_score: scoreMap.get(poi.id) || 0,
    }))
    .sort((a, b) => b.semantic_score - a.semantic_score);
  
  return reranked.slice(0, topK);
}

/**
 * 删除集合中所有数据
 */
export async function clearCollection() {
  if (!client) return;
  
  await client.dropCollection({ collection_name: COLLECTION_NAME });
  await ensureCollection();
  console.log(`✅ Milvus 集合 ${COLLECTION_NAME} 已清空并重建`);
}

/**
 * 关闭 Milvus 连接
 */
export async function closeMilvus() {
  if (client) {
    await client.closeConnection();
    client = null;
    console.log('Milvus 连接已关闭');
  }
}

export default {
  initMilvus,
  getMilvusClient,
  isMilvusAvailable,
  insertEmbeddings,
  batchInsertEmbeddings,
  semanticSearch,
  hybridSearch,
  clearCollection,
  closeMilvus,
};
