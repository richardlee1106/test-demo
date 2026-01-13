/**
 * POI 数据导入脚本
 * 将 GeoJSON 文件导入 PostgreSQL + Milvus
 * 
 * 使用方法:
 *   node scripts/import_poi_data.js
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import Geohash from 'latlon-geohash';
import { initDatabase, query, closeDatabase } from '../services/database.js';
import { initMilvus, batchInsertEmbeddings, closeMilvus, isMilvusAvailable } from '../services/milvus.js';

const INPUT_DIR = '../public/split_data';

/**
 * 生成 Embedding（使用本地 LLM Studio）
 */
async function generateEmbeddings(texts) {
  const baseUrl = process.env.LLM_BASE_URL || 'http://localhost:1234/v1';
  const model = process.env.LLM_EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5';
  
  const embeddings = [];
  
  for (const text of texts) {
    try {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: text }),
      });
      
      const data = await response.json();
      embeddings.push(data.data[0].embedding);
    } catch (err) {
      console.warn(`Embedding 生成失败: ${text.substring(0, 50)}...`, err.message);
      // 返回零向量作为 fallback
      embeddings.push(new Array(768).fill(0));
    }
  }
  
  return embeddings;
}

/**
 * 解析单个 POI Feature
 */
function parsePOIFeature(feature) {
  const props = feature.properties;
  const coords = feature.geometry.coordinates;
  
  // 优先使用 WGS84 坐标
  const lon = props['wgs84经ti'] || coords[0];
  const lat = props['wgs84纬ti'] || coords[1];
  
  // 生成 GeoHash (精度 7，约 76m x 110m)
  const geohash = Geohash.encode(lat, lon, 7);
  
  // 构造搜索文本
  const searchText = [
    props.name,
    props.type,
    props.address,
    props.business_a,
    props.adname,
    props.cityname,
  ].filter(Boolean).join(' ');
  
  // 解析爬取时间
  let fetchTime = null;
  if (props.fetch_time) {
    try {
      // 格式: "19/1/2025 06:21:44"
      const [datePart, timePart] = props.fetch_time.split(' ');
      const [day, month, year] = datePart.split('/');
      fetchTime = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timePart}`);
    } catch (e) {
      // 忽略解析错误
    }
  }
  
  return {
    poiid: props.poiid || props.OBJECTID?.toString(),
    name: props.name,
    address: props.address,
    type: props.type,
    typecode: props.typecode,
    category_big: props['大类'],
    category_mid: props['中类'],
    category_small: props['小类'],
    province: props.pname,
    city: props.cityname,
    district: props.adname,
    business_area: props.business_a?.trim() || null,
    lon,
    lat,
    geohash,
    tel: props.tel,
    search_text: searchText,
    fetch_time: fetchTime,
  };
}

/**
 * 批量插入 POI 到 PostgreSQL
 */
async function insertPOIBatch(pois) {
  if (pois.length === 0) return [];
  
  const insertedIds = [];
  
  for (const poi of pois) {
    try {
      const sql = `
        INSERT INTO pois (
          poiid, name, address, type, typecode,
          category_big, category_mid, category_small,
          province, city, district, business_area,
          geom, geohash, tel, search_text, fetch_time
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8,
          $9, $10, $11, $12,
          ST_SetSRID(ST_MakePoint($13, $14), 4326), $15, $16, $17, $18
        )
        ON CONFLICT (poiid) DO UPDATE SET
          name = EXCLUDED.name,
          address = EXCLUDED.address,
          type = EXCLUDED.type,
          geom = EXCLUDED.geom,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id
      `;
      
      const result = await query(sql, [
        poi.poiid,
        poi.name,
        poi.address,
        poi.type,
        poi.typecode,
        poi.category_big,
        poi.category_mid,
        poi.category_small,
        poi.province,
        poi.city,
        poi.district,
        poi.business_area,
        poi.lon,
        poi.lat,
        poi.geohash,
        poi.tel,
        poi.search_text,
        poi.fetch_time,
      ]);
      
      if (result.rows.length > 0) {
        insertedIds.push({
          id: result.rows[0].id,
          name: poi.name,
          searchText: poi.search_text,
        });
      }
    } catch (err) {
      console.error(`插入 POI 失败: ${poi.name}`, err.message);
    }
  }
  
  return insertedIds;
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 开始导入 POI 数据...\n');
  
  // 1. 初始化数据库连接
  await initDatabase();
  
  // 2. 尝试初始化 Milvus（可选）
  await initMilvus();
  const useMilvus = isMilvusAvailable();
  if (useMilvus) {
    console.log('📦 Milvus 可用，将同步生成 Embedding\n');
  } else {
    console.log('⚠️ Milvus 不可用，仅导入 PostgreSQL\n');
  }
  
  // 3. 扫描所有 GeoJSON 文件
  const files = await glob(`${INPUT_DIR}/**/*.geojson`);
  console.log(`📁 发现 ${files.length} 个 GeoJSON 文件\n`);
  
  let totalPOIs = 0;
  let totalInserted = 0;
  const allInsertedPOIs = [];
  
  // 4. 逐文件处理
  for (const file of files) {
    const relativePath = path.relative(INPUT_DIR, file);
    console.log(`处理: ${relativePath}`);
    
    try {
      const content = await fs.readFile(file, 'utf-8');
      const geojson = JSON.parse(content);
      
      if (!geojson.features || geojson.features.length === 0) {
        console.log('  (空文件，跳过)');
        continue;
      }
      
      // 解析 POI
      const pois = geojson.features.map(parsePOIFeature);
      totalPOIs += pois.length;
      
      // 批量插入 PostgreSQL
      const insertedPOIs = await insertPOIBatch(pois);
      totalInserted += insertedPOIs.length;
      allInsertedPOIs.push(...insertedPOIs);
      
      console.log(`  ✅ 已插入 ${insertedPOIs.length}/${pois.length} 条`);
      
    } catch (err) {
      console.error(`  ❌ 处理失败: ${err.message}`);
    }
  }
  
  console.log(`\n📊 PostgreSQL 导入完成: ${totalInserted}/${totalPOIs} 条\n`);
  
  // 5. 生成并插入 Milvus Embedding
  if (useMilvus && allInsertedPOIs.length > 0) {
    console.log('🔄 开始生成 Embedding 并导入 Milvus...');
    
    await batchInsertEmbeddings(allInsertedPOIs, generateEmbeddings, 50);
    
    console.log(`✅ Milvus 导入完成: ${allInsertedPOIs.length} 条\n`);
  }
  
  // 6. 关闭连接
  await closeDatabase();
  await closeMilvus();
  
  console.log('🎉 所有数据导入完成！');
}

main().catch(err => {
  console.error('导入失败:', err);
  process.exit(1);
});
