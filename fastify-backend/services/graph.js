/**
 * H3 空间拓扑图服务 (Graph Reasoning Module)
 * 
 * 核心功能：
 * 1. 将 H3 网格构建为拓扑图（节点 = H3 单元，边 = 相邻关系）
 * 2. 实现图中心性算法（PageRank、度中心性、介数中心性）
 * 3. 实现社区检测算法（标签传播、Louvain）
 * 4. 生成结构化摘要供 Writer 使用
 * 
 * 设计原则：
 * - 纯内存计算，不依赖外部图数据库
 * - 轻量级实现，适合实时分析
 * - 与现有 H3 聚合逻辑无缝衔接
 */

import h3 from 'h3-js'

/**
 * 图配置
 */
const GRAPH_CONFIG = {
  // PageRank 参数
  pageRank: {
    damping: 0.85,        // 阻尼系数
    maxIterations: 20,    // 最大迭代次数
    tolerance: 1e-6       // 收敛阈值
  },
  
  // 社区检测参数
  community: {
    maxIterations: 10,    // 标签传播最大迭代
    minCommunitySize: 3   // 最小社区大小
  },
  
  // 输出限制
  output: {
    maxHubs: 5,           // 最多返回枢纽数
    maxBridges: 5,        // 最多返回桥接节点数
    maxCommunities: 6     // 最多返回社区数
  }
}

/**
 * H3 空间拓扑图类
 * 
 * 图结构：
 * - nodes: Map<h3Index, { id, count, mainCategory, pois, lat, lon, ... }>
 * - edges: Map<h3Index, Set<h3Index>> (邻接表)
 */
class H3SpatialGraph {
  constructor() {
    this.nodes = new Map()
    this.edges = new Map()
    this.resolution = 9
  }

  /**
   * 从 POI 数组构建图
   * @param {Array} pois - POI 数组
   * @param {number} resolution - H3 分辨率
   */
  buildFromPOIs(pois, resolution = 9) {
    this.resolution = resolution
    this.nodes.clear()
    this.edges.clear()

    if (!pois || pois.length === 0) return this

    // 1. 构建节点（H3 网格聚合）
    pois.forEach(poi => {
      const lat = poi.lat || (poi.geometry?.coordinates ? poi.geometry.coordinates[1] : null)
      const lon = poi.lon || (poi.geometry?.coordinates ? poi.geometry.coordinates[0] : null)

      if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return

      try {
        const h3Index = h3.latLngToCell(lat, lon, resolution)

        if (!this.nodes.has(h3Index)) {
          const [cellLat, cellLon] = h3.cellToLatLng(h3Index)
          this.nodes.set(h3Index, {
            id: h3Index,
            count: 0,
            categories: {},
            pois: [],
            lat: cellLat,
            lon: cellLon,
            mainCategory: null,
            // 图属性（后续算法填充）
            degree: 0,
            pageRank: 0,
            betweenness: 0,
            communityId: null
          })
        }

        const node = this.nodes.get(h3Index)
        node.count++
        node.pois.push({
          name: poi.name || poi.properties?.['名称'] || '未命名',
          type: poi.type || poi.properties?.['小类'] || '',
          id: poi.id
        })

        // 类别统计
        const props = poi.properties || poi
        const cat = props['大类'] || props.category_big || props['中类'] || props.type || '未分类'
        node.categories[cat] = (node.categories[cat] || 0) + 1
      } catch (e) {
        // 忽略无效坐标
      }
    })

    // 2. 计算每个节点的主导类别
    this.nodes.forEach(node => {
      let maxCat = '', maxCount = 0
      for (const [cat, count] of Object.entries(node.categories)) {
        if (count > maxCount) {
          maxCount = count
          maxCat = cat
        }
      }
      node.mainCategory = maxCat
      node.categoryRatio = node.count > 0 ? maxCount / node.count : 0
    })

    // 3. 构建边（H3 相邻关系）
    this.nodes.forEach((_, h3Index) => {
      try {
        const neighbors = h3.gridDisk(h3Index, 1).filter(n => n !== h3Index && this.nodes.has(n))
        this.edges.set(h3Index, new Set(neighbors))
        
        // 更新度数
        const node = this.nodes.get(h3Index)
        node.degree = neighbors.length
      } catch (e) {
        this.edges.set(h3Index, new Set())
      }
    })

    console.log(`[Graph] 构建完成: ${this.nodes.size} 节点, ${this.getEdgeCount()} 边`)
    return this
  }

