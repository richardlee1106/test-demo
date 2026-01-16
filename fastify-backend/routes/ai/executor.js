/**
 * 阶段 2: Executor (执行器)
 * 
 * 职责：
 * - 根据 QueryPlan 调用 PostGIS / Milvus / 图数据库
 * - 完成空间过滤、聚合统计、语义精排
 * - 返回压缩后的结果 JSON（供 Writer 使用）
 * - 绝不调用 LLM
 */

import db from '../../services/database.js'
import vectordb from '../../services/vectordb.js'
import { resolveAnchor } from '../../services/geocoder.js'
import Geohash from 'latlon-geohash'
import { generateEmbedding } from '../../services/llm.js'

/**
 * 执行器配置
 */
const EXECUTOR_CONFIG = {
  maxCandidates: 200,       // 空间过滤后最大候选数
  maxResults: 30,           // 最终返回给 Writer 的最大 POI 数
  maxLandmarks: 5,          // 最大代表性地标数
  defaultRadius: 1000,      // 默认搜索半径（米）
}

/**
 * 阶段 2 主入口：执行查询
 * 
 * @param {Object} queryPlan - Planner 输出的查询计划
 * @param {Array} frontendPOIs - 前端传来的 POI 数据（用于区域分析模式）
 * @returns {Promise<Object>} ExecutorResult
 */
export async function executeQuery(queryPlan, frontendPOIs = [], options = {}) {
  const startTime = Date.now()
  
  console.log(`[Executor] 开始执行: ${queryPlan.query_type}`)
  
  try {
    let result
    
    // 根据 QueryPlan 决定执行路径
    if (queryPlan.need_graph_reasoning) {
      result = await execGraphMode(queryPlan, frontendPOIs, options)
    } else if (queryPlan.need_global_context) {
      result = await execGlobalContextMode(queryPlan, frontendPOIs, options)
    } else {
      result = await execBasicMode(queryPlan, frontendPOIs, options)
    }
    
    // 添加执行统计
    result.stats.execution_time_ms = Date.now() - startTime
    
    console.log(`[Executor] 执行完成 (${result.stats.execution_time_ms}ms): ${result.pois.length} POIs`)
    
    return { success: true, results: result }
  } catch (err) {
    console.error('[Executor] 执行失败:', err.message)
    return {
      success: false,
      error: err.message,
      results: {
        mode: 'error',
        anchor: null,
        pois: [],
        area_profile: null,
        landmarks: [],
        stats: {
          execution_time_ms: Date.now() - startTime,
          error: err.message
        }
      }
    }
  }
}

/**
 * 基础模式：POI 搜索（80% 场景）
 * 
 * 流程：
 * 1. 解析锚点 → 坐标
 * 2. PostGIS 空间+类别+评分过滤
 * 3. Milvus 语义精排（可选）
 * 4. 压缩结果
 */
