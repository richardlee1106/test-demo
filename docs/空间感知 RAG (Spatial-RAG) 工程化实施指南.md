# 🌍 空间感知 RAG (Spatial-RAG) 工程化实施指南

> **目标**：让 LLM 像理解文本语义一样理解"南门、对面、500m内"等空间语义，同时节省 Token。

---

## 📋 目录

1. [方案概述](#方案概述)
2. [现有数据评估](#现有数据评估)
3. [技术架构设计](#技术架构设计)
4. [阶段一：数据预处理与存储](#阶段一数据预处理与存储)
5. [阶段二：检索层实现](#阶段二检索层实现)
6. [阶段三：LLM 集成](#阶段三llm-集成)
7. [阶段四：LangChain.js 集成](#阶段四langchainjs-集成)
8. [扩展：GraphRAG（可选）](#扩展graphrag可选)
9. [开发排期建议](#开发排期建议)

---

## 方案概述

### 核心原则

**不要把经纬度当成 embedding 让 LLM "学会空间"，而是分工明确：**

| 处理对象 | 负责组件 | 技术手段 |
|---------|---------|---------|
| 文本语义（咖啡馆、环境安静、评分高） | 向量数据库 | Text Embedding + FAISS |
| 空间关系（南门、对面、500m内） | 空间索引 | GeoHash + Turf.js / PostGIS |
| 自然语言理解 | 本地 LLM | 意图解析 → 结构化 JSON |
| 结果组织 | 本地 LLM | 自然语言回答 + 解释 |

### 查询流程图

```
┌───────────────────────────────────────────────────────────────────────┐
│               用户问："武理工南门对面500m内有哪些评分高于4.5的咖啡馆？"    │
└───────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Step 1: 本地 LLM 意图解析 (Function Calling / JSON Mode)              │
│  输出：{                                                               │
│    "place_name": "武汉理工大学",                                       │
│    "gate": "南门",                                                     │
│    "relative_position": "对面",                                        │
│    "radius_m": 500,                                                    │
│    "min_rating": 4.5,                                                  │
│    "category": "咖啡馆"                                                │
│  }                                                                     │
└───────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Step 2: 地理编码 (锚点坐标解析)                                        │
│  • POI 库查找 "武汉理工大学南门" → [114.359, 30.521]                   │
│  • 若无精确点，反查高德/百度地理编码服务                                 │
└───────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Step 3: 空间过滤 (Turf.js / GeoHash)                                  │
│  • ST_DWithin(geom, center, 500m) 或 GeoHash 前缀匹配                  │
│  • 结果：500m 范围内所有 POI (可能 100+ 条)                             │
└───────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Step 4: 结构化过滤                                                    │
│  • category = "咖啡馆" (或 type 包含 "咖啡")                           │
│  • rating >= 4.5                                                       │
│  • 结果：缩减至 5-20 条                                                 │
└───────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Step 5: 语义排序 (可选，有语义偏好时)                                  │
│  • Query: "环境安静 适合学习" → Embedding                              │
│  • 对候选集做向量相似度排序                                             │
│  • 结果：Top 10                                                        │
└───────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Step 6: LLM 生成回答                                                  │
│  • 输入：10 条 POI 的 {name, distance, rating, address}                │
│  • 输出：自然语言回答 + 推荐理由                                        │
│  • Token 消耗：极少 (仅 10 条记录)                                      │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 现有数据评估

### ✅ 你的 GeoJSON 数据已具备的优秀字段

基于 `麦当劳.geojson` 分析，你的数据非常丰富：

```json
{
  "properties": {
    "poiid": "B001B0I1YM",              // ✅ 唯一标识
    "name": "麦当劳(展览馆餐厅)",         // ✅ 名称
    "address": "解放大道374号...",        // ✅ 地址（语义丰富）
    "type": "餐饮服务;快餐厅;麦当劳",      // ✅ 三级分类
    "typecode": "050302",                // ✅ 类型编码
    "pname": "湖北省",                   // ✅ 省份
    "cityname": "武汉市",                // ✅ 城市
    "adname": "江汉区",                  // ✅ 区域
    "business_a": "万松",                // ✅ 商圈 ⭐ 重要
    "location": "114.273792,30.581234",  // ✅ 坐标字符串
    "tel": "027-85856698",               // ✅ 电话
    "fetch_time": "19/1/2025 06:21:44",  // ✅ 爬取时间
    "大类/中类/小类": "餐饮服务/快餐厅/麦当劳", // ✅ 分类
    "wgs84经ti/纬ti": 114.268378, 30.583691  // ✅ WGS84 坐标
  }
}
```

### 📊 数据质量评估

| 维度 | 状态 | 说明 |
|-----|------|-----|
| 坐标精度 | ✅ 优秀 | 同时有 GCJ-02 和 WGS84 坐标 |
| 语义丰富度 | ✅ 良好 | name + address + type + business_area 可拼接 |
| 分类体系 | ✅ 完整 | 三级分类（大类/中类/小类） |
| 商圈信息 | ✅ 有 | `business_a` 字段（如"万松"、"江滩"） |
| 评分数据 | ❌ 缺失 | 无 rating 字段（需从其他数据源补充或忽略） |
| 描述信息 | ❌ 缺失 | 无 description 字段（可选补充） |

### 🔧 建议的预处理增强

```python
# 构造用于 Embedding 的搜索文本
poi['search_text'] = f"{poi['name']} {poi['type']} {poi['address']} {poi['business_a']} {poi['adname']}"

# 计算 GeoHash (精度 7，约 76m x 110m)
import geohash
poi['geohash'] = geohash.encode(poi['wgs84纬ti'], poi['wgs84经ti'], precision=7)
```

---

## 技术架构设计

### 推荐技术栈（适配你现有项目）

```
┌─────────────────────────────────────────────────────────────────────┐
│                           前端 (Vue 3 + Vite)                        │
│  • MapContainer.vue (OpenLayers 地图)                               │
│  • AiChat.vue (AI 对话界面)                                         │
│  • 新增: SpatialQueryInput.vue (空间查询输入)                        │
└────────────────────────────────────────────────────────────────────┬┘
                                                                     │
┌────────────────────────────────────────────────────────────────────▼┐
│                           后端 (Fastify)                            │
├─────────────────────────────────────────────────────────────────────┤
│  /api/ai/chat        → 现有 LLM 对话                                │
│  /api/ai/search      → 现有语义搜索                                 │
│  /api/spatial/query  → 🆕 空间查询 API                               │
│  /api/spatial/geocode → 🆕 地理编码 API                              │
└────────────────────────────────────────────────────────────────────┬┘
                                                                     │
┌────────────────────────────────────────────────────────────────────▼┐
│                           核心模块                                   │
├─────────────────────────────────────────────────────────────────────┤
│  IntentParser       → LLM 意图解析（JSON 输出）                      │
│  GeocoderService    → 锚点坐标解析                                   │
│  SpatialFilter      → Turf.js 空间过滤                              │
│  EmbeddingService   → LangChain.js + FAISS 向量检索                 │
│  ResponseGenerator  → LLM 结果组织                                   │
└────────────────────────────────────────────────────────────────────┬┘
                                                                     │
┌────────────────────────────────────────────────────────────────────▼┐
│                           数据层                                     │
├─────────────────────────────────────────────────────────────────────┤
│  📁 GeoJSON 文件    → public/split_data/**/*.geojson                │
│  📁 FAISS 索引      → data/faiss_index (search_text embedding)      │
│  📁 锚点知识库      → data/landmarks.json (热门地标坐标)              │
│  📁 GeoHash 索引    → 内存中构建，按 geohash 前缀快速过滤             │
└─────────────────────────────────────────────────────────────────────┘
```

### 为什么选择这套方案？

| 选择 | 理由 |
|-----|------|
| **FAISS (内存)** 而非 PostgreSQL | 你已有 GeoJSON 文件结构，无需引入数据库；FAISS 轻量高效 |
| **Turf.js** 而非 PostGIS | 前后端统一 JavaScript 技术栈，无需额外服务 |
| **GeoHash** 而非 H3 | 更简单，精度 7 (~76m) 足够日常过滤 |
| **LangChain.js** 而非自建 | 成熟的 RAG 工具链，易于集成 |

---

## 阶段一：数据预处理与存储

### 1.1 创建数据预处理脚本

**文件**: `scripts/preprocess_poi.js`

```javascript
/**
 * POI 数据预处理脚本
 * 功能：
 * 1. 遍历所有 GeoJSON 文件
 * 2. 为每个 POI 添加 geohash 和 search_text
 * 3. 生成统一的 POI 索引文件
 */

import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import Geohash from 'latlon-geohash';

const INPUT_DIR = './public/split_data';
const OUTPUT_FILE = './data/poi_index.json';

async function preprocessPOI() {
  const files = await glob(`${INPUT_DIR}/**/*.geojson`);
  const allPOIs = [];
  
  for (const file of files) {
    const content = await fs.readFile(file, 'utf-8');
    const geojson = JSON.parse(content);
    
    for (const feature of geojson.features) {
      const props = feature.properties;
      const coords = feature.geometry.coordinates;
      
      // 使用 WGS84 坐标（如果有）
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
        props.cityname
      ].filter(Boolean).join(' ');
      
      allPOIs.push({
        id: props.poiid || props.OBJECTID,
        name: props.name,
        address: props.address,
        type: props.type,
        category: {
          big: props['大类'],
          mid: props['中类'],
          small: props['小类']
        },
        coordinates: [lon, lat],
        geohash: geohash,
        searchText: searchText,
        business_area: props.business_a,
        district: props.adname,
        tel: props.tel,
        // 原始属性保留
        raw: props
      });
    }
  }
  
  // 保存索引
  await fs.mkdir('./data', { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(allPOIs, null, 2));
  
  console.log(`✅ 处理完成：${allPOIs.length} 个 POI`);
  console.log(`📁 索引保存至：${OUTPUT_FILE}`);
}

preprocessPOI();
```

### 1.2 创建锚点知识库

**文件**: `data/landmarks.json`

```json
{
  "universities": {
    "武汉理工大学": {
      "center": [114.359, 30.521],
      "gates": {
        "南门": [114.359, 30.517],
        "北门": [114.359, 30.525],
        "西门": [114.355, 30.521],
        "东门": [114.363, 30.521]
      }
    },
    "华中科技大学": {
      "center": [114.410, 30.513],
      "gates": {
        "南一门": [114.410, 30.508],
        "正门": [114.400, 30.513]
      }
    }
    // 可继续添加...
  },
  "metro_stations": {
    "光谷广场站": [114.397, 30.505],
    "街道口站": [114.360, 30.524],
    "江汉路站": [114.290, 30.579]
  },
  "landmarks": {
    "楚河汉街": [114.346, 30.553],
    "光谷步行街": [114.403, 30.505],
    "江汉路步行街": [114.290, 30.580]
  }
}
```

### 1.3 GeoHash 工具模块

**文件**: `fastify-backend/utils/geohash.js`

```javascript
import Geohash from 'latlon-geohash';

/**
 * 获取指定中心点周围的 GeoHash 格子
 * @param {number} lat 纬度
 * @param {number} lon 经度
 * @param {number} radiusMeters 半径（米）
 * @param {number} precision GeoHash 精度
 * @returns {string[]} GeoHash 前缀数组
 */
export function getNeighborGeohashes(lat, lon, radiusMeters, precision = 7) {
  const centerHash = Geohash.encode(lat, lon, precision);
  const neighbors = Geohash.neighbours(centerHash);
  
  // 返回中心 + 8 个邻居
  return [centerHash, ...Object.values(neighbors)];
}

/**
 * 快速过滤：检查 POI 是否在目标 GeoHash 集合中
 */
export function filterByGeohash(pois, targetHashes) {
  const hashSet = new Set(targetHashes);
  return pois.filter(poi => {
    // 检查 POI 的 geohash 是否属于目标集合（前缀匹配）
    return targetHashes.some(h => poi.geohash.startsWith(h.slice(0, 5)));
  });
}
```

---

## 阶段二：检索层实现

### 2.1 空间过滤模块

**文件**: `fastify-backend/services/spatialFilter.js`

```javascript
import * as turf from '@turf/turf';

/**
 * 空间过滤服务
 */
export class SpatialFilter {
  
  /**
   * 圆形范围查询
   * @param {Array} pois POI 数组
   * @param {Array} center [lon, lat]
   * @param {number} radiusMeters 半径（米）
   * @returns {Array} 符合条件的 POI
   */
  filterByRadius(pois, center, radiusMeters) {
    const centerPoint = turf.point(center);
    
    return pois.filter(poi => {
      const poiPoint = turf.point(poi.coordinates);
      const distance = turf.distance(centerPoint, poiPoint, { units: 'meters' });
      
      // 添加距离信息
      poi.distance = Math.round(distance);
      return distance <= radiusMeters;
    });
  }
  
  /**
   * 方向过滤（可选，处理"南门对面"等）
   * @param {Array} pois POI 数组
   * @param {Array} center 参考点
   * @param {string} direction 方向 ("东"/"西"/"南"/"北"/"对面")
   * @param {number} tolerance 容差角度
   */
  filterByDirection(pois, center, direction, tolerance = 60) {
    const directionAngles = {
      '东': 90, '西': 270, '南': 180, '北': 0,
      '东北': 45, '东南': 135, '西南': 225, '西北': 315,
      '对面': null // 对面不做方向限制，只用距离
    };
    
    const targetAngle = directionAngles[direction];
    if (targetAngle === null) return pois;
    
    return pois.filter(poi => {
      const bearing = turf.bearing(turf.point(center), turf.point(poi.coordinates));
      const normalizedBearing = (bearing + 360) % 360;
      const diff = Math.abs(normalizedBearing - targetAngle);
      return diff <= tolerance || diff >= (360 - tolerance);
    });
  }
  
  /**
   * 属性过滤
   */
  filterByProperties(pois, filters) {
    return pois.filter(poi => {
      // 类别过滤
      if (filters.category) {
        const typeMatch = poi.type?.includes(filters.category) ||
                          poi.category?.mid?.includes(filters.category) ||
                          poi.category?.small?.includes(filters.category);
        if (!typeMatch) return false;
      }
      
      // 评分过滤（若有）
      if (filters.min_rating && poi.rating) {
        if (poi.rating < filters.min_rating) return false;
      }
      
      return true;
    });
  }
}

export default new SpatialFilter();
```

### 2.2 地理编码服务

**文件**: `fastify-backend/services/geocoder.js`

```javascript
import landmarks from '../data/landmarks.json' assert { type: 'json' };

/**
 * 地理编码服务
 * 将地名 + 门/位置词转换为坐标
 */
export class GeocoderService {
  constructor() {
    this.landmarks = landmarks;
  }
  
  /**
   * 解析锚点坐标
   * @param {string} placeName 地名（如 "武汉理工大学"）
   * @param {string} gate 门/入口（如 "南门"）
   * @returns {Array|null} [lon, lat] 或 null
   */
  resolve(placeName, gate = null) {
    // 1. 尝试从大学库匹配
    for (const [name, data] of Object.entries(this.landmarks.universities)) {
      if (this._fuzzyMatch(placeName, name)) {
        if (gate && data.gates && data.gates[gate]) {
          return data.gates[gate];
        }
        return data.center;
      }
    }
    
    // 2. 尝试从地铁站匹配
    for (const [name, coords] of Object.entries(this.landmarks.metro_stations)) {
      if (this._fuzzyMatch(placeName, name)) {
        return coords;
      }
    }
    
    // 3. 尝试从地标匹配
    for (const [name, coords] of Object.entries(this.landmarks.landmarks)) {
      if (this._fuzzyMatch(placeName, name)) {
        return coords;
      }
    }
    
    // 4. 若本地知识库找不到，可调用高德/百度 API（可选扩展）
    // return await this.callExternalGeocoder(placeName);
    
    return null;
  }
  
  /**
   * 从 POI 库中查找地点坐标
   */
  resolveFromPOI(pois, placeName, gate = null) {
    const searchTerm = gate ? `${placeName}${gate}` : placeName;
    
    // 精确匹配
    let match = pois.find(p => p.name === searchTerm);
    if (match) return match.coordinates;
    
    // 模糊匹配
    match = pois.find(p => p.name.includes(searchTerm) || searchTerm.includes(p.name));
    if (match) return match.coordinates;
    
    return null;
  }
  
  _fuzzyMatch(query, target) {
    // 简单模糊匹配：包含关系 + 常见别名
    const aliases = {
      '武理工': '武汉理工大学',
      '华科': '华中科技大学',
      '武大': '武汉大学',
      '光谷': '光谷广场'
    };
    
    const normalizedQuery = aliases[query] || query;
    return target.includes(normalizedQuery) || normalizedQuery.includes(target);
  }
}

export default new GeocoderService();
```

### 2.3 意图解析模块（LLM JSON 输出）

**文件**: `fastify-backend/services/intentParser.js`

```javascript
/**
 * 意图解析 Prompt 模板
 */
export const INTENT_PARSE_PROMPT = `你是一个地理查询解析器，将用户的自然语言问题转换为结构化 JSON。

## 输出格式
{
  "place_name": "地名，如"武汉理工大学"",
  "gate": "门/入口，如"南门"，无则为 null",
  "relative_position": "相对位置词，如"对面""旁边""附近"，无则为 null",
  "radius_m": "距离范围（米），如 500，无则为 null",
  "category": "POI 类别，如"咖啡馆""奶茶店""餐厅"",
  "min_rating": "最低评分，如 4.5，无则为 null",
  "semantic_query": "用于语义搜索的描述，如"环境安静适合学习"，无则为 null",
  "sort_by": "排序方式：distance/rating/relevance"
}

## 规则
1. "武理工"→"武汉理工大学"，"华科"→"华中科技大学" 等常见别名需展开
2. "500米内""500m以内""方圆500米" 都解析为 radius_m: 500
3. "附近""周边""旁边" 如果没有明确距离，默认 radius_m: 500
4. 只输出 JSON，不要其他解释

## 用户问题
{user_query}`;

/**
 * 解析 LLM 返回的 JSON
 */
export function parseIntentResponse(llmResponse) {
  try {
    // 尝试提取 JSON（处理可能的 markdown 代码块）
    let json = llmResponse;
    const jsonMatch = llmResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      json = jsonMatch[1].trim();
    }
    
    return JSON.parse(json);
  } catch (e) {
    console.error('Intent parse failed:', e);
    return null;
  }
}
```

---

## 阶段三：LLM 集成

### 3.1 空间查询 API 路由

**文件**: `fastify-backend/routes/spatial/index.js`

```javascript
import spatialFilter from '../../services/spatialFilter.js';
import geocoder from '../../services/geocoder.js';
import { INTENT_PARSE_PROMPT, parseIntentResponse } from '../../services/intentParser.js';
import { loadPOIIndex } from '../../utils/dataLoader.js';

export default async function spatialRoutes(fastify) {
  
  /**
   * 空间查询 API
   * POST /api/spatial/query
   */
  fastify.post('/query', async (request, reply) => {
    const { query, pois } = request.body;
    
    // 1. 加载 POI 索引
    const allPOIs = pois || await loadPOIIndex();
    
    // 2. 调用本地 LLM 解析意图
    const prompt = INTENT_PARSE_PROMPT.replace('{user_query}', query);
    const intentResponse = await callLocalLLM(prompt);
    const intent = parseIntentResponse(intentResponse);
    
    if (!intent) {
      return reply.code(400).send({ error: '无法解析查询意图' });
    }
    
    // 3. 解析锚点坐标
    let center = geocoder.resolve(intent.place_name, intent.gate);
    if (!center) {
      center = geocoder.resolveFromPOI(allPOIs, intent.place_name, intent.gate);
    }
    
    if (!center) {
      return reply.code(404).send({ 
        error: `无法找到 "${intent.place_name}${intent.gate || ''}" 的位置`,
        intent 
      });
    }
    
    // 4. 空间过滤
    let candidates = spatialFilter.filterByRadius(
      allPOIs, 
      center, 
      intent.radius_m || 500
    );
    
    // 5. 方向过滤（可选）
    if (intent.relative_position && intent.relative_position !== '附近') {
      candidates = spatialFilter.filterByDirection(
        candidates, center, intent.relative_position
      );
    }
    
    // 6. 属性过滤
    candidates = spatialFilter.filterByProperties(candidates, {
      category: intent.category,
      min_rating: intent.min_rating
    });
    
    // 7. 排序
    if (intent.sort_by === 'distance') {
      candidates.sort((a, b) => a.distance - b.distance);
    }
    
    // 8. 取 Top N
    const results = candidates.slice(0, 20);
    
    // 9. 返回结果 + 意图（用于调试）
    return {
      success: true,
      center,
      intent,
      total: candidates.length,
      results: results.map(p => ({
        id: p.id,
        name: p.name,
        address: p.address,
        category: p.category,
        distance: p.distance,
        coordinates: p.coordinates
      }))
    };
  });
  
  /**
   * 完整的空间对话 API（含 LLM 回答生成）
   */
  fastify.post('/chat', async (request, reply) => {
    const { query, pois } = request.body;
    
    // 执行空间查询
    const spatialResult = await fastify.inject({
      method: 'POST',
      url: '/api/spatial/query',
      payload: { query, pois }
    });
    
    const result = JSON.parse(spatialResult.body);
    
    if (!result.success) {
      return result;
    }
    
    // 构造 LLM Context
    const context = result.results.map((p, i) => 
      `${i+1}. ${p.name} - 距离${p.distance}米 - ${p.address}`
    ).join('\n');
    
    // 调用 LLM 生成回答
    const answerPrompt = `用户问：${query}

根据以下搜索结果回答用户问题，不要虚构不存在的地点：

${context}

请给出简洁、友好的回答。`;
    
    const answer = await callLocalLLM(answerPrompt);
    
    return {
      ...result,
      answer
    };
  });
}

/**
 * 调用本地 LLM（复用现有 aiService 逻辑）
 */
async function callLocalLLM(prompt) {
  // 这里复用你现有的本地 LLM 调用逻辑
  const response = await fetch('http://localhost:1234/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen3-4b-instruct-2507',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3
    })
  });
  
  const data = await response.json();
  return data.choices[0].message.content;
}
```

---

## 阶段四：LangChain.js 集成

### 4.1 安装依赖

```bash
cd fastify-backend
npm install langchain @langchain/community faiss-node
```

### 4.2 向量存储模块

**文件**: `fastify-backend/services/vectorStore.js`

```javascript
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Document } from "langchain/document";
import fs from 'fs/promises';

// 使用本地 Embedding 服务（LM Studio 的 text-embedding）
// 或替换为你的本地 embedding 模型
class LocalEmbeddings {
  constructor() {
    this.baseUrl = 'http://localhost:1234/v1';
  }
  
  async embedDocuments(texts) {
    const embeddings = [];
    for (const text of texts) {
      const emb = await this.embedQuery(text);
      embeddings.push(emb);
    }
    return embeddings;
  }
  
  async embedQuery(text) {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'text-embedding-nomic-embed-text-v1.5',
        input: text
      })
    });
    const data = await response.json();
    return data.data[0].embedding;
  }
}

