/**
 * 阶段 2: Executor (执行器)
 * 
 * 职责：
 * - 根据 QueryPlan 调用 PostGIS / Pgvector / 图数据库
 * - 完成空间过滤、聚合统计、语义精排
 * - 返回压缩后的结果 JSON（供 Writer 使用）
 * - 绝不调用 LLM
 */

import db from '../../services/database.js'
import vectordb from '../../services/vectordb.js'
import { resolveAnchor } from '../../services/geocoder.js'
import h3 from 'h3-js'
import { generateEmbedding } from '../../services/llm.js'
// Phase 2 优化：查询缓存
import queryCache from '../../services/queryCache.js'
// Phase 3 优化：POI 智能过滤
import poiFilter from '../../services/poiFilter.js'
// Phase 3 优化：空结果拓展搜索
import expansionSearch from '../../services/expansionSearch.js'
// Phase 3 优化：几何计算 (凸包生成)
import geometry from '../../services/geometry.js'
// Phase 4 优化：空间聚类分析 (KDE + DBSCAN)
import clustering from '../../services/clustering.js'
// Phase 5 优化：模糊区域生成 (Fuzzy Region)
import fuzzyRegion from '../../services/fuzzyRegion.js'

/**
 * 执行器配置
 */
const EXECUTOR_CONFIG = {
  maxCandidates: 500,         // 普通搜索最大候选数
  maxAnalysisCandidates: 100000, // 聚合分析最大候选数 (放开限制，全域分析)
  maxResults: 50,             // 最终返回给 Writer 的最大 POI 数
  maxLandmarks: 8,            // 最大代表性地标数
  defaultRadius: 2000,        // 默认搜索半径（米）
  h3Resolution: 9,            // H3 索引精度 (Res 9 边长约为 174m) - 默认值
  
  // H3 分辨率对照表 (Phase 1 优化：动态分辨率)
  // Res 7: ~1.2km 边长 - 城市级
  // Res 8: ~460m 边长 - 片区级
  // Res 9: ~174m 边长 - 社区级  
  // Res 10: ~66m 边长 - 街区级
  h3ResolutionTable: {
    city: 7,      // > 5km
    district: 8,  // 2-5km
    community: 9, // 500m-2km
    block: 10     // < 500m
  },
  
  // 代表性地标评分权重 (用于计算 POI 的地标价值)
  landmarkWeights: {
    // 高代表性类型 (用户会用来定位的地标)
    high: ['地铁站', '火车站', '机场', '大学', '三甲医院', '大型商场', '知名景点', '政府机关', '体育馆', '博物馆', '图书馆', '标志性建筑','知名商业街','知名地标'],
    // 中等代表性
    medium: ['中学', '小学', '医院', '超市', '购物中心', '公园', '广场', '银行总行', '酒店', '影院'],
    // 低代表性 (通常不作为地标)
    low: ['便利店', '餐厅', '咖啡厅', '药店', '银行网点', '停车场'],
    // 排除类型 (永远不应作为代表性地标)
    exclude: ['公共厕所', '厕所', '卫生间', '垃圾站', '配电房', '泵站', '宿舍', '教职工宿舍', '学生寝室', '学生公寓', '员工宿舍', '职工宿舍', '体育场', '操场', '篮球场', '羽毛球场', '网球场', '足球场', '跑道', '仓库', '杂物间', '设备间', '机房']
  }
}

/**
 * Phase 1 优化：动态选择 H3 分辨率
 * 
 * 根据查询范围大小自动选择合适的 H3 分辨率，
 * 使得聚合粒度与分析需求匹配。
 * 
 * @param {Object} queryPlan - QueryPlan 对象
 * @param {Object} spatialContext - 空间上下文（可选）
 * @returns {number} H3 分辨率 (7-10)
 */
function selectH3Resolution(queryPlan, spatialContext = null) {
  // 1. 优先使用 QueryPlan 中指定的分辨率
  if (queryPlan.aggregation_strategy?.resolution) {
    return queryPlan.aggregation_strategy.resolution
  }
  
  // 2. 根据查询半径动态选择
  const radius = queryPlan.radius_m || EXECUTOR_CONFIG.defaultRadius
  
  if (radius > 5000) {
    // 城市级：> 5km
    console.log(`[Executor] 动态 H3 分辨率: 7 (城市级，半径 ${radius}m)`)
    return 7
  } else if (radius > 2000) {
    // 片区级：2-5km
    console.log(`[Executor] 动态 H3 分辨率: 8 (片区级，半径 ${radius}m)`)
    return 8
  } else if (radius > 500) {
    // 社区级：500m-2km
    console.log(`[Executor] 动态 H3 分辨率: 9 (社区级，半径 ${radius}m)`)
    return 9
  } else {
    // 街区级：< 500m
    console.log(`[Executor] 动态 H3 分辨率: 10 (街区级，半径 ${radius}m)`)
    return 10
  }
}

/**
 * 根据 H3 分辨率计算合理的最大网格数
 * 
 * @param {number} resolution - H3 分辨率
 * @returns {number} 建议的最大网格数
 */
function getMaxBinsForResolution(resolution) {
  // 低分辨率（大网格）需要更少的 bins
  // 高分辨率（小网格）可以有更多的 bins
  switch (resolution) {
    case 7: return 30   // 城市级：粗略聚合
    case 8: return 50   // 片区级
    case 9: return 60   // 社区级：默认
    case 10: return 80  // 街区级：精细聚合
    default: return 50
  }
}

/**
 * 阶段 2 主入口：执行查询
 * 
 * @param {Object} queryPlan - Planner 输出的查询计划
 * @param {Array} frontendPOIs - 前端传来的 POI 数据（用于区域分析模式）
 * @param {Object} options - 额外选项，包括 regions 上下文
 * @returns {Promise<Object>} ExecutorResult
 */