async function execBasicMode(plan, frontendPOIs, options = {}) {
  const result = {
    mode: 'basic',
    anchor: null,
    pois: [],
    area_profile: null,
    landmarks: [],
    stats: {
      total_candidates: 0,
      filtered_count: 0,
      semantic_rerank_applied: false
    }
  }

  // 0. 解析空间硬边界 (从前端 spatialContext 中提取)
  let hardBoundaryWKT = null
  const spatialContext = options.spatialContext
  
  if (spatialContext) {
    if (spatialContext.boundary && spatialContext.mode === 'Polygon') {
      hardBoundaryWKT = pointsToWKT(spatialContext.boundary)
    } else if (spatialContext.center && spatialContext.mode === 'Circle') {
      // 如果是圆选区，后端构建一个搜索圆（或者简单转为矩形 WKT）
      hardBoundaryWKT = circleToWKT(spatialContext.center, plan.radius_m || 500)
    } else if (spatialContext.viewport && Array.isArray(spatialContext.viewport)) {
      // 如果没画选区，但有视野范围，将视野作为硬边界
      hardBoundaryWKT = bboxToWKT(spatialContext.viewport)
    }
    
    // Store WKT in result for downstream use (e.g. global context)
    if (hardBoundaryWKT) {
      result.hardBoundaryWKT = hardBoundaryWKT;
    }

    if (hardBoundaryWKT) {
      // 计算空间指纹 (GeoHash)
      try {
        let centerLon, centerLat
        if (spatialContext.center) {
          centerLon = spatialContext.center.lon
          centerLat = spatialContext.center.lat
        } else if (spatialContext.viewport && Array.isArray(spatialContext.viewport)) {
          centerLon = (spatialContext.viewport[0] + spatialContext.viewport[2]) / 2
          centerLat = (spatialContext.viewport[1] + spatialContext.viewport[3]) / 2
        } else if (spatialContext.boundary && spatialContext.boundary.length > 0) {
          centerLon = spatialContext.boundary[0][0]
          centerLat = spatialContext.boundary[0][1]
        }

        if (centerLon !== undefined && centerLat !== undefined) {
          const fingerprint = Geohash.encode(centerLat, centerLon, 7)
          console.log(`[Executor] 空间指纹 (GeoHash): ${fingerprint}, 范围: ${spatialContext.mode || 'Viewport'}`)
        }
      } catch (e) {
        console.warn('[Executor] GeoHash 计算失败:', e.message)
      }
    }
  }
  
  // 0.1 意图深度分析：检查是否需要“跨库”检索
  // 如果本地数据 (frontendPOIs) 的主要类别与用户要求的类别不重合，必须强制数据库检索
  const safeFrontendPOIs = Array.isArray(frontendPOIs) ? frontendPOIs : []
  const currentLocalCategories = [...new Set(safeFrontendPOIs.map(f => {
    const p = f.properties || f
    return p['大类'] || p.category
  }))].filter(Boolean)
  
  const isCategoryMismatch = plan.categories && plan.categories.length > 0 && 
                            !plan.categories.some(cat => currentLocalCategories.some(lc => 
                              String(lc).toLowerCase().includes(String(cat).toLowerCase()) || 
                              String(cat).toLowerCase().includes(String(lc).toLowerCase())
                            ))
  
  if (isCategoryMismatch) {
    console.log(`[Executor] 检测到类型错配: 内存数据为 [${currentLocalCategories.slice(0,3)}...]，而用户正在搜 [${plan.categories}]。强制开启全库检索模式。`)
  }
  
  // 1. 解析锚点
  let anchorCoords = null
  if (plan.anchor?.type === 'landmark' && plan.anchor?.name) {
    const anchorName = plan.anchor.gate 
      ? `${plan.anchor.name}${plan.anchor.gate}` 
      : plan.anchor.name
    
    anchorCoords = await resolveAnchor(anchorName)
    if (anchorCoords) {
      result.anchor = {
        name: anchorName,
        lon: anchorCoords.lon,
        lat: anchorCoords.lat,
        resolved_from: anchorCoords.source || 'geocoder'
      }
    }
  }
  
  // 1.5 提取空间指纹 (Spatial Fingerprint)
  let geoSignature = null
  let viewCenter = null
  
  if (spatialContext) {
    viewCenter = spatialContext.center || (spatialContext.viewport ? { 
      lon: (spatialContext.viewport[0] + spatialContext.viewport[2]) / 2, 
      lat: (spatialContext.viewport[1] + spatialContext.viewport[3]) / 2 
    } : null)
  }

  // 如果解析到了视野中心，且没有地名锚点，将其作为参考锚点
  if (viewCenter && !anchorCoords) {
    result.anchor = {
      name: '当前视野中心',
      lon: viewCenter.lon,
      lat: viewCenter.lat,
      resolved_from: 'viewport'
    }
  }

  if (viewCenter) {
    geoSignature = Geohash.encode(viewCenter.lat, viewCenter.lon, 6)
    try {
      const neighbors = Geohash.neighbours(geoSignature)
      const neighborList = Object.values(neighbors).slice(0, 3)
      console.log(`[Executor] 空间签名: ${geoSignature}, 视野邻居: [${neighborList}...]`)
    } catch (e) {
      console.log(`[Executor] 空间签名: ${geoSignature}`)
    }
  }

  // 2. 空间过滤决策逻辑 (重构版)
  let candidates = []
  let radius = plan.radius_m || EXECUTOR_CONFIG.defaultRadius
  const maxRetries = 3

  // 如果没有明确的地名锚点，但我们有了空间指纹中心，则以中心为锚点检索全库
  const effectiveAnchor = anchorCoords || viewCenter
  
  // 记录决策踪迹供 Debug 和 Session Log 使用
  result.stats.spatial_trace = {
    is_category_mismatch: isCategoryMismatch,
    has_hard_boundary: !!hardBoundaryWKT,
    effective_anchor_type: anchorCoords ? 'landmark' : (viewCenter ? 'viewport' : 'none'),
    geo_signature: geoSignature
  }

  console.log(`[Executor] 决策流: Mismatch=${isCategoryMismatch}, HardBound=${!!hardBoundaryWKT}, EffectiveAnchor=${!!effectiveAnchor}`)

  if (hardBoundaryWKT || isCategoryMismatch || effectiveAnchor) {
    // 强制进入数据库检索流程 (全域感知生效)
    console.log('[Executor] >>> 触发全库检索逻辑 (全域感知生效)')
    
    if (hardBoundaryWKT) {
      console.log(`[Executor] 执行 WKT 几何过滤检索...`)
      candidates = await searchFromDatabase(effectiveAnchor, radius, plan, hardBoundaryWKT)
    } else if (effectiveAnchor) {
      console.log(`[Executor] 执行位置锚点检索: ${effectiveAnchor.lon.toFixed(4)}, ${effectiveAnchor.lat.toFixed(4)}, 半径: ${radius}m`)
      
      // 初始化调试信息收集
      result.stats.debug_info = []

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        candidates = await searchFromDatabase(effectiveAnchor, radius, plan)
        
        // 记录每次尝试的调试信息
        result.stats.debug_info.push({
          attempt: attempt + 1,
          radius: radius,
          count: candidates.length,
          sample: candidates.length > 0 ? candidates[0].name : 'none'
        })

        console.log(`[Executor Debug] 第 ${attempt+1} 次尝试结果: ${candidates.length} 条`)
        if (candidates.length > 0) {
           console.log(`[Executor Debug] 首条数据样本:`, JSON.stringify(candidates[0]))
           break
        }
        radius = Math.min(radius * 2, 5000)
        console.log(`[Executor] 未搜到，扩大半径至 ${radius}m 重试...`)
      }
    }
  }

  // 3. 兜底逻辑：如果全库也没搜到，或者是为了补全信息，尝试过滤前端数据
  if (candidates.length === 0 && safeFrontendPOIs.length > 0) {
    console.log(`[Executor] 降级使用前端缓存数据 (${safeFrontendPOIs.length}条) 过滤`)
    candidates = filterFromFrontendPOIs(safeFrontendPOIs, plan, anchorCoords)
  }
  
  result.stats.total_candidates = candidates.length
  
  // 3. 语义精排（如果有语义偏好且 Milvus 可用）
  let ranked = candidates
  if (plan.semantic_query && vectordb.isVectorDBAvailable() && candidates.length > 0) {
    ranked = await semanticRerank(candidates, plan.semantic_query, plan.max_results)
    result.stats.semantic_rerank_applied = true
  } else {
    // 按距离或评分排序
    ranked = sortCandidates(candidates, plan.sort_by)
  }
  
  // 4. 限制结果数量并压缩
  const limited = ranked.slice(0, Math.min(plan.max_results, EXECUTOR_CONFIG.maxResults))
  result.pois = compressPOIs(limited, result.anchor?.name)
  result.stats.filtered_count = result.pois.length
  
  // 5. 提取地标（如果需要）
  if (plan.need_landmarks && (anchorCoords || hardBoundaryWKT)) {
    result.landmarks = await extractLandmarks(safeFrontendPOIs, anchorCoords || viewCenter, radius)
  }
  
  return result
}