  /**
   * 获取边的总数
   */
  getEdgeCount() {
    let count = 0
    this.edges.forEach(neighbors => { count += neighbors.size })
    return count / 2 // 无向图，每条边被计算两次
  }

  /**
   * 执行 PageRank 算法
   * 
   * 识别区域中最重要的"POI密集区/枢纽"
   */
  computePageRank() {
    const { damping, maxIterations, tolerance } = GRAPH_CONFIG.pageRank
    const n = this.nodes.size
    if (n === 0) return

    // 初始化：按 POI 密度加权
    const totalCount = Array.from(this.nodes.values()).reduce((s, node) => s + node.count, 0)
    this.nodes.forEach(node => {
      node.pageRank = node.count / totalCount
    })

    // 迭代计算
    for (let iter = 0; iter < maxIterations; iter++) {
      let delta = 0
      const newRanks = new Map()

      this.nodes.forEach((node, h3Index) => {
        let rank = (1 - damping) / n

        // 从邻居收集贡献
        this.edges.get(h3Index)?.forEach(neighborId => {
          const neighbor = this.nodes.get(neighborId)
          const neighborDegree = this.edges.get(neighborId)?.size || 1
          rank += damping * (neighbor.pageRank / neighborDegree)
        })

        // POI 密度加权
        const densityBonus = (node.count / Math.max(totalCount, 1)) * 0.2
        rank += densityBonus

        newRanks.set(h3Index, rank)
        delta += Math.abs(rank - node.pageRank)
      })

      // 更新排名
      newRanks.forEach((rank, h3Index) => {
        this.nodes.get(h3Index).pageRank = rank
      })

      if (delta < tolerance) {
        console.log(`[Graph] PageRank 收敛于第 ${iter + 1} 次迭代`)
        break
      }
    }

    // 归一化
    const maxRank = Math.max(...Array.from(this.nodes.values()).map(n => n.pageRank))
    if (maxRank > 0) {
      this.nodes.forEach(node => {
        node.pageRank = node.pageRank / maxRank
      })
    }
  }

  /**
   * 计算介数中心性 (简化版 Betweenness Centrality)
   * 
   * 识别"桥梁"节点：连接不同业态区域的关键网格
   * 
   * 注意：完整的介数中心性算法是 O(V*E)，这里使用采样近似
   */
  computeBetweenness() {
    const nodeIds = Array.from(this.nodes.keys())
    const n = nodeIds.length
    if (n < 3) return

    // 采样源节点数量（大图优化）
    const sampleSize = Math.min(n, 30)
    const sampledSources = nodeIds
      .sort(() => Math.random() - 0.5)
      .slice(0, sampleSize)

    // 初始化
    this.nodes.forEach(node => { node.betweenness = 0 })

    // BFS 计算最短路径
    sampledSources.forEach(source => {
      const dist = new Map()
      const numPaths = new Map()
      const predecessors = new Map()
      const stack = []

      dist.set(source, 0)
      numPaths.set(source, 1)
      const queue = [source]

      while (queue.length > 0) {
        const v = queue.shift()
        stack.push(v)

        this.edges.get(v)?.forEach(w => {
          if (!dist.has(w)) {
            dist.set(w, dist.get(v) + 1)
            queue.push(w)
          }

          if (dist.get(w) === dist.get(v) + 1) {
            numPaths.set(w, (numPaths.get(w) || 0) + (numPaths.get(v) || 1))
            if (!predecessors.has(w)) predecessors.set(w, [])
            predecessors.get(w).push(v)
          }
        })
      }

      // 反向累积
      const dependency = new Map()
      nodeIds.forEach(id => dependency.set(id, 0))

      while (stack.length > 0) {
        const w = stack.pop()
        predecessors.get(w)?.forEach(v => {
          const c = ((numPaths.get(v) || 1) / (numPaths.get(w) || 1)) * (1 + dependency.get(w))
          dependency.set(v, dependency.get(v) + c)
        })
        if (w !== source) {
          const node = this.nodes.get(w)
          node.betweenness += dependency.get(w)
        }
      }
    })

    // 归一化
    const maxBetweenness = Math.max(...Array.from(this.nodes.values()).map(n => n.betweenness))
    if (maxBetweenness > 0) {
      this.nodes.forEach(node => {
        node.betweenness = node.betweenness / maxBetweenness
      })
    }
  }