/**
 * 构建 FAISS 向量索引
 */
export async function buildVectorIndex(pois, outputPath) {
  const embeddings = new LocalEmbeddings();
  
  // 转换为 LangChain 文档
  const docs = pois.map(poi => new Document({
    pageContent: poi.searchText,
    metadata: {
      id: poi.id,
      name: poi.name,
      coordinates: poi.coordinates,
      geohash: poi.geohash
    }
  }));
  
  console.log(`Building FAISS index for ${docs.length} POIs...`);
  
  const vectorStore = await FaissStore.fromDocuments(docs, embeddings);
  await vectorStore.save(outputPath);
  
  console.log(`✅ FAISS index saved to ${outputPath}`);
  return vectorStore;
}

/**
 * 加载 FAISS 索引
 */
export async function loadVectorIndex(indexPath) {
  const embeddings = new LocalEmbeddings();
  return await FaissStore.load(indexPath, embeddings);
}

/**
 * 语义搜索（在空间过滤结果上做二次排序）
 */
export async function semanticSearch(vectorStore, query, candidateIds, topK = 10) {
  const results = await vectorStore.similaritySearchWithScore(query, topK * 2);
  
  // 过滤只保留候选集中的结果
  const candidateSet = new Set(candidateIds);
  const filtered = results.filter(([doc, score]) => 
    candidateSet.has(doc.metadata.id)
  );
  
  return filtered.slice(0, topK).map(([doc, score]) => ({
    ...doc.metadata,
    score
  }));
}
```

### 4.3 混合检索服务

**文件**: `fastify-backend/services/hybridSearch.js`

```javascript
import spatialFilter from './spatialFilter.js';
import { loadVectorIndex, semanticSearch } from './vectorStore.js';