/**
 * 区域画像模式：需要统计分析
 * 
 * 在基础模式基础上，增加：
 * - 类别分布统计
 * - 代表性地标提取
 */
async function execGlobalContextMode(plan, frontendPOIs, options = {}) {
  const result = {
    mode: 'global_context',
    anchor: null,
    pois: [],
    area_profile: null,
    landmarks: [],
    stats: {
      total_candidates: 0,
      filtered_count: 0,
      semantic_rerank_applied: false,
      skip_poi_search: false
    }
  }
  
  // 检查是否为纯区域分析（无特定类别要求）
  const isPureAreaAnalysis = (
    plan.query_type === 'area_analysis' && 
    (!plan.categories || plan.categories.length === 0) &&
    !plan.semantic_query
  )
  
  // 解析空间边界
  let hardBoundaryWKT = null
  const spatialContext = options.spatialContext
  
  if (spatialContext) {
    if (spatialContext.boundary && spatialContext.mode === 'Polygon') {
      hardBoundaryWKT = pointsToWKT(spatialContext.boundary)
    } else if (spatialContext.center && spatialContext.mode === 'Circle') {
      hardBoundaryWKT = circleToWKT(spatialContext.center, plan.radius_m || 500)
    } else if (spatialContext.viewport && Array.isArray(spatialContext.viewport)) {
      hardBoundaryWKT = bboxToWKT(spatialContext.viewport)
    }
  }
  
  result.hardBoundaryWKT = hardBoundaryWKT
  
  // 计算视野中心作为锚点
  let viewCenter = null
  if (spatialContext) {
    viewCenter = spatialContext.center || (spatialContext.viewport ? { 
      lon: (spatialContext.viewport[0] + spatialContext.viewport[2]) / 2, 
      lat: (spatialContext.viewport[1] + spatialContext.viewport[3]) / 2 
    } : null)
  }
  
  if (viewCenter) {
    result.anchor = {
      name: '当前视野中心',
      lon: viewCenter.lon,
      lat: viewCenter.lat,
      resolved_from: 'viewport'
    }
  }
  
  // ========================
  // 核心优化：纯区域分析时跳过 POI 检索
  // ========================
  if (isPureAreaAnalysis) {
    console.log('[Executor] 纯区域分析模式: 跳过 POI 列表检索，仅计算区域画像')
    result.stats.skip_poi_search = true
    
    // 直接计算区域画像
    if (frontendPOIs.length > 0) {
      result.area_profile = computeAreaProfile(frontendPOIs)
    } else if (hardBoundaryWKT) {
      result.area_profile = await computeAreaProfileFromDB(hardBoundaryWKT, null)
    } else if (viewCenter) {
      result.area_profile = await computeAreaProfileFromDB(
        viewCenter,
        plan.radius_m || EXECUTOR_CONFIG.defaultRadius
      )
    }
    
    // 提取代表性地标（不需要完整 POI 列表）
    if (plan.need_landmarks && viewCenter) {
      result.landmarks = await db.getRepresentativeLandmarks(
        viewCenter,
        plan.radius_m || EXECUTOR_CONFIG.defaultRadius,
        EXECUTOR_CONFIG.maxLandmarks
      )
    }
    
    return result
  }
  
  // ========================
  // 非纯区域分析：执行完整的 POI 搜索
  // ========================
  const basicResult = await execBasicMode(
    { ...plan, need_landmarks: true },
    frontendPOIs,
    options
  )
  
  // 合并结果
  Object.assign(result, basicResult)
  result.mode = 'global_context'
  
  // 计算区域画像
  if (frontendPOIs.length > 0) {
    result.area_profile = computeAreaProfile(frontendPOIs)
  } else if (result.hardBoundaryWKT) {
    result.area_profile = await computeAreaProfileFromDB(result.hardBoundaryWKT, null)
  } else if (result.anchor) {
    result.area_profile = await computeAreaProfileFromDB(
      result.anchor,
      plan.radius_m || EXECUTOR_CONFIG.defaultRadius
    )
  }
  
  return result
}