  /**
   * 社区检测：标签传播算法 (Label Propagation)
   * 
   * 识别"业态协同区"：哪些 H3 网格形成了功能相似的社区
   */
  detectCommunities() {
    const { maxIterations, minCommunitySize } = GRAPH_CONFIG.community
    const nodeIds = Array.from(this.nodes.keys())

    // 初始化：每个节点是自己的社区
    nodeIds.forEach((id, i) => {
      this.nodes.get(id).communityId = i
    })

    // 标签传播迭代
    for (let iter = 0; iter < maxIterations; iter++) {
      let changed = false

      // 随机顺序遍历
      const shuffled = nodeIds.sort(() => Math.random() - 0.5)

      shuffled.forEach(nodeId => {
        const neighbors = this.edges.get(nodeId)
        if (!neighbors || neighbors.size === 0) return

        // 统计邻居的社区标签（加权：按 POI 数量）
        const labelCounts = new Map()
        neighbors.forEach(neighborId => {
          const neighbor = this.nodes.get(neighborId)
          const label = neighbor.communityId
          const weight = neighbor.count
          labelCounts.set(label, (labelCounts.get(label) || 0) + weight)
        })

        // 选择出现次数最多的标签
        let maxLabel = this.nodes.get(nodeId).communityId
        let maxCount = 0
        labelCounts.forEach((count, label) => {
          if (count > maxCount) {
            maxCount = count
            maxLabel = label
          }
        })

        if (this.nodes.get(nodeId).communityId !== maxLabel) {
          this.nodes.get(nodeId).communityId = maxLabel
          changed = true
        }
      })

      if (!changed) {
        console.log(`[Graph] 社区检测收敛于第 ${iter + 1} 次迭代`)
        break
      }
    }

    // 统计社区
    const communities = new Map()
    this.nodes.forEach((node, nodeId) => {
      const cid = node.communityId
      if (!communities.has(cid)) {
        communities.set(cid, { id: cid, nodes: [], totalPOIs: 0, categories: {} })
      }
      const comm = communities.get(cid)
      comm.nodes.push(nodeId)
      comm.totalPOIs += node.count

      // 汇总类别
      for (const [cat, count] of Object.entries(node.categories)) {
        comm.categories[cat] = (comm.categories[cat] || 0) + count
      }
    })

    // 过滤太小的社区
    const validCommunities = Array.from(communities.values())
      .filter(c => c.nodes.length >= minCommunitySize)
      .sort((a, b) => b.totalPOIs - a.totalPOIs)

    // 计算每个社区的主导业态
    validCommunities.forEach(comm => {
      let maxCat = '', maxCount = 0
      for (const [cat, count] of Object.entries(comm.categories)) {
        if (count > maxCount) {
          maxCount = count
          maxCat = cat
        }
      }
      comm.dominantCategory = maxCat
      comm.categoryRatio = comm.totalPOIs > 0 ? maxCount / comm.totalPOIs : 0
    })

    return validCommunities
  }