let vectorStore = null;

/**
 * 初始化向量存储
 */
export async function initHybridSearch() {
  vectorStore = await loadVectorIndex('./data/faiss_index');
  console.log('✅ Vector store loaded');
}

/**
 * 混合检索：空间过滤 + 语义排序
 */
export async function hybridSearch(pois, center, radius, semanticQuery, filters = {}) {
  // 1. 空间过滤
  let candidates = spatialFilter.filterByRadius(pois, center, radius);
  
  // 2. 属性过滤
  candidates = spatialFilter.filterByProperties(candidates, filters);
  
  // 3. 如果有语义查询，做向量相似度排序
  if (semanticQuery && vectorStore) {
    const candidateIds = candidates.map(p => p.id);
    const semanticResults = await semanticSearch(
      vectorStore, 
      semanticQuery, 
      candidateIds, 
      20
    );
    
    // 按语义相关性重排
    const scoreMap = new Map(semanticResults.map(r => [r.id, r.score]));
    candidates.sort((a, b) => {
      const scoreA = scoreMap.get(a.id) || Infinity;
      const scoreB = scoreMap.get(b.id) || Infinity;
      return scoreA - scoreB;
    });
  }
  
  return candidates;
}
```

---

## 扩展：GraphRAG（可选）

如果后续需要处理更复杂的空间推理（如"步行10分钟可达""沿途经过"等），可以考虑引入图数据库：

### 图结构设计

```
节点类型：
- POI (咖啡馆、餐厅等)
- Landmark (地标、校门、地铁站)
- Road (道路)
- District (区域/商圈)