/**
 * 图推理模式：路径/连通性分析
 * 
 * 注意：图数据库暂未实现，此为占位逻辑
 */
async function execGraphMode(plan, frontendPOIs, options = {}) {
  console.log('[Executor] 图推理模式暂未实现，降级为区域画像模式')
  
  // 降级为区域画像模式
  const result = await execGlobalContextMode(
    { ...plan, need_graph_reasoning: false },
    frontendPOIs,
    options
  )
  
  result.mode = 'graph'
  result.graph_result = {
    paths: [],
    message: '图数据库功能开发中'
  }
  
  return result
}

// =====================================================
// 辅助函数
// =====================================================

/**
 * 从数据库搜索 POI
 */
/**
 * 从数据库搜索 POI
 */
async function searchFromDatabase(anchor, radius, plan, geometryWKT = null) {
  console.log('[Executor Debug] 进入 searchFromDatabase. Anchor:', anchor, 'Radius:', radius, 'Cats:', plan.categories);
  try {
    if (!db || typeof db.findPOIsFiltered !== 'function') {
      throw new Error('Database service or findPOIsFiltered method is missing')
    }

    // 统一调用 db.findPOIsFiltered，它已经封装了 WKT/Radius 和强大的类别过滤逻辑
    return await db.findPOIsFiltered({
      anchor: anchor, 
      radius_m: radius,
      categories: plan.categories || [],
      rating_range: plan.rating_range,
      geometry: geometryWKT,
      limit: EXECUTOR_CONFIG.maxCandidates
    });
  } catch (err) {
    console.error('[Executor] searchFromDatabase 严重错误:', err)
    return []
  }
}