  /**
   * 获取枢纽节点（高 PageRank）
   */
  getHubs(topK = GRAPH_CONFIG.output.maxHubs) {
    return Array.from(this.nodes.values())
      .sort((a, b) => b.pageRank - a.pageRank)
      .slice(0, topK)
      .map(node => ({
        h3Index: node.id,
        lat: node.lat,
        lon: node.lon,
        poiCount: node.count,
        mainCategory: node.mainCategory,
        pageRank: Math.round(node.pageRank * 1000) / 1000,
        degree: node.degree,
        representativePOI: node.pois[0]?.name || '未命名'
      }))
  }

  /**
   * 获取桥梁节点（高介数中心性）
   */
  getBridges(topK = GRAPH_CONFIG.output.maxBridges) {
    return Array.from(this.nodes.values())
      .filter(n => n.betweenness > 0)
      .sort((a, b) => b.betweenness - a.betweenness)
      .slice(0, topK)
      .map(node => ({
        h3Index: node.id,
        lat: node.lat,
        lon: node.lon,
        poiCount: node.count,
        mainCategory: node.mainCategory,
        betweenness: Math.round(node.betweenness * 1000) / 1000,
        representativePOI: node.pois[0]?.name || '未命名'
      }))
  }

  /**
   * 生成图分析摘要（供 Writer 使用）
   */
  generateSummary() {
    const hubs = this.getHubs()
    const bridges = this.getBridges()
    const communities = this.detectCommunities()

    // 计算全局统计
    const totalNodes = this.nodes.size
    const totalEdges = this.getEdgeCount()
    const avgDegree = totalNodes > 0 
      ? Array.from(this.nodes.values()).reduce((s, n) => s + n.degree, 0) / totalNodes 
      : 0

    return {
      global: {
        totalGrids: totalNodes,
        totalConnections: totalEdges,
        avgConnectivity: Math.round(avgDegree * 100) / 100,
        resolution: this.resolution
      },
      hubs: hubs.slice(0, GRAPH_CONFIG.output.maxHubs),
      bridges: bridges.slice(0, GRAPH_CONFIG.output.maxBridges),
      communities: communities.slice(0, GRAPH_CONFIG.output.maxCommunities).map(c => ({
        id: c.id,
        gridCount: c.nodes.length,
        totalPOIs: c.totalPOIs,
        dominantCategory: c.dominantCategory,
        categoryRatio: Math.round(c.categoryRatio * 100)
      })),
      insights: this.generateInsights(hubs, bridges, communities)
    }
  }

  /**
   * 生成自然语言洞察
   */
  generateInsights(hubs, bridges, communities) {
    const insights = []

    // 枢纽洞察
    if (hubs.length > 0) {
      const topHub = hubs[0]
      insights.push({
        type: 'hub',
        text: `区域核心枢纽位于「${topHub.representativePOI}」附近，聚集了 ${topHub.poiCount} 个 POI，主要业态为${topHub.mainCategory}。`,
        importance: topHub.pageRank
      })
    }

    // 桥梁洞察
    if (bridges.length > 0 && bridges[0].betweenness > 0.5) {
      const topBridge = bridges[0]
      insights.push({
        type: 'bridge',
        text: `「${topBridge.representativePOI}」区域在网络中起到桥梁作用，连接了多个功能区域。`,
        importance: topBridge.betweenness
      })
    }

    // 社区洞察
    if (communities.length > 1) {
      const dominantComm = communities[0]
      insights.push({
        type: 'community',
        text: `检测到 ${communities.length} 个功能区块，最大区块以「${dominantComm.dominantCategory}」为主，占比 ${dominantComm.categoryRatio}%。`,
        importance: 0.8
      })
    } else if (communities.length === 1) {
      insights.push({
        type: 'community',
        text: `区域业态较为均质，整体以「${communities[0]?.dominantCategory || '综合'}」为主导。`,
        importance: 0.5
      })
    }

    return insights
  }
}