边类型：
- NEAR_BY (距离 < 200m)
- OPPOSITE (对面)
- WITHIN (POI 属于某商圈)
- CONNECTED (道路连接)
- WALKABLE (步行可达，带时间权重)
```

### 示例查询（Cypher）

```cypher
// 从武理工南门步行10分钟内的咖啡馆
MATCH (gate:Landmark {name: '武汉理工大学南门'})
MATCH (gate)-[r:WALKABLE*1..3]-(poi:POI {category: '咖啡馆'})
WHERE reduce(time = 0, rel IN r | time + rel.walk_minutes) <= 10
RETURN poi
ORDER BY poi.rating DESC
LIMIT 10
```

---

## 开发排期建议

### 第一周：数据预处理 + 基础架构

| 任务 | 优先级 | 预估耗时 |
|-----|-------|---------|
| 创建 `preprocess_poi.js` 脚本 | P0 | 2h |
| 整理 `landmarks.json` 锚点库 | P0 | 2h |
| 实现 `spatialFilter.js` | P0 | 3h |
| 实现 `geocoder.js` | P0 | 2h |
| 单元测试 | P1 | 2h |

### 第二周：LLM 意图解析 + API

| 任务 | 优先级 | 预估耗时 |
|-----|-------|---------|
| 设计 Intent Parse Prompt | P0 | 2h |
| 实现 `/api/spatial/query` | P0 | 4h |
| 实现 `/api/spatial/chat` | P0 | 3h |
| 前端集成测试 | P1 | 3h |

### 第三周：LangChain.js + 向量检索

| 任务 | 优先级 | 预估耗时 |
|-----|-------|---------|
| 配置本地 Embedding 服务 | P0 | 2h |
| 构建 FAISS 索引 | P0 | 3h |
| 实现混合检索 | P1 | 4h |
| 性能优化 | P2 | 3h |

### 第四周：优化 + 扩展

| 任务 | 优先级 | 预估耗时 |
|-----|-------|---------|
| 锚点库自动扩充（从 POI 提取） | P1 | 3h |
| 方向过滤优化 | P2 | 2h |
| GraphRAG 原型（可选） | P3 | 5h |
| 文档完善 | P1 | 2h |

---

## 📚 参考资料

- [Spatial-RAG: Spatial Retrieval Augmented Generation](https://arxiv.org/abs/2502.18470)
- [LangChain.js 官方文档](https://js.langchain.com/)
- [Turf.js 空间分析库](https://turfjs.org/)
- [FAISS 向量索引](https://faiss.ai/)
- [GeoHash 编码说明](https://en.wikipedia.org/wiki/Geohash)
- [Qdrant 地理向量搜索](https://geo.rocks/post/geospatial-vector-search-qdrant/)

---

> 📅 文档创建时间：2026-01-12  
> 📝 作者：TagCloud WebGIS 开发团队