/**
 * 从前端 POI 数据中过滤
 * @param {Array} pois - 前端 POI 列表
 * @param {Object} plan - 查询计划
 * @param {Object} [anchorCoords] - 锚点坐标 {lat, lon} (可选，用于距离过滤)
 */
function filterFromFrontendPOIs(pois, plan, anchorCoords = null) {
  let filtered = [...pois]
  
  // 空间距离过滤 (如果提供了锚点)
  if (anchorCoords && plan.radius_m) {
    filtered = filtered.filter(poi => {
      const coords = poi.geometry?.coordinates || []
      // GeoJSON is [lon, lat]
      if (coords.length === 2) {
        const dist = calculateDistance(anchorCoords.lat, anchorCoords.lon, coords[1], coords[0])
        // 将计算出的距离附加到 POI 对象上，以便排序
        poi.distance_meters = dist
        return dist <= plan.radius_m
      }
      return false
    })
  }

  // 类别过滤
  if (plan.categories && plan.categories.length > 0) {
    const categories = plan.categories.map(c => c.toLowerCase())
    filtered = filtered.filter(poi => {
      const props = poi.properties || poi
      const searchText = `${props['名称'] || ''} ${props['大类'] || ''} ${props['中类'] || ''} ${props['小类'] || ''} ${props.type || ''}`.toLowerCase()
      // 宽松匹配：只要包含任何一个关键词即可
      return categories.some(cat => searchText.includes(cat))
    })
  }
  
  // 评分过滤
  if (plan.rating_range?.[0]) {
    filtered = filtered.filter(poi => {
      const rating = poi.properties?.rating || poi.rating || 0
      return rating >= plan.rating_range[0]
    })
  }
  
  return filtered
}

/**
 * 语义精排
 */
async function semanticRerank(candidates, semanticQuery, topK) {
  try {
    // 生成查询 embedding
    const embedding = await generateEmbedding(semanticQuery)
    if (!embedding) {
      return candidates.slice(0, topK)
    }
    
    // 在候选集中搜索
    const candidateIds = candidates.map(p => p.id).filter(Boolean)
    if (candidateIds.length === 0) {
      return candidates.slice(0, topK)
    }
    
    const semanticResults = await vectordb.semanticSearch(embedding, topK * 2, candidateIds)
    
    // 按语义相关性重排
    const scoreMap = new Map(semanticResults.map(r => [r.poi_id, r.score]))
    
    return candidates
      .map(poi => ({
        ...poi,
        semantic_score: scoreMap.get(poi.id) || 0
      }))
      .sort((a, b) => b.semantic_score - a.semantic_score)
      .slice(0, topK)
  } catch (err) {
    console.error('[Executor] 语义精排失败:', err.message)
    return candidates.slice(0, topK)
  }
}