/**
 * 执行图推理分析
 * 
 * @param {Array} pois - POI 数组
 * @param {Object} options - 配置选项
 * @returns {Object} 图分析结果
 */
export function analyzeGraph(pois, options = {}) {
  const resolution = options.resolution || 9
  const startTime = Date.now()

  console.log(`[Graph] 开始图推理分析，POI 数量: ${pois?.length || 0}`)

  if (!pois || pois.length < 5) {
    return {
      success: false,
      error: 'POI 数量不足（至少需要 5 个）',
      graph_analysis: null
    }
  }

  try {
    const graph = new H3SpatialGraph()
    
    // 1. 构建图
    graph.buildFromPOIs(pois, resolution)

    if (graph.nodes.size < 3) {
      return {
        success: false,
        error: '有效网格数量不足（至少需要 3 个）',
        graph_analysis: null
      }
    }

    // 2. 计算图算法
    graph.computePageRank()
    graph.computeBetweenness()

    // 3. 生成摘要
    const summary = graph.generateSummary()

    const duration = Date.now() - startTime
    console.log(`[Graph] 图推理完成 (${duration}ms): ${summary.global.totalGrids} 网格, ${summary.hubs.length} 枢纽, ${summary.communities.length} 社区`)

    return {
      success: true,
      graph_analysis: summary,
      stats: {
        duration_ms: duration,
        node_count: graph.nodes.size,
        edge_count: graph.getEdgeCount()
      }
    }
  } catch (err) {
    console.error('[Graph] 图推理失败:', err.message)
    return {
      success: false,
      error: err.message,
      graph_analysis: null
    }
  }
}

/**
 * 计算带图中心性加权的 POI 评分
 * 
 * 公式: FinalScore = α*Spatial + β*Functional + γ*Semantic + δ*GraphCentrality
 * 
 * @param {Object} poi - POI 对象
 * @param {Object} graphNode - 该 POI 所在的图节点
 * @param {Object} weights - 权重配置
 */
export function computeGraphWeightedScore(poi, graphNode, weights = {}) {
  const {
    spatial = 0.3,
    functional = 0.3,
    semantic = 0.25,
    graph = 0.15
  } = weights

  // 空间分数（基于距离或密度）
  const spatialScore = poi.distance_score || (1 - Math.min((poi.distance_m || 5000) / 5000, 1))

  // 功能分数（基于类别重要性）
  const functionalScore = poi.functional_score || 0.5

  // 语义分数（基于向量相似度）
  const semanticScore = poi.semantic_score || 0.5

  // 图中心性分数（结合 PageRank 和度数）
  const graphScore = graphNode
    ? (graphNode.pageRank * 0.6 + (graphNode.degree / 6) * 0.4)
    : 0.5

  const finalScore = 
    spatial * spatialScore +
    functional * functionalScore +
    semantic * semanticScore +
    graph * graphScore

  return Math.round(finalScore * 1000) / 1000
}

/**
 * 判断查询是否需要图推理
 * 
 * @param {string} question - 用户问题
 * @returns {boolean}
 */
export function needsGraphReasoning(question) {
  if (!question) return false

  const graphKeywords = [
    // 网络/可达性
    '可达性', '交通网络', '路网', '连通性', '通达',
    // 枢纽/节点
    '枢纽', '核心节点', '中心节点', '交通中心', '商业中心',
    // 路径/连接
    '路径', '连接', '串联', '贯穿', '衔接',
    // 结构/拓扑
    '结构', '网络结构', '空间结构', '拓扑',
    // 关系
    '关联', '协同', '共生', '聚集效应', '辐射'
  ]

  const q = question.toLowerCase()
  return graphKeywords.some(kw => q.includes(kw))
}

export default {
  H3SpatialGraph,
  analyzeGraph,
  computeGraphWeightedScore,
  needsGraphReasoning,
  GRAPH_CONFIG
}