export async function executeQuery(queryPlan, frontendPOIs = [], options = {}) {
  const startTime = Date.now()
  
  console.log(`[Executor] 开始执行: ${queryPlan.query_type}`)
  
  // Phase 2 优化：查询缓存
  // 生成查询指纹并检查缓存
  const spatialContext = options.spatialContext || options.context || {}
  const cacheFingerprint = queryCache.generateQueryFingerprint(queryPlan, spatialContext)
  
  // 检查是否应该使用缓存（某些场景不适合缓存）
  const shouldUseCache = !options.skipCache && 
                         !options.forceRefresh && 
                         queryPlan.query_type !== 'clarification_needed'
  
  if (shouldUseCache) {
    const cachedResult = queryCache.getFromCache(cacheFingerprint)
    if (cachedResult) {
      console.log(`[Executor] 🚀 缓存命中! 跳过查询执行`)
      return {
        success: true,
        results: {
          ...cachedResult,
          stats: {
            ...cachedResult.stats,
            cache_hit: true,
            original_execution_time_ms: cachedResult.stats?.execution_time_ms,
            execution_time_ms: Date.now() - startTime
          }
        }
      }
    }
  }
  
  try {
    let result
    
    // 根据 QueryPlan 决定执行路径
    if (queryPlan.query_type === 'region_comparison') {
      // 多选区对比模式
      result = await execRegionComparison(queryPlan, options)
    } else if (queryPlan.need_graph_reasoning) {
      result = await execGraphMode(queryPlan, frontendPOIs, options)
    } else if (queryPlan.aggregation_strategy?.enable || queryPlan.need_global_context) {
      // 启用三通道中的“统计通道”或“混合通道”
      result = await execAggregatedAnalysisMode(queryPlan, frontendPOIs, options)
    } else {
      result = await execBasicMode(queryPlan, frontendPOIs, options)
    }
    
    // 添加执行统计
    result.stats.execution_time_ms = Date.now() - startTime
    result.stats.cache_hit = false
    
    // Phase 3 优化：POI 智能过滤（条件性黑名单）
    if (result.pois?.length > 0) {
      const userQuestion = options.userQuestion || ''
      const plannerCategories = queryPlan.categories || []
      
      const filterResult = poiFilter.filterPOIs(result.pois, {
        userQuestion,
        plannerCategories,
        strict: queryPlan.query_type !== 'area_analysis' // 区域分析不过滤
      })
      
      result.pois = filterResult.filtered
      result.stats.filtered_noise_count = filterResult.removed
      result.stats.exempted_categories = filterResult.exempted
    }
    
    // Phase 3 优化：空结果拓展搜索
    // 当结果为空且是 POI 搜索类型时，尝试拓展搜索
    if ((!result.pois || result.pois.length === 0) && 
        queryPlan.query_type === 'poi_search' &&
        !options.skipExpansion) {
      
      console.log('[Executor] 结果为空，尝试拓展搜索...')
      
      // 生成拓展策略
      const expansionPlan = expansionSearch.generateExpansionStrategies(queryPlan, spatialContext)
      
      if (expansionPlan.hasStrategies) {
        let expansionSuccess = false
        const attemptedStrategies = []
        
        // 依次尝试拓展策略（最多2个）
        for (let i = 0; i < Math.min(expansionPlan.strategies.length, 2); i++) {
          const strategy = expansionPlan.strategies[i]
          console.log(`[Executor] 拓展策略 ${i + 1}: ${strategy.description}`)
          attemptedStrategies.push(strategy)
          
          try {
            // 用修改后的计划重新执行
            const expandedResult = await execBasicMode(strategy.modifiedPlan, frontendPOIs, {
              ...options,
              skipExpansion: true // 防止递归
            })
            
            if (expandedResult.pois && expandedResult.pois.length > 0) {
              // 拓展成功
              result = expandedResult
              result.stats.expansion_applied = strategy.type
              result.stats.expansion_description = strategy.description
              result.stats.original_radius = queryPlan.radius_m
              result.stats.original_categories = queryPlan.categories
              expansionSuccess = true
              
              console.log(`[Executor] 拓展成功: ${strategy.type}, 找到 ${expandedResult.pois.length} 个结果`)
              break
            }
          } catch (err) {
            console.warn(`[Executor] 拓展策略执行失败:`, err.message)
          }
        }
        
        // 即使拓展失败，也记录尝试过的策略（供反问使用）
        if (!expansionSuccess) {
          result.stats.expansion_attempted = true
          result.stats.expansion_strategies_tried = attemptedStrategies.map(s => s.type)
          
          // 生成反问建议
          const suggestionMessage = expansionSearch.generateSuggestionMessage({
            originalRadius: queryPlan.radius_m,
            originalCategories: queryPlan.categories,
            attemptedStrategies,
            successfulStrategy: null,
            finalPoiCount: 0
          })
          
          result.expansion_suggestion = suggestionMessage
          console.log('[Executor] 所有拓展策略均未找到结果，将生成反问')
        }
      }
    }
    
    // Phase 2 优化：写入缓存（在过滤后）
    if (shouldUseCache && result.pois?.length > 0) {
      queryCache.setToCache(cacheFingerprint, result, queryPlan.query_type)
    }
    
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
  
  // 调试：输出前端传递的空间上下文
  console.log('[Executor] 📍 spatialContext 收到:', JSON.stringify({
    hasContext: !!spatialContext,
    mode: spatialContext?.mode,
    hasBoundary: !!(spatialContext?.boundary?.length),
    hasCenter: !!spatialContext?.center,
    hasViewport: !!(spatialContext?.viewport?.length),
    viewport: spatialContext?.viewport
  }))
  
  if (spatialContext) {
    // 修复：更健壮的边界检测
    if (spatialContext.boundary && spatialContext.boundary.length >= 3 && 
        (spatialContext.mode === 'Polygon' || spatialContext.mode === 'polygon' || !spatialContext.mode)) {
      hardBoundaryWKT = pointsToWKT(spatialContext.boundary)
      console.log('[Executor] 使用多边形边界 (Polygon WKT)')
    } else if (spatialContext.center && 
               (spatialContext.mode === 'Circle' || spatialContext.mode === 'circle')) {
      // 如果是圆选区，后端构建一个搜索圆
      hardBoundaryWKT = circleToWKT(spatialContext.center, plan.radius_m || 500)
      console.log('[Executor] 使用圆形边界 (Circle WKT)')
    } else if (spatialContext.viewport && Array.isArray(spatialContext.viewport) && spatialContext.viewport.length >= 4) {
      // 如果没画选区，但有视野范围，将视野作为硬边界
      hardBoundaryWKT = bboxToWKT(spatialContext.viewport)
      console.log('[Executor] 使用视野边界 (Viewport WKT):', spatialContext.viewport)
    } else {
      console.log('[Executor] ⚠️ spatialContext 存在但无法构建 WKT 边界')
    }
    
    // Store WKT in result for downstream use (e.g. global context)
    if (hardBoundaryWKT) {
      result.hardBoundaryWKT = hardBoundaryWKT;
    }

    if (hardBoundaryWKT) {
      // 计算空间指纹 (H3)
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

        // Strict numeric validation before H3 encoding
        if (typeof centerLon === 'number' && typeof centerLat === 'number' &&
            !isNaN(centerLon) && !isNaN(centerLat) &&
            centerLat >= -90 && centerLat <= 90 &&
            centerLon >= -180 && centerLon <= 180) {
            
          const fingerprint = h3.latLngToCell(centerLat, centerLon, EXECUTOR_CONFIG.h3Resolution)
          console.log(`[Executor] 空间指纹 (H3): ${fingerprint}, 范围: ${spatialContext.mode || 'Viewport'}`)
        } else {
             console.warn(`[Executor] 无法计算 H3: 坐标无效 (Lat: ${centerLat}, Lon: ${centerLon})`);
        }
      } catch (e) {
        console.warn('[Executor] H3 计算失败:', e.message)
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
  
  // 关键逻辑调整: 如果用户没有指定类别 (plan.categories为空)，且有明确的空间范围 (hardBoundaryWKT 或 effectiveAnchor)，
  // 则视为"全类目检索"。此时不认为是 mismatch (错配)，而是自然的"范围分析"需求。
  const isCategoryMismatch = (() => {
    // 情况 A: 用户指定了类别，检查前端数据里有没有
    if (plan.categories && plan.categories.length > 0) {
      return !plan.categories.some(cat => currentLocalCategories.some(lc => 
        String(lc).toLowerCase().includes(String(cat).toLowerCase()) || 
        String(cat).toLowerCase().includes(String(lc).toLowerCase())
      ))
    }
    // 情况 B: 用户没指定类别 (all categories)
    // 此时如果我们只有少量前端数据，或者前端从未加载过数据，或者我们想做全域分析，应该强制查库
    // 简单起见，如果 plan.categories 为空，且要求 aggregation 或 global_context，通常意味着需要全库数据
    // 除非前端已经加载了大量数据
    if (safeFrontendPOIs.length < 50 && (hardBoundaryWKT || effectiveAnchor)) {
      return true // 没数据且没选类别，强制查库
    }
    return false
  })()
  
  if (isCategoryMismatch) {
    if (plan.categories && plan.categories.length > 0) {
       console.log(`[Executor] 检测到类型错配: 内存数据为 [${currentLocalCategories.slice(0,3)}...]，而用户正在搜 [${plan.categories}]。强制开启全库检索模式。`)
    } else {
       console.log(`[Executor] 检测到全域分析需求 (无特定类别): 内存数据不足，强制开启全库检索模式。`)
    }
  }
  
  // 1. 先计算视野中心（用于锚点解析时的距离偏好）
  let viewCenter = null
  if (spatialContext?.viewport && spatialContext.viewport.length >= 4) {
    viewCenter = {
      lon: (spatialContext.viewport[0] + spatialContext.viewport[2]) / 2,
      lat: (spatialContext.viewport[1] + spatialContext.viewport[3]) / 2
    }
  } else if (spatialContext?.center) {
    viewCenter = spatialContext.center
  }
  
  // 2. 解析锚点（增强：支持 unknown 类型，并传入视野中心用于距离偏好）
  let anchorCoords = null
  const anchorName = plan.anchor?.name
  
  // 情况1: 明确的地标类型
  if (plan.anchor?.type === 'landmark' && anchorName) {
    const fullName = plan.anchor.gate 
      ? `${anchorName}${plan.anchor.gate}` 
      : anchorName
    
    // 传入视野中心，优先匹配靠近视野的同名 POI
    anchorCoords = await resolveAnchor(fullName, null, viewCenter)
    if (anchorCoords) {
      result.anchor = {
        name: fullName,
        lon: anchorCoords.lon,
        lat: anchorCoords.lat,
        resolved_from: anchorCoords.source || 'geocoder'
      }
    }
  } 
  // 情况2: unknown 类型但有名称（如"湖北大学"），尝试解析
  else if (plan.anchor?.type === 'unknown' && anchorName) {
    console.log(`[Executor] 尝试解析 unknown 类型锚点: "${anchorName}"`)
    anchorCoords = await resolveAnchor(anchorName, null, viewCenter)
    if (anchorCoords) {
      console.log(`[Executor] ✅ 成功解析锚点 "${anchorName}" → ${anchorCoords.lon.toFixed(4)}, ${anchorCoords.lat.toFixed(4)}`)
      result.anchor = {
        name: anchorName,
        lon: anchorCoords.lon,
        lat: anchorCoords.lat,
        resolved_from: anchorCoords.source || 'geocoder'
      }
    } else {
      console.log(`[Executor] ⚠️ 无法解析锚点 "${anchorName}"，将使用视野中心`)
    }
  }
  
  // 1.5 提取空间指纹 (Spatial Fingerprint) - viewCenter 已在上方计算
  let geoSignature = null
  // (viewCenter 已在锚点解析前计算，此处复用)

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
    try {
      // Validate coordinates before encoding
      if (typeof viewCenter.lat === 'number' && typeof viewCenter.lon === 'number' &&
          !isNaN(viewCenter.lat) && !isNaN(viewCenter.lon) &&
          viewCenter.lat >= -90 && viewCenter.lat <= 90 &&
          viewCenter.lon >= -180 && viewCenter.lon <= 180) {
          
        geoSignature = h3.latLngToCell(viewCenter.lat, viewCenter.lon, EXECUTOR_CONFIG.h3Resolution)
        
        try {
          const neighbors = h3.gridDisk(geoSignature, 1)
          // Exclude the center itself if desired, or keep it. H3 kRing includes the center.
          console.log(`[Executor] 空间签名 (H3): ${geoSignature}, 邻居数: ${neighbors.length}`)
        } catch (e) {
          console.log(`[Executor] 空间签名 (H3): ${geoSignature}`)
        }
      } else {
        console.warn(`[Executor] 无法生成空间签名: 坐标无效 (Lat: ${viewCenter.lat}, Lon: ${viewCenter.lon})`)
      }
    } catch (err) {
      console.warn('[Executor] H3 签名生成失败:', err.message)
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
    geo_signature: geoSignature,
    spatial_index_type: 'h3',
    search_all_categories: (!plan.categories || plan.categories.length === 0) // 标记是否全类目
  }

  console.log(`[Executor] 决策流: Mismatch=${isCategoryMismatch}, HardBound=${!!hardBoundaryWKT}, EffectiveAnchor=${!!effectiveAnchor}, AllCats=${result.stats.spatial_trace.search_all_categories}`)

  if (hardBoundaryWKT || isCategoryMismatch || effectiveAnchor) {
    // 强制进入数据库检索流程 (全域感知生效)
    console.log('[Executor] >>> 触发全库检索逻辑 (全域感知生效)')
    
    // =============================================
    // 两阶段过滤路径：视野 + 地标 + 类别 同时存在
    // =============================================
    const hasTwoStageConditions = hardBoundaryWKT && anchorCoords && plan.categories?.length > 0
    
    if (hasTwoStageConditions) {
      // 检测锚点是否在视野范围内
      const viewport = spatialContext?.viewport
      let anchorInViewport = true
      
      if (viewport && viewport.length >= 4) {
        const [minLon, minLat, maxLon, maxLat] = viewport
        anchorInViewport = (
          anchorCoords.lon >= minLon && anchorCoords.lon <= maxLon &&
          anchorCoords.lat >= minLat && anchorCoords.lat <= maxLat
        )
      }
      
      if (anchorInViewport) {
        // 锚点在视野内：使用两阶段过滤（视野 + 锚点缓冲区）
        console.log(`[Executor] 🎯 启用两阶段过滤: 视野初筛 + 地标缓冲区(${radius}m)精筛`)
        
        let usedHybrid = false
        // 尝试混合检索 (Spatial + Vector)
        if (vectordb.isVectorDBAvailable() && plan.semantic_query) {
           console.log(`[Executor] 🚀 尝试混合检索 (Spatial+Vector) 已启用...`)
           const embedding = await generateEmbedding(plan.semantic_query)
           if (embedding) {
             candidates = await vectordb.spatialVectorSearch({
                queryEmbedding: embedding,
                anchor: anchorCoords,
                radius: radius,
                viewportWKT: hardBoundaryWKT,
                categories: plan.categories || [],  // 传递类别过滤
                topK: EXECUTOR_CONFIG.maxCandidates
             })
             if (candidates.length > 0) {
                usedHybrid = true
                result.stats.semantic_rerank_applied = true
                console.log(`[Executor] 混合检索成功: ${candidates.length} 条结果`)
             }
           }
        }
        
        // 如果混合检索未启用或无结果，降级到关键词匹配
        if (!usedHybrid) {
            const twoStageResult = await db.findPOIsTwoStageFilter({
              terms: plan.categories,
              viewportWKT: hardBoundaryWKT,
              anchor: anchorCoords,
              bufferRadius: radius,
              limit: EXECUTOR_CONFIG.maxCandidates
            })
            
            candidates = twoStageResult.pois
            result.stats.two_stage_filter = {
              enabled: true,
              anchor_in_viewport: true,
              stage1_count: twoStageResult.stage1Count,
              stage2_count: twoStageResult.stage2Count
            }
        }
        
        console.log(`[Executor] 两阶段过滤结果: ${candidates.length} 条`)
      } else {
        // 锚点在视野外：跳过视野约束，只用锚点缓冲区搜索
        console.log(`[Executor] ⚠️ 锚点 "${plan.anchor?.name}" 不在视野内，跳过视野约束，仅用锚点缓冲区`)
        console.log(`[Executor] 🎯 单阶段过滤: 地标缓冲区(${radius}m)`)
        
        let usedHybrid = false
        // 尝试混合检索 (Spatial + Vector)
        if (vectordb.isVectorDBAvailable() && plan.semantic_query) {
           console.log(`[Executor] 🚀 尝试混合检索 (Spatial+Vector) 已启用...`)
           const embedding = await generateEmbedding(plan.semantic_query)
           if (embedding) {
             candidates = await vectordb.spatialVectorSearch({
                queryEmbedding: embedding,
                anchor: anchorCoords,
                radius: radius,
                viewportWKT: null, // 不限制视野
                categories: plan.categories || [],  // 传递类别过滤
                topK: EXECUTOR_CONFIG.maxCandidates
             })
             if (candidates.length > 0) {
                usedHybrid = true
                result.stats.semantic_rerank_applied = true
                console.log(`[Executor] 混合检索成功: ${candidates.length} 条结果`)
             }
           }
        }
        
        if (!usedHybrid) {
            const twoStageResult = await db.findPOIsTwoStageFilter({
              terms: plan.categories,
              viewportWKT: null,  // 不限制视野
              anchor: anchorCoords,
              bufferRadius: radius,
              limit: EXECUTOR_CONFIG.maxCandidates
            })
            
            candidates = twoStageResult.pois
            result.stats.two_stage_filter = {
              enabled: true,
              anchor_in_viewport: false,
              stage1_count: twoStageResult.stage1Count,
              stage2_count: twoStageResult.stage2Count
            }
        }
        
        console.log(`[Executor] 锚点缓冲区过滤结果: ${candidates.length} 条`)
      }
    }
    // =============================================
    // 原有路径：单阶段过滤
    // =============================================
    else if (hardBoundaryWKT) {
      console.log(`[Executor] 执行 WKT 几何过滤检索...`)
      candidates = await searchFromDatabase(effectiveAnchor, radius, plan, hardBoundaryWKT)
    } else if (effectiveAnchor) {
      const logLon = typeof effectiveAnchor.lon === 'number' ? effectiveAnchor.lon.toFixed(4) : effectiveAnchor.lon;
      const logLat = typeof effectiveAnchor.lat === 'number' ? effectiveAnchor.lat.toFixed(4) : effectiveAnchor.lat;
      console.log(`[Executor] 执行位置锚点检索: ${logLon}, ${logLat}, 半径: ${radius}m`)
      
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
  
  // =============================================
  // 核心增强：全域画像 (Area Profile) 用于宏观分析
  // =============================================
  // 如果处于"全域感知"模式 (hardBoundaryWKT存在)，且候选集非常少 (可能是因为 limit 限制)，
  // 我们需要发起一次"宽统计查询"，以获取真实的区域统计数据，防止 LLM 幻觉(e.g. "只有2家餐饮")。
  if (hardBoundaryWKT) {
      console.log(`[Executor] 📊 正在生成全域统计画像 (Limit: ${EXECUTOR_CONFIG.maxAnalysisCandidates})...`)
      try {
          // 仅拉取 category 字段进行统计，减少 IO (假设 db 支持 field selection，若不支持则拉去全量也没事，反正是在内网)
          const statsCandidates = await db.findPOIsBySpatialFilter({
              wkt: hardBoundaryWKT,
              terms: null, // 不限制类别，看全貌
              limit: EXECUTOR_CONFIG.maxAnalysisCandidates
          })
          
          if (statsCandidates && statsCandidates.length > 0) {
            const categories = {}
            statsCandidates.forEach(p => {
                const props = p.properties || p
                const cat = props['大类'] || props.category || props.type || '其他'
                categories[cat] = (categories[cat] || 0) + 1
            })
            
            const sortedCats = Object.entries(categories)
                .sort((a, b) => b[1] - a[1])
                .map(([name, count]) => ({
                    category: name,
                    count: count,
                    percentage: Math.round((count / statsCandidates.length) * 100)
                }))

            // 生成画像
            result.area_profile = {
                total_count: statsCandidates.length,
                dominant_categories: sortedCats.slice(0, 10), // Top 10
                rare_categories: sortedCats.filter(c => c.count < 3).slice(0, 5),
                diversity_score: sortedCats.length
            }
            console.log(`[Executor] ✅ 全域画像: 总计 ${statsCandidates.length} 个 POI, 主导业态: ${sortedCats.slice(0,3).map(c=>`${c.category}(${c.count})`).join(', ')}`)
          }
      } catch (err) {
          console.warn(`[Executor] 全域统计失败: ${err.message}`)
      }
  } else if (candidates.length > 0 && !result.area_profile) {
       // 如果没有硬边界，就用 candidates 做一个简单的 profile
       const categories = {}
       candidates.forEach(p => {
           const props = p.properties || p
           const cat = props['大类'] || props.category || '其他'
           categories[cat] = (categories[cat] || 0) + 1
       })
       const sortedCats = Object.entries(categories)
           .sort((a, b) => b[1] - a[1])
           .map(([name, count]) => ({ category: name, count: count, percentage: Math.round((count / candidates.length) * 100) }))
           
       result.area_profile = {
           total_count: candidates.length,
           dominant_categories: sortedCats.slice(0, 8)
       }
  }

  
  // 3. 语义精排（如果有语义偏好且 pgvector 可用）
  let ranked = candidates
  const vectorAvailable = vectordb.isVectorDBAvailable()
  
  console.log(`[Executor] pgvector 状态检查: 可用=${vectorAvailable}, semantic_query="${plan.semantic_query?.slice(0, 30) || '(无)'}", candidates=${candidates.length}`)
  
  if (plan.semantic_query && vectorAvailable && candidates.length > 0) {
    console.log(`[Executor] 🧠 启用语义精排 (pgvector)...`)
    ranked = await semanticRerank(candidates, plan.semantic_query, plan.max_results)
    result.stats.semantic_rerank_applied = true
  } else {
    // 按距离或评分排序
    if (!vectorAvailable) {
      console.log(`[Executor] ⚠️ pgvector 不可用，跳过语义精排`)
    }
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
  
  // =============================================
  // 核心增强：生成动态几何边界 (Convex Hull)
  // 用于前端 Three.js 极光描边
  // =============================================
  try {
    // 优先使用全量 candidates 计算边界，使范围更准
    const boundaryPoints = (candidates.length > 0 ? candidates : safeFrontendPOIs).map(p => ({
        lat: p.lat || (p.geometry?.coordinates ? p.geometry.coordinates[1] : 0),
        lon: p.lon || (p.geometry?.coordinates ? p.geometry.coordinates[0] : 0)
    })).filter(p => p.lat !== 0 && p.lon !== 0)

    if (boundaryPoints.length >= 3) {
        const hull = geometry.calculateConvexHull(boundaryPoints)
        const ring = geometry.hullToGeoJSONRing(hull)
        if (ring.length > 3) {
            result.boundary = {
                type: "Polygon",
                coordinates: [ring]
            }
            console.log(`[Executor] ✅ 动态边界生成成功: ${hull.length} 个顶点`)
        }
    }
  } catch (geoErr) {
    console.warn('[Executor] 边界生成失败:', geoErr.message)
  }
  
  // =============================================
  // Phase 4 增强：空间聚类分析 (KDE + DBSCAN)
  // 识别商业热点和语义模糊区域
  // 优化：大数据集时降采样以提升性能
  // =============================================
  try {
    const allPOIs = candidates.length > 0 ? candidates : safeFrontendPOIs;
    // 大数据集时降采样，限制聚类分析的点数
    const MAX_CLUSTER_POIS = 2000;
    let analysisPOIs = allPOIs;
    if (allPOIs.length > MAX_CLUSTER_POIS) {
      // 均匀采样
      const step = Math.floor(allPOIs.length / MAX_CLUSTER_POIS);
      analysisPOIs = allPOIs.filter((_, i) => i % step === 0).slice(0, MAX_CLUSTER_POIS);
      console.log(`[Executor] 🔥 聚类分析降采样: ${allPOIs.length} -> ${analysisPOIs.length}`);
    }
    
    if (analysisPOIs.length >= 10) {
      console.log(`[Executor] 🔥 启动空间聚类分析，POI数量: ${analysisPOIs.length}`);
      
      // 执行热点识别
      const hotspotResult = clustering.identifyHotspots(analysisPOIs, {
        bandwidth: 200,  // 200米带宽
        resolution: 9,   // H3分辨率9
        clusterEps: 300, // 300米邻域半径
        minPoints: 3     // 最少3个点形成簇
      });
      
      if (hotspotResult.hotspots && hotspotResult.hotspots.length > 0) {
        result.spatial_clusters = {
          hotspots: hotspotResult.hotspots.map(h => ({
            id: h.id,
            center: h.center,
            boundary: h.boundary,
            density: h.density,
            poiCount: h.poiCount,
            confidence: h.confidence,
            dominantCategories: h.dominantCategories
          })),
          stats: hotspotResult.stats,
          densityBreaks: hotspotResult.densityBreaks
        };
        
        console.log(`[Executor] ✅ 热点识别完成: ${hotspotResult.hotspots.length} 个热点区域`);
      }
      
      // 简化语义区域生成：只对主要类别执行
      const categoryGroups = {};
      analysisPOIs.forEach(p => {
        const props = p.properties || p;
        const cat = props['大类'] || props.category || '其他';
        if (!categoryGroups[cat]) categoryGroups[cat] = [];
        categoryGroups[cat].push(p);
      });
      
      // 限制处理的类别数量
      const topCategories = Object.entries(categoryGroups)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5); // 只处理前5个主要类别
      
      const vernacularRegions = [];
      for (const [cat, pois] of topCategories) {
        if (pois.length >= 10) { // 提高阈值减少计算
          const regionResult = clustering.generateVernacularRegion(pois, cat, {
            eps: 250,
            minPoints: 5, // 提高阈值
            bandwidth: 150
          });
          
          if (regionResult && regionResult.regions.length > 0) {
            vernacularRegions.push({
              category: cat,
              regions: regionResult.regions.map(r => ({
                id: r.id,
                center: r.center,
                boundary: r.boundary,
                confidence: r.confidence,
                poiCount: r.density
              }))
            });
          }
        }
      }
      
      if (vernacularRegions.length > 0) {
        result.vernacular_regions = vernacularRegions;
        console.log(`[Executor] ✅ 语义区域生成完成: ${vernacularRegions.length} 个类别`);
      }
      
      // Phase 5: 生成模糊区域（三层边界模型）
      console.log(`[Executor] 🔥 启动模糊区域生成...`);
      const fuzzyRegions = fuzzyRegion.identifyFuzzyRegions(analysisPOIs, {
        eps: 200,
        minPoints: 5
      });
      
      if (fuzzyRegions && fuzzyRegions.length > 0) {
        result.fuzzy_regions = fuzzyRegions.map(r => ({
          id: r.id,
          name: r.name || `${r.theme}区域`,
          theme: r.theme,
          center: r.center,
          layers: r.layers,
          pointCount: r.pointCount,
          dominantCategories: r.dominantCategories
        }));
        console.log(`[Executor] ✅ 模糊区域生成完成: ${fuzzyRegions.length} 个区域`);
      }
    }
  } catch (clusterErr) {
    console.warn('[Executor] 空间聚类分析失败:', clusterErr.message);
  }
  
  return result
}

/**
 * 聚合分析模式 (三通道核心实现)
 * 对应 Planner 的 "Statistical Channel" & "Hybrid Channel"
 * 
 * 核心逻辑：
 * 1. 扩大搜索范围，获取最多 10000 个 POI
 * 2. 在内存中做 H3 聚合、密度计算、异常检测
 * 3. 按照 Sampling Strategy 选出 20-50 个代表点
 * 4. 返回：Global Stats + H3 Grid List + Representative POIs
 */
async function execAggregatedAnalysisMode(plan, frontendPOIs, options = {}) {
  const result = {
    mode: 'aggregated_analysis',
    anchor: null,
    pois: [], // 仅放代表点
    spatial_analysis: null, // H3 聚合数据
    area_profile: null,     // 全局统计
    landmarks: [],
    stats: {
      total_candidates: 0,
      filtered_count: 0,
      execution_time_ms: 0
    }
  }

  // 1. 获取全量候选集 (Candidates)
  // 注意：这里使用更大的 maxAnalysisCandidates
  let candidates = []
  
  // 构建空间上下文（兼容 options.context 和 options.spatialContext）
  const spatialContext = options.spatialContext || options.context || {}
  let hardBoundaryWKT = null
  let searchCenter = null
  
  if (spatialContext.boundary && spatialContext.mode === 'Polygon') {
    hardBoundaryWKT = pointsToWKT(spatialContext.boundary)
    searchCenter = getPolygonCenter(spatialContext.boundary)
  } else if (spatialContext.center) {
    searchCenter = spatialContext.center
  } else if (spatialContext.viewportCenter) { // 兼容 context.viewportCenter
    searchCenter = spatialContext.viewportCenter
  } else if (spatialContext.viewport) {
    searchCenter = { 
      lon: (spatialContext.viewport[0] + spatialContext.viewport[2]) / 2, 
      lat: (spatialContext.viewport[1] + spatialContext.viewport[3]) / 2 
    }
  }

  // 确定锚点
  if (plan.anchor?.type === 'landmark' && plan.anchor?.name) {
    const coords = await resolveAnchor(plan.anchor.name)
    if (coords) searchCenter = coords
  }
  
  if (searchCenter) {
    result.anchor = {
      name: plan.anchor?.name || '区域中心',
      lon: searchCenter.lon,
      lat: searchCenter.lat
    }
  }

  // 执行宽范围搜索
  console.log('[Executor] 开始聚合分析搜索，目标全量数据...')
  const searchPlan = { 
    ...plan, 
    // 强制放宽条数限制，以便获取足够样本进行统计
    limit: EXECUTOR_CONFIG.maxAnalysisCandidates 
  }
  
  // 关键优化：判断是否为专题分析（指定了特定 categories）
  const isTopicAnalysis = plan.categories && plan.categories.length > 0
  
  if (isTopicAnalysis) {
    // 专题分析：优先从数据库检索特定类别的 POI
    // 即使有前端数据，也要从数据库获取，因为前端可能没有加载这些类别
    console.log(`[Executor] 专题分析模式，检索类别: ${plan.categories.join(', ')}`)
    
    if (hardBoundaryWKT) {
      candidates = await searchFromDatabase(searchCenter, plan.radius_m || 5000, searchPlan, hardBoundaryWKT)
    } else if (searchCenter) {
      let effectiveRadius = plan.radius_m || 5000
      
      // 关键优化：如果用户看的是"当前区域"（未指定具体地名锚点），
      // 且有 Viewport 信息，则限制半径不超过 Viewport 的范围，防止搜到屏幕外很远的点
      if ((!plan.anchor || plan.anchor.type === 'unknown') && spatialContext.viewport) {
         // viewport: [minLon, minLat, maxLon, maxLat]
         // 计算对角线长度的一半作为参考半径
         const dist = calculateDistance(spatialContext.viewport[1], spatialContext.viewport[0], spatialContext.viewport[3], spatialContext.viewport[2])
         const viewportRadius = dist / 2
         
         if (viewportRadius < effectiveRadius) {
             effectiveRadius = viewportRadius
             console.log(`[Executor] 动态收缩搜索半径至 Viewport 范围: ${Math.round(effectiveRadius)}m`)
         }
      }
      
      candidates = await searchFromDatabase(searchCenter, effectiveRadius, searchPlan)
    } else if (options.hardBoundary?.length > 0) {
      // 使用手绘边界的质心作为搜索中心
      const polygonCenter = getPolygonCenter(options.hardBoundary[0])
      candidates = await searchFromDatabase(polygonCenter, plan.radius_m || 5000, searchPlan)
    } else if (frontendPOIs.length > 0) {
      // 从前端数据的质心位置搜索数据库
      const coords = frontendPOIs
        .map(p => [p.geometry?.coordinates?.[0], p.geometry?.coordinates?.[1]])
        .filter(c => c[0] && c[1])
      
      if (coords.length > 0) {
        const centerLon = coords.reduce((s, c) => s + c[0], 0) / coords.length
        const centerLat = coords.reduce((s, c) => s + c[1], 0) / coords.length
        candidates = await searchFromDatabase({ lon: centerLon, lat: centerLat }, plan.radius_m || 5000, searchPlan)
      } else {
        // 兜底：尝试从前端数据过滤
        candidates = filterFromFrontendPOIs(frontendPOIs, plan)
      }
    }
    
    // 如果数据库没有结果，尝试从前端数据过滤
    if (candidates.length === 0 && frontendPOIs.length > 0) {
      console.log('[Executor] 数据库无结果，降级从前端数据过滤')
      candidates = filterFromFrontendPOIs(frontendPOIs, plan)
    }
  } else {
    // 全域分析：使用原来的逻辑
    if (hardBoundaryWKT) {
      candidates = await searchFromDatabase(searchCenter, plan.radius_m, searchPlan, hardBoundaryWKT)
    } else if (searchCenter) {
      candidates = await searchFromDatabase(searchCenter, plan.radius_m || 2000, searchPlan)
    } else if (frontendPOIs.length > 0) {
      candidates = filterFromFrontendPOIs(frontendPOIs, plan)
    }
  }

  result.stats.total_candidates = candidates.length
  console.log(`[Executor] 聚合分析获取候选集: ${candidates.length} 条`)

  // 2. 执行 H3 空间聚合 (Phase 1 优化：动态分辨率)
  const h3Resolution = selectH3Resolution(plan)
  const maxBins = getMaxBinsForResolution(h3Resolution)
  const aggregationResult = performH3Aggregation(candidates, h3Resolution)
  
  // 3. 执行代表点采样
  let representativePOIs = []
  if (plan.sampling_strategy?.enable) {
    representativePOIs = selectRepresentativePOIs(candidates, aggregationResult, plan.sampling_strategy)
    
    // 关键增强：如果存在 semantic_query，使用 pgvector 找出语义最相关的 POI，并补充到 representativePOIs 中
    // 这能解决规则筛选无法覆盖"抽象意图"（如"好玩的"、"适合约会的"）的问题
    if (plan.semantic_query && vectordb.isVectorDBAvailable() && candidates.length > 0) {
        console.log(`[Executor] 聚合模式触发语义增强检索: "${plan.semantic_query}"`)
        const semanticTopK = await semanticRerank(candidates, plan.semantic_query, 10)
        
        if (semanticTopK.length > 0) {
            // 将语义相关的点合并，优先展示
            const existingIds = new Set(representativePOIs.map(p => p.id || p.poiid || p.name))
            let addedCount = 0
            
            // 关键：语义检索回来的点也要经过黑名单过滤！
            const filteredSemantic = semanticTopK.filter(poi => {
                const name = poi.name || poi.properties?.['名称'] || ''
                const cat = poi.type || poi.properties?.['大类'] || poi.properties?.['小类'] || ''
                // 复用黑名单检查逻辑 (如果 score === 0 说明命中了黑名单)
                return calculateLandmarkScore(name, cat) > 0
            })
            
            // 逆序插入到头部
            for (let i = filteredSemantic.length - 1; i >= 0; i--) {
                const poi = filteredSemantic[i]
                const id = poi.id || poi.poiid || poi.name
                if (!existingIds.has(id)) {
                    representativePOIs.unshift(poi) 
                    existingIds.add(id)
                    addedCount++
                }
            }
            console.log(`[Executor] 语义增强：补充了 ${addedCount} 个相关点 (已过滤黑名单)`)
            
            // 重新截断，但稍微放宽数量限制以容纳语义点
            const maxCount = (plan.sampling_strategy.count || 20)
            if (representativePOIs.length > maxCount) {
                representativePOIs = representativePOIs.slice(0, maxCount)
            }
        }
    }
  } else {
    // 如果没开启采样，默认选 Top N
    representativePOIs = candidates.slice(0, 20)
  }

  // 4. 计算全局统计
  const globalProfile = computeAreaProfile(candidates) // 复用现有的 profile 计算

  // 5. 组装结果
  result.spatial_analysis = {
    resolution: h3Resolution,
    total_grids: aggregationResult.grids.length,
    grids: aggregationResult.grids.slice(0, maxBins), // Phase 1: 使用动态计算的 maxBins
    search_radius: plan.radius_m,
    coverage_ratio: candidates.length > 0 ? 1.0 : 0 // 简化
  }
  
  result.area_profile = globalProfile
  result.pois = compressPOIs(representativePOIs, result.anchor?.name) // 这里的 POIs 是代表点
  
  // Phase 3 优化：自动生成区域边界 (凸包)
  try {
    if (candidates.length >= 3) {
      const points = candidates.map(p => {
         // 兼容 GeoJSON 和 扁平结构
         const lon = p.lon || p.geometry?.coordinates?.[0]
         const lat = p.lat || p.geometry?.coordinates?.[1]
         if (typeof lon === 'number' && typeof lat === 'number') {
           return { lon, lat }
         }
         return null
      }).filter(Boolean)
      
      // 降采样：如果点太多，只取前 500 个分布均匀的点来算凸包，提升性能
      const samplePoints = points.length > 500 ? points.slice(0, 500) : points;
      
      const hull = geometry.calculateConvexHull(samplePoints)
      const ring = geometry.hullToGeoJSONRing(hull)
      
      if (ring.length > 0) {
        result.boundary = {
          type: 'Polygon',
          coordinates: [ring]
        }
        console.log(`[Executor] 自动生成区域边界: ${ring.length} 个顶点`)
      }
    }
  } catch (err) {
    console.warn('[Executor] 边界生成失败:', err.message)
  }
  
  // =============================================
  // Phase 4 增强：聚合模式下的空间聚类分析
  // 优化：降采样以提升性能
  // =============================================
  try {
    // 聚合模式下限制分析点数
    const MAX_AGG_CLUSTER_POIS = 2000;
    let aggAnalysisPOIs = candidates;
    if (candidates.length > MAX_AGG_CLUSTER_POIS) {
      const step = Math.floor(candidates.length / MAX_AGG_CLUSTER_POIS);
      aggAnalysisPOIs = candidates.filter((_, i) => i % step === 0).slice(0, MAX_AGG_CLUSTER_POIS);
      console.log(`[Executor] 🔥 聚合模式降采样: ${candidates.length} -> ${aggAnalysisPOIs.length}`);
    }
    
    if (aggAnalysisPOIs.length >= 10) {
      console.log(`[Executor] 🔥 聚合模式启动空间聚类分析，POI数量: ${aggAnalysisPOIs.length}`);
      
      // 执行热点识别
      const hotspotResult = clustering.identifyHotspots(aggAnalysisPOIs, {
        bandwidth: 200,
        resolution: 9,
        clusterEps: 300,
        minPoints: 3
      });
      
      if (hotspotResult.hotspots && hotspotResult.hotspots.length > 0) {
        result.spatial_clusters = {
          hotspots: hotspotResult.hotspots.map(h => ({
            id: h.id,
            center: h.center,
            boundary: h.boundary,
            density: h.density,
            poiCount: h.poiCount,
            confidence: h.confidence,
            dominantCategories: h.dominantCategories
          })),
          stats: hotspotResult.stats,
          densityBreaks: hotspotResult.densityBreaks
        };
        
        console.log(`[Executor] ✅ 聚合模式热点识别: ${hotspotResult.hotspots.length} 个热点`);
      }
      
      // 简化语义区域生成
      const categoryGroups = {};
      aggAnalysisPOIs.forEach(p => {
        const props = p.properties || p;
        const cat = props['大类'] || props.category || '其他';
        if (!categoryGroups[cat]) categoryGroups[cat] = [];
        categoryGroups[cat].push(p);
      });
      
      const topCategories = Object.entries(categoryGroups)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5);
      
      const vernacularRegions = [];
      for (const [cat, pois] of topCategories) {
        if (pois.length >= 10) {
          const regionResult = clustering.generateVernacularRegion(pois, cat, {
            eps: 250,
            minPoints: 5,
            bandwidth: 150
          });
          
          if (regionResult && regionResult.regions.length > 0) {
            vernacularRegions.push({
              category: cat,
              regions: regionResult.regions.map(r => ({
                id: r.id,
                center: r.center,
                boundary: r.boundary,
                confidence: r.confidence,
                poiCount: r.density
              }))
            });
          }
        }
      }
      
      if (vernacularRegions.length > 0) {
        result.vernacular_regions = vernacularRegions;
        console.log(`[Executor] ✅ 聚合模式语义区域: ${vernacularRegions.length} 个类别`);
      }
    }
  } catch (clusterErr) {
    console.warn('[Executor] 聚合模式空间聚类分析失败:', clusterErr.message);
  }
  
  // 提取地标
  if (plan.need_landmarks && searchCenter) {
    result.landmarks = await extractLandmarks(candidates, searchCenter, plan.radius_m || 2000)
  }

  // Phase 5 增强：Narrative Mode 专属模糊区域 (Three-Layer Model)
  if ((plan.need_narrative || plan.need_global_context || options.quickMode) && candidates.length >= 10) {
    try {
      console.log(`[Executor] 🌌 生成 Narrative Mode 模糊区域 (Fuzzy Regions), 全量参与: count=${candidates.length}`);
      
      const fuzzyRegions = fuzzyRegion.identifyFuzzyRegions(candidates, {
        eps: 250, // 聚类半径
        minPoints: 5
      });
      
      if (fuzzyRegions && fuzzyRegions.length > 0) {
        result.fuzzy_regions = fuzzyRegions;
        console.log(`[Executor] ✅ 生成了 ${fuzzyRegions.length} 个三层模糊区域 (基于全量数据)`);
      }
    } catch (err) {
      console.warn('[Executor] 模糊区域生成失败:', err.message);
    }
  }

  return result
}

/**
 * H3 聚合核心算法
 * @param {Array} pois 
 * @param {Number} res 
 */
function performH3Aggregation(pois, res) {
  const gridMap = new Map()

  pois.forEach(poi => {
    const lat = poi.lat || (poi.geometry?.coordinates ? poi.geometry.coordinates[1] : null)
    const lon = poi.lon || (poi.geometry?.coordinates ? poi.geometry.coordinates[0] : null)
  
    if (lat && lon) {
      try {
        const h3Idx = h3.latLngToCell(lat, lon, res)
        if (!gridMap.has(h3Idx)) {
          gridMap.set(h3Idx, {
            id: h3Idx,
            count: 0,
            categories: {},
            top_poi_name: null,
            max_rating: -1,
            sample_poi: null,
            lat: 0, lon: 0 // Accumulator for centroid
          })
        }
        
        const cell = gridMap.get(h3Idx)
        cell.count++
        
        // 类别统计 - 优先使用大类，避免出现"其他"
        const props = poi.properties || poi
        const cat = props['大类'] || props.category_big || props['中类'] || props['小类'] || props.type || '未分类'
        cell.categories[cat] = (cell.categories[cat] || 0) + 1
        
        // 记录一个代表名 (简单的逻辑：第一个遇到的)
        if (!cell.top_poi_name) cell.top_poi_name = poi.name || poi.properties?.['名称']
        
        // 累加坐标求中心
        cell.lat += lat
        cell.lon += lon
      } catch (e) {
        // ignore
      }
    }
  })

  // 转换为数组并计算属性
  const grids = Array.from(gridMap.values()).map(cell => {
    // 计算中心
    cell.lat /= cell.count
    cell.lon /= cell.count
    
    // 找出主导类别
    let maxCat = '', maxC = 0
    for (const [c, count] of Object.entries(cell.categories)) {
      if (count > maxC) { maxC = count; maxCat = c }
    }
    cell.main_category = maxCat
    
    // 格式化输出 (精简)
    return {
      id: cell.id,
      c: cell.count, // count
      m: cell.main_category, // main category
      p: cell.top_poi_name, // representative poi name
      r: Math.round(maxC / cell.count * 10) / 10 // ratio of main cat
    }
  })

  // 按密度排序
  grids.sort((a, b) => b.c - a.c)
  
  return { grids }
}

/**
 * 代表性 POI 筛选 (新版三维评分方案)
 * 
 * 核心理念：
 * - 高代表性：景点、交通枢纽、核心政府机构 → 优先选入
 * - 常见业态：美食、银行、医院、酒店 → 业态统计，只选1-2个代表
 * - 精细化排除：非大众熟知的行政机构、附属设施
 * 
 * 综合得分: Score = 0.3 * Spatial + 0.4 * Functional + 0.3 * Semantic
 */

// =============== 黑名单配置（硬排除） ===============
// 这些词出现在名称中的 POI 永远不会成为代表点
const REPRESENTATIVE_BLACKLIST = {
  // 附属设施 - 从属于主体的设施
  auxiliary: ['出入口', '入口', '出口', '收费处', '婴儿换洗间', '母婴室', '卫生间', '洗手间', '厕所', '公共厕所', '充电桩', '门卫室', '保安室', '配电房', '泵站', '垃圾站', '仓库', '杂物间', '设备间', '机房', '街电', '充电宝', '共享充电', '回收箱', '旧衣回收', '丰巢', '快递柜', '自提柜', '菜鸟驿站', '自助', '专用', '内部', '警用', '员工', '泊位', '车位', '停车', '充电', '休息', '小屋', '吸烟'],
  
  // 住宿/生活配套 - 不具公共地标价值
  residential: ['宿舍', '教职工宿舍', '学生寝室', '学生公寓', '员工宿舍', '职工宿舍', '家属院', '职工家属区', '垃圾房', '单元', '栋', '室', 'B区', 'A区', 'C区', 'D区', '号楼'],
  
  // 营销/临时设施
  sales: ['营销中心', '展示中心', '接待中心', '售楼部', '售楼处', '样板间', '项目部', '项目处', '指挥部', '办公室', '报名处'],
  
  // 金融/彩票类 - 过于普遍，无区域代表性
  commonFinance: ['ATM', '自助银行', '自助取款', '彩票', '体育彩票', '福利彩票', '投注站', '兑奖中心'],
  
  // 运动场地 - 通常是配套而非地标
  sports: ['操场', '篮球场', '羽毛球场', '网球场', '足球场', '跑道', '田径场', '乒乓球'],
  
  // 临街门/后门 - 不是独立地标
  gates: ['北门', '南门', '东门', '西门', '后门', '侧门', '正门', '临街院门', '大门', '消防通道'],
  
  // 纯道路/地理名称
  pureGeo: ['交叉口', '路口', '十字路口', '丁字路口', '环岛'],
  
  // 非大众熟知的行政机构（关键词组合排除）
  // 注意：这些是"模式"，会在后续用特殊逻辑处理
  obscureAdmin: ['监察总队', '监察队', '办事处', '管理站', '管理处', '服务站', '服务中心', '供销社', '信用社']
}

// 将所有黑名单合并为一个扁平数组
const BLACKLIST_ALL = Object.values(REPRESENTATIVE_BLACKLIST).flat()

// =============== 高代表性 POI 类型 ===============
// 这些类型的 POI 有天然的地标属性，优先选入
const HIGH_REPRESENTATIVE_TYPES = {
  // 景点类 - 优先级最高
  attractions: ['博物馆', '纪念馆', '展览馆', '科技馆', '海洋馆', '水族馆', '植物园', '动物园', '公园', '景区', '风景区', '名胜', '古迹', '遗址', '故居', '寺庙', '塔', '城墙', '古镇', '历史街区','知名商业街','知名地标','知名景点'],
  
  // 交通枢纽
  transport: ['火车站', '高铁站', '机场', '汽车站', '客运站', '地铁站', '轻轨站', '码头', '港口'],
  
  // 核心政府机构 (大众熟知的)
  coreGov: ['人民政府', '市政府', '省政府', '区政府', '县政府', '市委', '省委', '区委', '人大常委会', '政协'],
  
  // 大型公共设施
  publicFacility: ['体育馆', '体育中心', '奥体中心', '图书馆', '文化馆', '艺术馆', '音乐厅', '大剧院', '歌剧院', '会展中心', '国际会议中心','交流中心']
}

// =============== 常见业态（业态统计，只选1-2个代表） ===============
const COMMON_BUSINESS_TYPES = {
  food: ['餐厅', '饭店', '酒楼', '美食', '小吃', '火锅', '烧烤', '快餐', '面馆', '粉店'],
  hotel: ['酒店', '宾馆', '旅馆', '民宿', '客栈', '招待所'],
  bank: ['银行', '信用社', '农商行', '邮政储蓄'],
  hospital: ['医院', '诊所', '卫生院', '门诊部', '社区卫生'],
  parking: ['停车场', '停车库', '车库'],
  company: ['公司', '有限公司', '集团', '总部', '分公司']
}

// =============== 语义加分/减分关键词 ===============
const SEMANTIC_KEYWORDS = {
  // 加分词 - 像一个真正的地标/设施
  positive: ['广场', '购物中心', '商场', '美食城', '步行街', '商业街', '大厦', '中心', '总部', '旗舰店'],
  
  // 减分词 - 容易是附属设施或同质化严重
  negative: ['分店', '分院', '分行', '支行', '网点', '营业厅', '营业部', '代理点', '直营店', '专卖店', '便利店', '超市', '药店', '诊所'],
  
  // 知名连锁品牌 - 有辨识度（可作为业态代表）
  brands: ['星巴克', '肯德基', '麦当劳', '必胜客', '海底捞', '西贝', '喜茶', '奈雪', '瑞幸', '万达', '万科', '华润', '中信', '招商', '保利', '宜家', '苹果', '小米', '华为']
}
/**
 * 主入口：选取代表性 POI (最终版)
 * 
 * 选取逻辑（优先级从高到低）：
/**
 * 筛选代表性 POI (主流程)
 */
function selectRepresentativePOIs(allPois, aggResult, strategy, regionCenter = null) {
  // 根据策略动态决定目标数量，默认为 50 (支持标签云粗略聚合)
  const TARGET_COUNT = Math.min(strategy?.count || 50, 50)
  
  if (!allPois || allPois.length === 0) return []
  if (allPois.length <= TARGET_COUNT) return allPois
  
  const seenIds = new Set()
  const seenNames = new Set()
  const selected = []
  
  console.log(`[RepPOI] 开始筛选，目标: ${TARGET_COUNT}，原始候选: ${allPois.length}`)
  
  // ========== 第 0 步：强力黑名单过滤 ==========
  const candidatePool = allPois.filter(poi => {
    const props = poi.properties || poi
    const name = props['名称'] || props.name || ''
    const cat = `${props['大类'] || ''} ${props['中类'] || ''} ${props['小类'] || ''} ${poi.category || ''}`
    
    // 1. 检查名称黑名单
    for (const blackWord of BLACKLIST_ALL) {
      if (name.includes(blackWord)) return false
    }
    
    // 2. 检查类别黑名单（补充排除充电宝、维修点等）
    const auxiliaryWords = REPRESENTATIVE_BLACKLIST.auxiliary
    if (auxiliaryWords.some(word => cat.includes(word))) return false
    
    // 3. 过滤掉不知名公司/有限公司（非知名品牌且分值不高）
    // 特别修正：即使包含知名品牌(如万达)，如果带有"营销中心"、"租赁"等词，也要过滤
    if (name.includes('公司') || name.includes('有限') || name.includes('租赁')) {
        const isFamous = SEMANTIC_KEYWORDS.brands.some(b => name.includes(b))
        // 如果包含“营销中心”等，直接杀，不管是不是名牌
        if (REPRESENTATIVE_BLACKLIST.sales.some(s => name.includes(s))) return false
        
        if (!isFamous && (poi.score < 4 || !poi.score)) return false
    }
    
    // 4. 营销中心补漏 (针对不含“公司”名字的)
    if (REPRESENTATIVE_BLACKLIST.sales.some(s => name.includes(s))) return false

    return true
  })
  
  console.log(`[RepPOI] 强力过滤后剩余: ${candidatePool.length} 条`)
  
  if (candidatePool.length === 0) {
    console.warn('[RepPOI] 警告: 黑名单过滤后无候选')
    return []
  }
  
  // ========== 分类候选池 ==========
  const highPriorityPois = []     // 高代表性：景点、交通枢纽、核心政府
  const commonBusinessPois = {}   // 常见业态：美食、银行、医院等（按类型分组）
  const otherPois = []            // 其他
  
  // 初始化常见业态分组
  Object.keys(COMMON_BUSINESS_TYPES).forEach(type => {
    commonBusinessPois[type] = []
  })
  
  candidatePool.forEach(poi => {
    const props = poi.properties || poi
    const name = props['名称'] || props.name || ''
    const fullText = `${name} ${props['大类'] || ''} ${props['中类'] || ''} ${props['小类'] || ''}`
    
    // 检查是否为高代表性类型
    let isHighPriority = false
    for (const typeGroup of Object.values(HIGH_REPRESENTATIVE_TYPES)) {
      for (const typeWord of typeGroup) {
        if (fullText.includes(typeWord)) {
          highPriorityPois.push(poi)
          isHighPriority = true
          break
        }
      }
      if (isHighPriority) break
    }
    
    if (isHighPriority) return
    
    // 检查是否为常见业态
    let isCommonBusiness = false
    for (const [bizType, keywords] of Object.entries(COMMON_BUSINESS_TYPES)) {
      for (const kw of keywords) {
        if (fullText.includes(kw)) {
          commonBusinessPois[bizType].push(poi)
          isCommonBusiness = true
          break
        }
      }
      if (isCommonBusiness) break
    }
    
    if (!isCommonBusiness) {
      otherPois.push(poi)
    }
  })
  
  console.log(`[RepPOI] 分类结果: 高代表性=${highPriorityPois.length}, 常见业态=${Object.values(commonBusinessPois).flat().length}, 其他=${otherPois.length}`)
  
  // ========== 辅助函数：添加 POI 到结果 ==========
  const addToSelected = (poi) => {
    const props = poi.properties || poi
    const name = props['名称'] || props.name || ''
    const id = poi.id || poi.poiid || name
    
    if (seenIds.has(id) || seenNames.has(name)) return false
    
    seenIds.add(id)
    seenNames.add(name)
    selected.push(poi)
    return true
  }
  
  // ========== 第 1 步：优先选高代表性 POI（最多 6 个）==========
  const highPriorityLimit = 6
  
  // 对高代表性 POI 按名称辨识度排序
  highPriorityPois.sort((a, b) => {
    const nameA = a.properties?.['名称'] || a['名称'] || a.name || ''
    const nameB = b.properties?.['名称'] || b['名称'] || b.name || ''
    
    // 景点优先
    const scoreA = computeHighPriorityScore(nameA)
    const scoreB = computeHighPriorityScore(nameB)
    return scoreB - scoreA
  })
  
  for (const poi of highPriorityPois) {
    if (selected.length >= highPriorityLimit) break
    addToSelected(poi)
  }
  
  console.log(`[RepPOI] 高代表性选取: ${selected.length} 个`)
  
  // ========== 第 2 步：每种常见业态选 1 个代表 ==========
  const commonBizLimit = 1  // 每类选 1 个
  
  for (const [bizType, pois] of Object.entries(commonBusinessPois)) {
    if (selected.length >= TARGET_COUNT) break
    if (pois.length === 0) continue
    
    // 优先选知名品牌
    let bestPoi = null
    for (const poi of pois) {
      const name = poi.properties?.['名称'] || poi['名称'] || poi.name || ''
      
      // 检查是否为知名品牌
      for (const brand of SEMANTIC_KEYWORDS.brands) {
        if (name.includes(brand)) {
          bestPoi = poi
          break
        }
      }
      if (bestPoi) break
    }
    
    // 如果没有知名品牌，选名称最短的（通常更简洁的名字更有辨识度）
    if (!bestPoi && pois.length > 0) {
      pois.sort((a, b) => {
        const nameA = a.properties?.['名称'] || a['名称'] || a.name || ''
        const nameB = b.properties?.['名称'] || b['名称'] || b.name || ''
        return nameA.length - nameB.length
      })
      bestPoi = pois[0]
    }
    
    if (bestPoi) {
      addToSelected(bestPoi)
    }
  }
  
  console.log(`[RepPOI] 常见业态代表选取后: ${selected.length} 个`)
  
  // ========== 第 3 步：强力补齐（如果有空位）==========
  // 如果前两步选完还不够 TARGET_COUNT，从整个 candidatePool 中按评分补齐
  if (selected.length < TARGET_COUNT) {
    const remainingNeed = TARGET_COUNT - selected.length
    console.log(`[RepPOI] 仍需补齐: ${remainingNeed} 个，从剩余候选池中挑选...`)
    
    // 对剩余候选池按分数排序
    const remainingCandidates = candidatePool.filter(p => {
       const props = p.properties || p
       const name = props['名称'] || props.name || ''
       const id = p.id || p.poiid || name
       return !seenIds.has(id) && !seenNames.has(name)
    })
    
    // 按综合语义分排序
    remainingCandidates.sort((a, b) => {
        const nameA = a.properties?.['名称'] || a.name || ''
        const nameB = b.properties?.['名称'] || b.name || ''
        // 注意：computeSemanticScore 是下面定义的函数，假设可用。如果没有，用 calculateLandmarkScore
        const scoreA = (a.score || 0) + calculateLandmarkScore(nameA, a.type || '')
        const scoreB = (b.score || 0) + calculateLandmarkScore(nameB, b.type || '')
        return scoreB - scoreA
    })
    
    for (const poi of remainingCandidates) {
        if (selected.length >= TARGET_COUNT) break
        addToSelected(poi)
    }
  }

  // 最终排序：景点优先，其次按分数
  selected.sort((a, b) => {
     const nameA = a.properties?.['名称'] || a.name || ''
     const nameB = b.properties?.['名称'] || b.name || ''
     const isAttrA = HIGH_REPRESENTATIVE_TYPES.attractions.some(t => (a.type || '').includes(t) || nameA.includes(t))
     const isAttrB = HIGH_REPRESENTATIVE_TYPES.attractions.some(t => (b.type || '').includes(t) || nameB.includes(t))
     
     if (isAttrA && !isAttrB) return -1
     if (!isAttrA && isAttrB) return 1
     return (b.score || 0) - (a.score || 0)
  })
  
  console.log(`[RepPOI] 最终选取: ${selected.length} 个代表性 POI`)
  
  return selected
}

/**
 * 计算高代表性 POI 的优先级分数
 */
function computeHighPriorityScore(name) {
  let score = 0
  
  // 景点类最高分
  for (const word of HIGH_REPRESENTATIVE_TYPES.attractions) {
    if (name.includes(word)) {
      score += 100
      break
    }
  }
  
  // 交通枢纽次之
  for (const word of HIGH_REPRESENTATIVE_TYPES.transport) {
    if (name.includes(word)) {
      score += 80
      break
    }
  }
  
  // 核心政府机构
  for (const word of HIGH_REPRESENTATIVE_TYPES.coreGov) {
    if (name.includes(word)) {
      score += 70
      break
    }
  }
  
  // 大型公共设施
  for (const word of HIGH_REPRESENTATIVE_TYPES.publicFacility) {
    if (name.includes(word)) {
      score += 60
      break
    }
  }
  
  return score
}

/**
 * 计算语义评分（用于排序"其他"类 POI）
 */
function computeSemanticScore(name) {
  let score = 50
  
  // 加分词
  for (const word of SEMANTIC_KEYWORDS.positive) {
    if (name.includes(word)) {
      score += 30
      break
    }
  }
  
  // 减分词
  for (const word of SEMANTIC_KEYWORDS.negative) {
    if (name.includes(word)) {
      score -= 20
      break
    }
  }
  
  // 品牌加分
  for (const brand of SEMANTIC_KEYWORDS.brands) {
    if (name.includes(brand)) {
      score += 20
      break
    }
  }
  
  // 名称长度惩罚
  if (name.length < 3) score -= 15
  if (name.length > 20) score -= 10
  
  return Math.max(0, score)
}

/**
 * 计算类别统计
 */
function computeCategoryStats(pois) {
  const stats = new Map()
  
  pois.forEach(poi => {
    const props = poi.properties || poi
    const cat = props['大类'] || props.category_big || props.type || '其他'
    
    if (!stats.has(cat)) {
      stats.set(cat, { category: cat, count: 0 })
    }
    stats.get(cat).count++
  })
  
  return Array.from(stats.values()).sort((a, b) => b.count - a.count)
}

function getPolygonCenter(ring) {
  // 简单质心
  let sx = 0, sy = 0, n = ring.length
  ring.forEach(p => { sx += p[0]; sy += p[1] })
  return { lon: sx/n, lat: sy/n }
}


/**
 * 图推理模式：空间拓扑分析
 * 
 * 利用 H3 网格构建空间图，执行：
 * - PageRank: 识别区域核心枢纽
 * - 介数中心性: 识别桥梁连接节点  
 * - 社区检测: 发现业态协同区
 * 
 * 综合评分公式: FinalScore = α*Spatial + β*Functional + γ*Semantic + δ*GraphCentrality
 */
async function execGraphMode(plan, frontendPOIs, options = {}) {
  console.log('[Executor] 进入图推理模式')
  
  const result = {
    mode: 'graph_analysis',
    anchor: null,
    pois: [],
    area_profile: null,
    landmarks: [],
    graph_analysis: null, // 图分析结果
    fuzzy_regions: [],    // 模糊区域数据 (Inherited from Aggregated)
    stats: {
      total_candidates: 0,
      filtered_count: 0,
      graph_reasoning_applied: true
    }
  }

  // 1. 首先执行聚合分析获取候选数据
  const aggregatedResult = await execAggregatedAnalysisMode(plan, frontendPOIs, options)
  
  // 复制基础结果
  result.anchor = aggregatedResult.anchor
  result.area_profile = aggregatedResult.area_profile
  result.landmarks = aggregatedResult.landmarks
  result.fuzzy_regions = aggregatedResult.fuzzy_regions || [] // 继承模糊区域数据
  result.stats.total_candidates = aggregatedResult.stats?.total_candidates || 0
  
  // 2. 动态导入图服务（避免循环依赖）
  let graphService
  try {
    graphService = await import('../../services/graph.js')
  } catch (err) {
    console.error('[Executor] 图服务导入失败:', err.message)
    // 降级返回聚合结果
    result.mode = 'aggregated_analysis_fallback'
    result.pois = aggregatedResult.pois
    result.graph_analysis = { error: '图服务不可用' }
    return result
  }

  // 3. 收集用于图分析的 POI 数据
  // 优先使用数据库检索的原始候选集，如果没有则用前端数据
  let poisForGraph = []
  
  const spatialContext = options.spatialContext || options.context || {}
  let searchCenter = null
  
  if (spatialContext.center) {
    searchCenter = spatialContext.center
  } else if (spatialContext.viewport) {
    searchCenter = {
      lon: (spatialContext.viewport[0] + spatialContext.viewport[2]) / 2,
      lat: (spatialContext.viewport[1] + spatialContext.viewport[3]) / 2
    }
  } else if (result.anchor) {
    searchCenter = { lon: result.anchor.lon, lat: result.anchor.lat }
  }

  // 从数据库获取更多 POI 用于图分析
  if (searchCenter) {
    const graphSearchPlan = { 
      ...plan, 
      categories: [], // 全类目以便分析网络结构
      limit: 2000     // 图分析需要更多数据点
    }
    
    let hardBoundaryWKT = null
    if (spatialContext.boundary && spatialContext.mode === 'Polygon') {
      hardBoundaryWKT = pointsToWKT(spatialContext.boundary)
    } else if (spatialContext.viewport) {
      hardBoundaryWKT = bboxToWKT(spatialContext.viewport)
    }
    
    try {
      poisForGraph = await searchFromDatabase(
        searchCenter, 
        plan.radius_m || 3000, 
        graphSearchPlan, 
        hardBoundaryWKT
      )
      console.log(`[Executor] 图分析数据检索: ${poisForGraph.length} 条`)
    } catch (err) {
      console.warn('[Executor] 图分析数据检索失败:', err.message)
    }
  }

  // 兜底使用前端数据
  if (poisForGraph.length < 10 && Array.isArray(frontendPOIs) && frontendPOIs.length > 0) {
    poisForGraph = frontendPOIs
    console.log(`[Executor] 使用前端数据进行图分析: ${poisForGraph.length} 条`)
  }

  // 4. 执行图推理
  if (poisForGraph.length >= 5) {
    const graphResult = graphService.analyzeGraph(poisForGraph, {
      resolution: plan.aggregation_strategy?.resolution || 9
    })

    if (graphResult.success) {
      result.graph_analysis = graphResult.graph_analysis
      result.stats.graph_node_count = graphResult.stats?.node_count
      result.stats.graph_edge_count = graphResult.stats?.edge_count
      result.stats.graph_duration_ms = graphResult.stats?.duration_ms

      // 5. 基于图分析结果增强 POI 选择
      // 优先选择位于枢纽区域的 POI
      const hubH3Indices = new Set(
        (graphResult.graph_analysis.hubs || []).map(h => h.h3Index)
      )
      const bridgeH3Indices = new Set(
        (graphResult.graph_analysis.bridges || []).map(b => b.h3Index)
      )

      // 为每个候选 POI 计算图加权分数
      const enhancedPOIs = aggregatedResult.pois.map(poi => {
        const lat = poi.lat || (poi.geometry?.coordinates ? poi.geometry.coordinates[1] : null)
        const lon = poi.lon || (poi.geometry?.coordinates ? poi.geometry.coordinates[0] : null)
        
        let graphBonus = 0
        if (lat != null && lon != null) {
          try {
            const poiH3 = h3.latLngToCell(lat, lon, plan.aggregation_strategy?.resolution || 9)
            if (hubH3Indices.has(poiH3)) {
              graphBonus = 0.3 // 枢纽区域加分
              poi.graph_role = 'hub'
            } else if (bridgeH3Indices.has(poiH3)) {
              graphBonus = 0.2 // 桥梁区域加分
              poi.graph_role = 'bridge'
            }
          } catch (e) {
            // 忽略 H3 错误
          }
        }
        
        poi.graph_bonus = graphBonus
        poi.enhanced_score = (poi.score || 0.5) + graphBonus
        return poi
      })

      // 按增强分数重排序
      enhancedPOIs.sort((a, b) => (b.enhanced_score || 0) - (a.enhanced_score || 0))
      
      result.pois = compressPOIs(
        enhancedPOIs.slice(0, plan.sampling_strategy?.count || 20),
        result.anchor?.name
      )

      // 为枢纽 POI 添加标记
      result.pois.forEach(poi => {
        if (poi.graph_role) {
          poi.tags = poi.tags || []
          if (poi.graph_role === 'hub') {
            poi.tags.push('区域枢纽')
          } else if (poi.graph_role === 'bridge') {
            poi.tags.push('连接节点')
          }
        }
      })

      console.log(`[Executor] 图推理增强完成: ${result.pois.length} POIs, ` +
                  `${graphResult.graph_analysis.hubs?.length || 0} 枢纽, ` +
                  `${graphResult.graph_analysis.communities?.length || 0} 社区`)
    } else {
      console.warn('[Executor] 图推理失败:', graphResult.error)
      result.pois = aggregatedResult.pois
      result.graph_analysis = { error: graphResult.error }
    }
  } else {
    console.log('[Executor] POI 数量不足，跳过图推理')
    result.pois = aggregatedResult.pois
    result.graph_analysis = { error: 'POI 数量不足（需要至少 5 个）' }
  }

  result.stats.filtered_count = result.pois.length
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
      categories: (plan.categories && plan.categories.length > 0) ? plan.categories : [], // 空数组代表全匹配
      rating_range: plan.rating_range,
      geometry: geometryWKT,
      limit: plan.limit || EXECUTOR_CONFIG.maxCandidates
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
 * Phase 4 优化：移除ID字段，减少认知负荷
 */
function compressPOIs(pois, anchorName = '') {
  return pois.map(poi => {
    if (!poi) return null
    const props = poi.properties || poi
    
    return {
      // 移除ID字段：该标识符对叙事分析无语义价值
      // id: poi.id || props.id || poi.poiid,
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
  }).filter(Boolean)
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
  // H3 空间聚合统计
  const h3Stats = {}
  const categoryStats = {}

  pois.forEach(poi => {
    const props = poi.properties || poi
    
    // 1. 类别统计
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

    // 2. H3 空间聚合
    const lon = props.lon || (poi.geometry?.coordinates ? poi.geometry.coordinates[0] : null)
    const lat = props.lat || (poi.geometry?.coordinates ? poi.geometry.coordinates[1] : null)
    
    if (typeof lat === 'number' && typeof lon === 'number' && !isNaN(lat) && !isNaN(lon)) {
      try {
        const h3Index = h3.latLngToCell(lat, lon, EXECUTOR_CONFIG.h3Resolution)
        h3Stats[h3Index] = (h3Stats[h3Index] || 0) + 1
      } catch (e) {
        // Ignore H3 errors for individual points
      }
    }
  })
  
  // 转换类别统计为排序后的数组
  const total = pois.length
  const sortedCategories = Object.entries(categoryStats)
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
    
  // 转换 H3 统计为数组 (用于热力图渲染)
  const sortedH3Bins = Object.entries(h3Stats)
    .map(([index, count]) => ({ index, count }))
    .sort((a, b) => b.count - a.count)
  
  return {
    total_count: total,
    dominant_categories: sortedCategories.slice(0, 5),
    rare_categories: sortedCategories.filter(c => c.count <= 2).slice(0, 3),
    spatial_distribution: {
      resolution: EXECUTOR_CONFIG.h3Resolution,
      total_bins: sortedH3Bins.length,
      bins: sortedH3Bins
    }
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
 * 提取代表性地标 (智能版)
 * 
 * 核心逻辑：不仅匹配类型，还要评估 POI 是否具有"地标价值"
 * - 排除明显不具备代表性的 POI（如公厕、宿舍、体育场）
 * - 优先选择知名度高、辨识度强的地点
 * - 考虑名称特征（包含"总"、"中心"、"大"等词通常更具代表性）
 */
async function extractLandmarks(frontendPOIs, anchor, radius) {
  const landmarks = []
  const seenNames = new Set()
  
  // 计算每个 POI 的地标评分
  const scoredPOIs = frontendPOIs.map(poi => {
    const props = poi.properties || poi
    const name = props['名称'] || props.name || ''
    const category = `${props['大类'] || ''} ${props['中类'] || ''} ${props['小类'] || ''} ${props.type || ''}`
    
    const score = calculateLandmarkScore(name, category)
    
    // 计算距离（如果有锚点）
    let distance_m = 0
    if (anchor && poi.geometry?.coordinates) {
      distance_m = calculateDistance(
        anchor.lat, anchor.lon,
        poi.geometry.coordinates[1], poi.geometry.coordinates[0]
      )
    }
    
    return {
      poi,
      name,
      category,
      score,
      distance_m,
      props
    }
  })
  
  // 按评分排序，取 Top N
  scoredPOIs
    .filter(item => item.score > 0) // 排除得分为 0 的（被排除的类型）
    .sort((a, b) => {
      // 优先按评分，其次按距离
      if (b.score !== a.score) return b.score - a.score
      return a.distance_m - b.distance_m
    })
    .forEach(item => {
      if (landmarks.length >= EXECUTOR_CONFIG.maxLandmarks) return
      if (seenNames.has(item.name)) return // 去重
      
      seenNames.add(item.name)
      landmarks.push({
        name: item.name,
        type: extractPrimaryType(item.category),
        distance_m: Math.round(item.distance_m),
        relevance_score: item.score,
        category_detail: item.props['小类'] || item.props['中类'] || ''
      })
    })
  
  return landmarks
}

/**
 * 计算 POI 的地标价值评分
 * 
 * 评分维度：
 * 1. 黑名单过滤 (BLACKLIST_ALL)
 * 2. 语义加分词 / 减分词
 * 3. 品牌辨识度
 * 
 * @returns {number} 0-100 的评分，0 表示应该排除
 */
function calculateLandmarkScore(name, category) {
  const fullText = `${name} ${category}`
  
  // 1. 首先检查黑名单 - 如果命中则直接返回 0
  for (const blackWord of BLACKLIST_ALL) {
    if (name.includes(blackWord)) {
      return 0 // 直接排除
    }
  }
  
  let score = 20 // 基础分
  
  // 2. 语义加分词 (像一个真正的地标)
  for (const posWord of SEMANTIC_KEYWORDS.positive) {
    if (name.includes(posWord)) {
      score += 40
      break
    }
  }
  
  // 3. 语义减分词 (附属设施或同质化)
  for (const negWord of SEMANTIC_KEYWORDS.negative) {
    if (name.includes(negWord)) {
      score -= 20
      break
    }
  }
  
  // 4. 知名品牌加分
  for (const brand of SEMANTIC_KEYWORDS.brands) {
    if (name.includes(brand)) {
      score += 25
      break
    }
  }
  
  // 5. 名称长度惩罚 (过短或过长)
  if (name.length < 3) score -= 15
  if (name.length > 20) score -= 10
  
  return Math.max(0, score) // 确保不为负数
}

/**
 * 从完整类别字符串中提取主要类型
 */
function extractPrimaryType(category) {
  const types = ['地铁站', '火车站', '机场', '大学', '中学', '小学', '医院', '商场', 
                 '超市', '公园', '广场', '银行', '酒店', '影院', '体育馆', '博物馆', 
                 '图书馆', '政府', '景点', '写字楼', '住宅区']
  
  for (const t of types) {
    if (category.includes(t)) return t
  }
  
  // 尝试提取小类
  const parts = category.split(/\s+/).filter(Boolean)
  return parts[parts.length - 1] || '其他'
}

/**
 * 地标类型相关性打分 (保留用于兼容)
 * @deprecated 使用 calculateLandmarkScore 替代
 */
function getLandmarkRelevanceScore(type) {
  const { landmarkWeights } = EXECUTOR_CONFIG
  
  if (landmarkWeights.high.some(t => type.includes(t))) return 50
  if (landmarkWeights.medium.some(t => type.includes(t))) return 30
  if (landmarkWeights.low.some(t => type.includes(t))) return 10
  if (landmarkWeights.exclude.some(t => type.includes(t))) return 0
  
  return 5 // 默认低分
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

// =====================================================
// 多选区对比模式
// =====================================================

/**
 * 多选区对比执行器
 * 
 * @param {Object} queryPlan - 查询计划，包含 target_regions
 * @param {Object} options - 选项，包含 regions 上下文数据
 * @returns {Promise<Object>} 对比结果
 */
async function execRegionComparison(queryPlan, options = {}) {
  const { regions = [] } = options
  const targetRegionIds = queryPlan.target_regions || []
  
  console.log(`[Executor] 多选区对比模式: 目标选区 ${targetRegionIds.join(', ')}`)
  console.log(`[Executor] 可用选区: ${regions.map(r => r.id).join(', ')}`)
  
  // 验证目标选区是否存在
  const targetRegions = regions.filter(r => targetRegionIds.includes(r.id))
  
  if (targetRegions.length < 2) {
    console.warn(`[Executor] 对比分析需要至少2个选区，当前只有 ${targetRegions.length} 个`)
    return {
      mode: 'region_comparison',
      error: '对比分析需要至少2个有效选区',
      comparison: null,
      stats: { 
        valid_regions: targetRegions.length,
        requested_regions: targetRegionIds.length
      }
    }
  }
  
  // 对每个选区进行分析
  const regionAnalyses = []
  
  for (const region of targetRegions) {
    const analysis = await analyzeRegion(region, queryPlan)
    regionAnalyses.push(analysis)
  }
  
  // 计算跨选区对比
  const comparison = computeRegionComparison(regionAnalyses, queryPlan.comparison_dimensions)
  
  return {
    mode: 'region_comparison',
    target_regions: targetRegionIds,
    region_analyses: regionAnalyses,
    comparison,
    pois: [], // 对比模式不返回具体 POI，只返回统计
    area_profile: null,
    landmarks: [],
    stats: {
      regions_analyzed: regionAnalyses.length,
      total_pois: regionAnalyses.reduce((sum, r) => sum + r.poi_count, 0)
    }
  }
}

/**
 * 分析单个选区
 */
async function analyzeRegion(region, queryPlan) {
  const { id, name, boundaryWKT, pois = [], stats } = region
  
  // 如果前端已经传了 POI 数据，直接使用
  let regionPois = pois
  
  // 如果没有 POI 数据但有 WKT，从数据库查询
  if (regionPois.length === 0 && boundaryWKT) {
    try {
      const categories = queryPlan.categories || []
      regionPois = await queryPoisInRegion(boundaryWKT, categories)
    } catch (err) {
      console.error(`[Executor] 查询选区 ${name} POI 失败:`, err.message)
    }
  }
  
  // 计算类别分布
  const categoryDistribution = {}
  const majorCategoryDistribution = {} // 大类分布
  
  regionPois.forEach(poi => {
    const props = poi.properties || poi
    const category = props['小类'] || props['中类'] || props.category || '未分类'
    const majorCategory = props['大类'] || '其他'
    
    categoryDistribution[category] = (categoryDistribution[category] || 0) + 1
    majorCategoryDistribution[majorCategory] = (majorCategoryDistribution[majorCategory] || 0) + 1
  })
  
  // 排序获取 Top 类别
  const topCategories = Object.entries(categoryDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count, ratio: (count / regionPois.length * 100).toFixed(1) + '%' }))
  
  const topMajorCategories = Object.entries(majorCategoryDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count, ratio: (count / regionPois.length * 100).toFixed(1) + '%' }))
  
  return {
    id,
    name,
    poi_count: regionPois.length,
    category_distribution: categoryDistribution,
    major_category_distribution: majorCategoryDistribution,
    top_categories: topCategories,
    top_major_categories: topMajorCategories,
    center: region.center
  }
}

/**
 * 从数据库查询选区内的 POI
 */
async function queryPoisInRegion(boundaryWKT, categories = []) {
  const db = await import('../../services/db.js').then(m => m.default)
  
  let sql = `
    SELECT id, name, category, "大类", "中类", "小类", 
           ST_X(geom) as lon, ST_Y(geom) as lat
    FROM pois
    WHERE ST_Within(geom, ST_GeomFromText($1, 4326))
  `
  const params = [boundaryWKT]
  
  if (categories.length > 0) {
    sql += ` AND ("小类" = ANY($2) OR "中类" = ANY($2) OR "大类" = ANY($2))`
    params.push(categories)
  }
  
  sql += ` LIMIT 10000`
  
  try {
    const result = await db.query(sql, params)
    return result.rows || []
  } catch (err) {
    console.error('[Executor] 查询选区 POI 失败:', err.message)
    return []
  }
}

/**
 * 计算跨选区对比
 */
function computeRegionComparison(regionAnalyses, dimensions = []) {
  if (regionAnalyses.length < 2) return null
  
  const similarities = []
  const differences = []
  
  // 比较各选区的主要类别
  const allMajorCategories = new Set()
  regionAnalyses.forEach(r => {
    Object.keys(r.major_category_distribution).forEach(cat => allMajorCategories.add(cat))
  })
  
  // 计算每个大类在各选区的占比差异
  allMajorCategories.forEach(category => {
    const ratios = regionAnalyses.map(r => {
      const count = r.major_category_distribution[category] || 0
      return {
        region: r.name,
        count,
        ratio: r.poi_count > 0 ? (count / r.poi_count * 100) : 0
      }
    })
    
    // 计算占比差异
    const maxRatio = Math.max(...ratios.map(r => r.ratio))
    const minRatio = Math.min(...ratios.map(r => r.ratio))
    const ratioGap = maxRatio - minRatio
    
    if (ratioGap < 5) {
      // 差异小于 5%，视为相似
      if (maxRatio > 5) { // 只关注占比超过 5% 的类别
        similarities.push({
          dimension: category,
          description: `各选区${category}占比相近 (${minRatio.toFixed(1)}% ~ ${maxRatio.toFixed(1)}%)`,
          ratios
        })
      }
    } else {
      // 差异明显
      const maxRegion = ratios.find(r => r.ratio === maxRatio)
      const minRegion = ratios.find(r => r.ratio === minRatio)
      differences.push({
        dimension: category,
        description: `${maxRegion.region}的${category}占比(${maxRatio.toFixed(1)}%)明显高于${minRegion.region}(${minRatio.toFixed(1)}%)`,
        gap: ratioGap.toFixed(1) + '%',
        ratios
      })
    }
  })
  
  // 按差异大小排序
  differences.sort((a, b) => parseFloat(b.gap) - parseFloat(a.gap))
  
  // 生成对比摘要
  const summary = generateComparisonSummary(regionAnalyses, differences, similarities)
  
  return {
    regions_compared: regionAnalyses.map(r => r.name),
    total_pois_compared: regionAnalyses.reduce((sum, r) => sum + r.poi_count, 0),
    similarities: similarities.slice(0, 5),
    differences: differences.slice(0, 10),
    summary
  }
}

/**
 * 生成对比摘要文本
 */
function generateComparisonSummary(regionAnalyses, differences, similarities) {
  const lines = []
  
  // 基本信息
  const regionNames = regionAnalyses.map(r => r.name).join('与')
  lines.push(`${regionNames}对比分析：`)
  
  // POI 总量对比
  const poiCounts = regionAnalyses.map(r => `${r.name}(${r.poi_count}个POI)`)
  lines.push(`- POI总量: ${poiCounts.join(', ')}`)
  
  // 主要差异
  if (differences.length > 0) {
    lines.push(`- 主要差异(${differences.length}项):`)
    differences.slice(0, 3).forEach(d => {
      lines.push(`  · ${d.description}`)
    })
  }
  
  // 相似点
  if (similarities.length > 0) {
    lines.push(`- 相似特征(${similarities.length}项):`)
    similarities.slice(0, 2).forEach(s => {
      lines.push(`  · ${s.description}`)
    })
  }
  
  return lines.join('\n')
}

export default {
  executeQuery,
  execRegionComparison,
  EXECUTOR_CONFIG
}