/**
 * 排序候选 POI
 */
function sortCandidates(candidates, sortBy) {
  if (!sortBy || sortBy === 'distance') {
    return candidates.sort((a, b) => 
      (a.distance_meters || a.distance_m || Infinity) - 
      (b.distance_meters || b.distance_m || Infinity)
    )
  }
  
  if (sortBy === 'rating') {
    return candidates.sort((a, b) => {
      const ratingA = a.rating || a.properties?.rating || 0
      const ratingB = b.rating || b.properties?.rating || 0
      return ratingB - ratingA
    })
  }
  
  return candidates
}

/**
 * 压缩 POI 数据（只保留 Writer 需要的字段）
 */
function compressPOIs(pois, anchorName = '') {
  return pois.map(poi => {
    const props = poi.properties || poi
    
    return {
      id: poi.id || props.id || poi.poiid,
      name: props['名称'] || props.name || poi.name || '未命名',
      lon: props.lon || poi.lon || (poi.geometry?.coordinates ? poi.geometry.coordinates[0] : null),
      lat: props.lat || poi.lat || (poi.geometry?.coordinates ? poi.geometry.coordinates[1] : null),
      category: props['小类'] || props['中类'] || props.category_small || poi.category_mid || props.type || '',
      rating: props.rating || poi.rating || null,
      distance_m: Math.round(poi.distance_meters || poi.distance_m || 0),
      anchor_name: anchorName,
      tags: extractTags(props),
      address: props['地址'] || props.address || poi.address || ''
    }
  })
}

/**
 * 从 POI 属性中提取标签
 */
function extractTags(props) {
  const tags = []
  
  // 从中类/小类提取
  if (props['中类']) tags.push(props['中类'])
  if (props['小类']) tags.push(props['小类'])
  
  // 从语义描述提取（如果有）
  if (props.tags && Array.isArray(props.tags)) {
    tags.push(...props.tags)
  }
  
  return [...new Set(tags)].slice(0, 3)
}

/**
 * 计算区域画像（从前端数据）
 */
function computeAreaProfile(pois) {
  const categoryStats = {}
  
  pois.forEach(poi => {
    const props = poi.properties || poi
    const cat = props['大类'] || props.category_big || props.type || '未分类'
    
    if (!categoryStats[cat]) {
      categoryStats[cat] = { count: 0, examples: [], ratings: [] }
    }
    
    categoryStats[cat].count++
    
    if (categoryStats[cat].examples.length < 2) {
      const name = props['名称'] || props.name
      if (name) categoryStats[cat].examples.push(name)
    }
    
    const rating = props.rating
    if (rating) categoryStats[cat].ratings.push(rating)
  })
  
  // 转换为排序后的数组
  const total = pois.length
  const sorted = Object.entries(categoryStats)
    .map(([category, data]) => ({
      category,
      count: data.count,
      percentage: Math.round(data.count / total * 1000) / 10,
      avg_rating: data.ratings.length > 0 
        ? Math.round(data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length * 10) / 10 
        : null,
      examples: data.examples
    }))
    .sort((a, b) => b.count - a.count)
  
  return {
    total_count: total,
    dominant_categories: sorted.slice(0, 5),
    rare_categories: sorted.filter(c => c.count <= 2).slice(0, 3)
  }
}

/**
 * 从数据库计算区域画像
 */
/**
 * 从数据库计算区域画像 (支持 锚点+半径 或 WKT几何)
 */
async function computeAreaProfileFromDB(anchorOrWkt, radius) {
  try {
    // 1. 如果第一个参数是 WKT 字符串 (POLYGON/MULTIPOLYGON)
    if (typeof anchorOrWkt === 'string' && (anchorOrWkt.startsWith('POLYGON') || anchorOrWkt.startsWith('MULTIPOLYGON'))) {
       return await db.getCategoryStatsByGeometry(anchorOrWkt);
    }

    // 2. 否则视为传统的 anchor 对象 + 半径
    const profile = await db.getCategoryStats(anchorOrWkt, radius)
    return profile
  } catch (err) {
    console.error('[Executor] 数据库区域画像查询失败:', err.message)
    return {
      total_count: 0,
      dominant_categories: [],
      rare_categories: []
    }
  }
}

/**
 * 提取代表性地标
 */
async function extractLandmarks(frontendPOIs, anchor, radius) {
  const landmarkTypes = ['地铁站', '学校', '大学', '医院', '商场', '广场', '公园', '银行']
  const landmarks = []
  
  // 从前端 POI 中提取
  for (const poi of frontendPOIs) {
    const props = poi.properties || poi
    const category = `${props['大类'] || ''} ${props['中类'] || ''} ${props['小类'] || ''} ${props.type || ''}`
    
    for (const type of landmarkTypes) {
      if (category.includes(type)) {
        // 计算距离（如果有锚点）
        let distance_m = 0
        if (anchor && poi.geometry?.coordinates) {
          distance_m = calculateDistance(
            anchor.lat, anchor.lon,
            poi.geometry.coordinates[1], poi.geometry.coordinates[0]
          )
        }
        
        landmarks.push({
          name: props['名称'] || props.name || '未命名',
          type,
          distance_m: Math.round(distance_m),
          relevance_score: getLandmarkRelevanceScore(type)
        })
        break
      }
    }
    
    if (landmarks.length >= EXECUTOR_CONFIG.maxLandmarks) break
  }
  
  // 按相关性排序
  return landmarks.sort((a, b) => b.relevance_score - a.relevance_score)
}

/**
 * 地标类型相关性打分
 */
function getLandmarkRelevanceScore(type) {
  const scores = {
    '地铁站': 10,
    '学校': 8,
    '大学': 9,
    '医院': 7,
    '商场': 6,
    '广场': 5,
    '公园': 4,
    '银行': 3
  }
  return scores[type] || 1
}

/**
 * 计算两点间距离（Haversine 公式）
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000 // 地球半径（米）
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * 将坐标点数组转换为 WKT Polygon
 */
function pointsToWKT(points) {
  if (!points || !Array.isArray(points) || points.length < 3) return null
  
  const closedPoints = [...points]
  const first = closedPoints[0]
  const last = closedPoints[closedPoints.length - 1]
  
  if (first[0] !== last[0] || first[1] !== last[1]) {
    closedPoints.push(first)
  }
  
  const wktPoints = closedPoints.map(p => `${p[0]} ${p[1]}`).join(', ')
  return `POLYGON((${wktPoints}))`
}

/**
 * 将视野边界 [minLon, minLat, maxLon, maxLat] 转换为 WKT Polygon
 */
function bboxToWKT(bbox) {
  if (!bbox || bbox.length !== 4) return null
  const [minLon, minLat, maxLon, maxLat] = bbox
  return `POLYGON((${minLon} ${minLat}, ${maxLon} ${minLat}, ${maxLon} ${maxLat}, ${minLon} ${maxLat}, ${minLon} ${minLat}))`
}

/**
 * 将圆心和半径转换为 WKT Polygon (近似圆)
 */
function circleToWKT(center, radiusM) {
  if (!center) return null
  const { lon, lat } = center
  // 简易处理：生成一个包围圆的外接正方形 WKT
  const offset = radiusM / 111320 // 粗略转换：111km ≈ 1度
  const minLon = lon - (offset / Math.cos(lat * Math.PI / 180))
  const maxLon = lon + (offset / Math.cos(lat * Math.PI / 180))
  const minLat = lat - offset
  const maxLat = lat + offset
  return bboxToWKT([minLon, minLat, maxLon, maxLat])
}

export default {
  executeQuery,
  EXECUTOR_CONFIG
}
