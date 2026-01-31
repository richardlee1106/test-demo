/**
 * 空间聚类分析服务
 * 
 * 提供核密度估计(KDE)和DBSCAN聚类算法，用于识别商业热点和语义模糊区域
 * 
 * 核心功能：
 * 1. 核密度估计(KDE) - 生成连续密度表面
 * 2. DBSCAN聚类 - 基于密度的空间聚类
 * 3. 自然断点法(Jenks) - 确定密度阈值
 * 4. 等值线提取 - 生成模糊边界
 */

import h3 from 'h3-js';

/**
 * 核密度估计配置
 */
const KDE_CONFIG = {
  // 默认带宽（米）- 控制平滑程度
  defaultBandwidth: 200,
  // 网格分辨率（米）
  gridResolution: 50,
  // 最大网格数
  maxGridCells: 10000,
  // 密度衰减函数类型
  kernelType: 'gaussian' // 'gaussian' | 'epanechnikov' | 'quartic'
};

/**
 * DBSCAN配置
 */
const DBSCAN_CONFIG = {
  // 默认邻域半径（米）
  defaultEps: 150,
  // 最小点数形成簇
  minPoints: 3,
  // 最大簇数
  maxClusters: 10
};

/**
 * 核函数：高斯核
 * @param {number} d - 距离
 * @param {number} h - 带宽
 */
function gaussianKernel(d, h) {
  return Math.exp(-0.5 * (d / h) ** 2) / (h * Math.sqrt(2 * Math.PI));
}

/**
 * 核函数：Epanechnikov核
 * @param {number} d - 距离
 * @param {number} h - 带宽
 */
function epanechnikovKernel(d, h) {
  const u = d / h;
  return u <= 1 ? 0.75 * (1 - u ** 2) / h : 0;
}

/**
 * 核函数：四次核(Quartic/Biweight)
 * @param {number} d - 距离
 * @param {number} h - 带宽
 */
function quarticKernel(d, h) {
  const u = d / h;
  return u <= 1 ? (15 / 16) * (1 - u ** 2) ** 2 / h : 0;
}

/**
 * 获取核函数
 * @param {string} type - 核函数类型
 */
function getKernel(type) {
  switch (type) {
    case 'epanechnikov': return epanechnikovKernel;
    case 'quartic': return quarticKernel;
    case 'gaussian':
    default: return gaussianKernel;
  }
}

/**
 * 计算两点间距离（Haversine公式）
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // 地球半径（米）
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 计算点集的边界框
 * @param {Array<{lat: number, lon: number}>} points 
 */
function calculateBoundingBox(points) {
  if (!points || points.length === 0) return null;
  
  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;
  
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  
  return { minLat, maxLat, minLon, maxLon };
}

/**
 * 核密度估计(KDE) - 基于H3网格的优化实现
 * 
 * 算法流程：
 * 1. 将POI点映射到H3网格
 * 2. 对每个网格计算核密度（考虑邻近网格的影响）
 * 3. 返回密度网格列表
 * 
 * @param {Array} pois - POI点集
 * @param {Object} options - 配置选项
 * @returns {Object} 密度分析结果
 */
export function kernelDensityEstimation(pois, options = {}) {
  const bandwidth = options.bandwidth || KDE_CONFIG.defaultBandwidth;
  const resolution = options.resolution || 9; // H3分辨率
  const kernel = getKernel(options.kernelType || KDE_CONFIG.kernelType);
  
  if (!pois || pois.length === 0) {
    return { grids: [], maxDensity: 0, minDensity: 0 };
  }
  
  // 1. 提取有效坐标点
  const points = pois.map(p => {
    const props = p.properties || p;
    return {
      lat: props.lat || (p.geometry?.coordinates?.[1]),
      lon: props.lon || (p.geometry?.coordinates?.[0]),
      weight: props.weight || 1 // 可配置权重
    };
  }).filter(p => p.lat != null && p.lon != null);
  
  if (points.length === 0) {
    return { grids: [], maxDensity: 0, minDensity: 0 };
  }
  
  // 2. 映射到H3网格
  const gridMap = new Map();
  points.forEach(p => {
    try {
      const h3Index = h3.latLngToCell(p.lat, p.lon, resolution);
      if (!gridMap.has(h3Index)) {
        gridMap.set(h3Index, { count: 0, points: [] });
      }
      const cell = gridMap.get(h3Index);
      cell.count += p.weight;
      cell.points.push(p);
    } catch (e) {
      // 忽略无效坐标
    }
  });
  
  // 3. 计算每个网格的核密度
  // 使用H3网格中心点作为参考点
  const densityGrids = [];
  const h3Indices = Array.from(gridMap.keys());
  
  for (const h3Index of h3Indices) {
    const cellCenter = h3.cellToLatLng(h3Index);
    let density = 0;
    
    // 获取邻近网格（考虑带宽范围内的网格）
    // H3分辨率9时，每个网格边长约174米
    const gridSize = h3.getHexagonEdgeLengthAvg(resolution, 'm');
    const ringSize = Math.ceil(bandwidth / gridSize);
    const neighborIndices = h3.gridDisk(h3Index, Math.min(ringSize, 3));
    
    for (const neighborIdx of neighborIndices) {
      if (gridMap.has(neighborIdx)) {
        const neighborCell = gridMap.get(neighborIdx);
        const neighborCenter = h3.cellToLatLng(neighborIdx);
        
        // 计算网格中心距离
        const distance = haversineDistance(
          cellCenter[0], cellCenter[1],
          neighborCenter[0], neighborCenter[1]
        );
        
        // 应用核函数
        const kernelValue = kernel(distance, bandwidth);
        density += neighborCell.count * kernelValue;
      }
    }
    
    densityGrids.push({
      h3Index,
      lat: cellCenter[0],
      lon: cellCenter[1],
      density,
      rawCount: gridMap.get(h3Index).count
    });
  }
  
  // 4. 归一化密度值
  const densities = densityGrids.map(g => g.density);
  const maxDensity = Math.max(...densities);
  const minDensity = Math.min(...densities);
  
  densityGrids.forEach(g => {
    g.normalizedDensity = maxDensity > 0 ? (g.density - minDensity) / (maxDensity - minDensity) : 0;
  });
  
  // 5. 按密度排序
  densityGrids.sort((a, b) => b.density - a.density);
  
  return {
    grids: densityGrids,
    maxDensity,
    minDensity,
    bandwidth,
    resolution,
    totalPoints: points.length
  };
}

/**
 * DBSCAN聚类算法 - 基于H3网格的优化实现
 * 
 * 算法流程：
 * 1. 将POI点映射到H3网格
 * 2. 基于网格邻域关系进行聚类
 * 3. 识别核心点、边界点和噪声点
 * 
 * @param {Array} pois - POI点集
 * @param {Object} options - 配置选项
 * @returns {Object} 聚类结果
 */
export function dbscanClustering(pois, options = {}) {
  const eps = options.eps || DBSCAN_CONFIG.defaultEps; // 邻域半径（米）
  const minPoints = options.minPoints || DBSCAN_CONFIG.minPoints;
  const resolution = options.resolution || 9;
  
  if (!pois || pois.length === 0) {
    return { clusters: [], noise: [], stats: {} };
  }
  
  // 1. 提取有效坐标点
  const points = pois.map((p, idx) => {
    const props = p.properties || p;
    return {
      id: idx,
      lat: props.lat || (p.geometry?.coordinates?.[1]),
      lon: props.lon || (p.geometry?.coordinates?.[0]),
      original: p
    };
  }).filter(p => p.lat != null && p.lon != null);
  
  if (points.length === 0) {
    return { clusters: [], noise: [], stats: {} };
  }
  
  // 2. 映射到H3网格以加速邻域查询
  const gridMap = new Map();
  points.forEach(p => {
    try {
      const h3Index = h3.latLngToCell(p.lat, p.lon, resolution);
      if (!gridMap.has(h3Index)) {
        gridMap.set(h3Index, []);
      }
      gridMap.get(h3Index).push(p);
    } catch (e) {
      // 忽略无效坐标
    }
  });
  
  // 3. 构建邻接表
  const visited = new Set();
  const clustered = new Set();
  const clusters = [];
  const noise = [];
  
  // 获取点的邻域（基于H3网格快速查询）
  function getNeighbors(point) {
    const neighbors = [];
    const centerH3 = h3.latLngToCell(point.lat, point.lon, resolution);
    
    // 计算需要查询的网格环数
    const gridSize = h3.getHexagonEdgeLengthAvg(resolution, 'm');
    const ringSize = Math.ceil(eps / gridSize);
    
    // 查询邻近网格
    const neighborIndices = h3.gridDisk(centerH3, Math.min(ringSize, 3));
    
    for (const idx of neighborIndices) {
      if (gridMap.has(idx)) {
        for (const p of gridMap.get(idx)) {
          const distance = haversineDistance(
            point.lat, point.lon,
            p.lat, p.lon
          );
          if (distance <= eps) {
            neighbors.push(p);
          }
        }
      }
    }
    
    return neighbors;
  }
  
  // 4. DBSCAN主算法
  for (const point of points) {
    if (visited.has(point.id)) continue;
    visited.add(point.id);
    
    const neighbors = getNeighbors(point);
    
    if (neighbors.length < minPoints) {
      // 标记为噪声（可能后续被重新分类为边界点）
      noise.push(point);
    } else {
      // 创建新簇
      const cluster = {
        id: clusters.length,
        points: [point],
        center: null,
        boundary: null,
        density: 0
      };
      clustered.add(point.id);
      
      // 扩展簇
      const seeds = neighbors.filter(n => n.id !== point.id);
      for (let i = 0; i < seeds.length; i++) {
        const seed = seeds[i];
        
        if (!visited.has(seed.id)) {
          visited.add(seed.id);
          const seedNeighbors = getNeighbors(seed);
          
          if (seedNeighbors.length >= minPoints) {
            // 将新邻域点加入种子队列
            for (const sn of seedNeighbors) {
              if (!seeds.find(s => s.id === sn.id)) {
                seeds.push(sn);
              }
            }
          }
        }
        
        if (!clustered.has(seed.id)) {
          cluster.points.push(seed);
          clustered.add(seed.id);
          // 从噪声中移除（如果之前被标记为噪声）
          const noiseIdx = noise.findIndex(n => n.id === seed.id);
          if (noiseIdx >= 0) noise.splice(noiseIdx, 1);
        }
      }
      
      // 计算簇的中心和边界
      cluster.center = calculateCentroid(cluster.points);
      cluster.density = cluster.points.length;
      cluster.boundary = calculateClusterBoundary(cluster.points);
      
      clusters.push(cluster);
    }
  }
  
  // 5. 计算统计信息
  const stats = {
    totalPoints: points.length,
    clusterCount: clusters.length,
    noiseCount: noise.length,
    noiseRatio: points.length > 0 ? noise.length / points.length : 0,
    avgClusterSize: clusters.length > 0 ? 
      clusters.reduce((sum, c) => sum + c.points.length, 0) / clusters.length : 0,
    maxClusterSize: clusters.length > 0 ? 
      Math.max(...clusters.map(c => c.points.length)) : 0
  };
  
  return {
    clusters,
    noise,
    stats
  };
}

/**
 * 自然断点法(Jenks) - 确定最优分类阈值
 * 
 * 算法原理：最小化组内方差，最大化组间方差
 * 
 * @param {Array<number>} data - 数据数组
 * @param {number} numClasses - 分类数
 * @returns {Array<number>} 断点值数组
 */
export function jenksNaturalBreaks(data, numClasses = 5) {
  if (!data || data.length === 0) return [];
  if (data.length <= numClasses) return [...new Set(data)].sort((a, b) => a - b);
  
  // 排序数据
  const sorted = [...data].sort((a, b) => a - b);
  const n = sorted.length;
  
  // 初始化矩阵
  const matrices = {
    lowerClassLimits: Array(n + 1).fill(null).map(() => Array(numClasses + 1).fill(0)),
    varianceCombinations: Array(n + 1).fill(null).map(() => Array(numClasses + 1).fill(0))
  };
  
  // 初始化第一列
  for (let i = 1; i <= n; i++) {
    matrices.lowerClassLimits[i][1] = 1;
    matrices.varianceCombinations[i][1] = 0;
    
    for (let j = 2; j <= numClasses; j++) {
      matrices.varianceCombinations[i][j] = Infinity;
    }
  }
  
  // 计算方差和
  for (let l = 2; l <= n; l++) {
    let sum = 0;
    let sumSquares = 0;
    let w = 0;
    
    for (let m = 1; m <= l; m++) {
      const i3 = l - m + 1;
      const val = sorted[i3 - 1];
      
      w++;
      sum += val;
      sumSquares += val * val;
      
      const variance = sumSquares - (sum * sum) / w;
      const i4 = i3 - 1;
      
      if (i4 !== 0) {
        for (let j = 2; j <= numClasses; j++) {
          const vc = matrices.varianceCombinations[i4][j - 1] + variance;
          
          if (vc < matrices.varianceCombinations[l][j]) {
            matrices.lowerClassLimits[l][j] = i3;
            matrices.varianceCombinations[l][j] = vc;
          }
        }
      }
    }
  }
  
  // 提取断点
  const breaks = [];
  let k = sorted.length;
  
  for (let j = numClasses; j >= 1; j--) {
    const id = Math.floor((matrices.lowerClassLimits[k][j]) - 1);
    breaks[j - 1] = sorted[id];
    k = Math.floor(matrices.lowerClassLimits[k][j] - 1);
  }
  
  return breaks;
}

/**
 * 等值线提取 - 基于密度网格生成等值线
 * 
 * 简化实现：基于H3网格的密度分级
 * 
 * @param {Array} densityGrids - 密度网格数组
 * @param {Array} thresholds - 阈值数组
 * @returns {Array} 等值线多边形数组
 */
export function extractContourLines(densityGrids, thresholds) {
  if (!densityGrids || densityGrids.length === 0 || !thresholds || thresholds.length === 0) {
    return [];
  }
  
  const contours = [];
  
  // 对每个阈值提取等值线
  for (let i = 0; i < thresholds.length; i++) {
    const threshold = thresholds[i];
    const nextThreshold = thresholds[i + 1] || Infinity;
    
    // 筛选满足阈值的网格
    const levelGrids = densityGrids.filter(g => 
      g.density >= threshold && g.density < nextThreshold
    );
    
    if (levelGrids.length === 0) continue;
    
    // 使用H3的网格聚合来构建连通区域
    const h3Indices = levelGrids.map(g => g.h3Index);
    
    // 计算该等级的统计信息
    const totalDensity = levelGrids.reduce((sum, g) => sum + g.density, 0);
    const avgDensity = totalDensity / levelGrids.length;
    
    // 计算该等级的中心点
    const center = calculateCentroid(levelGrids.map(g => ({ lat: g.lat, lon: g.lon })));
    
    contours.push({
      level: i,
      threshold,
      nextThreshold,
      gridCount: levelGrids.length,
      avgDensity,
      center,
      h3Indices,
      grids: levelGrids
    });
  }
  
  return contours;
}

/**
 * 计算簇的边界（凸包）
 * @param {Array} points 
 */
function calculateClusterBoundary(points) {
  if (!points || points.length < 3) return null;
  
  // 使用简单的凸包算法
  const sorted = points.slice().sort((a, b) => {
    return a.lon === b.lon ? a.lat - b.lat : a.lon - b.lon;
  });
  
  const crossProduct = (o, a, b) => {
    return (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon);
  };
  
  const lower = [];
  for (let i = 0; i < sorted.length; i++) {
    while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], sorted[i]) <= 0) {
      lower.pop();
    }
    lower.push(sorted[i]);
  }
  
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0) {
      upper.pop();
    }
    upper.push(sorted[i]);
  }
  
  upper.pop();
  lower.pop();
  const hull = lower.concat(upper);
  
  // 转换为GeoJSON格式
  return hull.map(p => [p.lon, p.lat]);
}

/**
 * 计算质心
 * @param {Array} points 
 */
function calculateCentroid(points) {
  if (!points || points.length === 0) return null;
  
  let sumLon = 0;
  let sumLat = 0;
  
  for (const p of points) {
    sumLon += p.lon;
    sumLat += p.lat;
  }
  
  return {
    lon: sumLon / points.length,
    lat: sumLat / points.length
  };
}

/**
 * 识别商业热点区域
 * 
 * 综合使用KDE和DBSCAN来识别真正的商业热点
 * 
 * @param {Array} pois - POI点集
 * @param {Object} options - 配置选项
 * @returns {Object} 热点识别结果
 */
export function identifyHotspots(pois, options = {}) {
  // 1. 执行KDE分析
  const kdeResult = kernelDensityEstimation(pois, {
    bandwidth: options.bandwidth || 200,
    resolution: options.resolution || 9
  });
  
  // 2. 使用自然断点法确定密度等级
  const densities = kdeResult.grids.map(g => g.density);
  const breaks = jenksNaturalBreaks(densities, 5);
  
  // 3. 提取高密度区域（后两个等级）
  const highDensityThreshold = breaks[breaks.length - 2] || 0;
  const hotspotGrids = kdeResult.grids.filter(g => g.density >= highDensityThreshold);
  
  // 4. 对高密度区域进行DBSCAN聚类
  const hotspotPoints = hotspotGrids.map(g => ({
    properties: { lat: g.lat, lon: g.lon, density: g.density },
    geometry: { coordinates: [g.lon, g.lat] }
  }));
  
  const clusterResult = dbscanClustering(hotspotPoints, {
    eps: options.clusterEps || 300,
    minPoints: options.minPoints || 2,
    resolution: options.resolution || 9
  });
  
  // 5. 构建热点区域描述
  const hotspots = clusterResult.clusters.map(cluster => {
    // 获取该热点包含的原始POI
    const hotspotBoundary = cluster.boundary;
    
    // 计算POI类别分布
    const categoryDist = {};
    cluster.points.forEach(p => {
      const props = p.original?.properties || p.original || {};
      const cat = props['大类'] || props.category || '其他';
      categoryDist[cat] = (categoryDist[cat] || 0) + 1;
    });
    
    // 排序获取主导类别
    const dominantCategories = Object.entries(categoryDist)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cat, count]) => ({ category: cat, count }));
    
    return {
      id: cluster.id,
      center: cluster.center,
      boundary: hotspotBoundary,
      density: cluster.density,
      dominantCategories,
      poiCount: cluster.points.length,
      confidence: Math.min(cluster.density / 10, 1) // 简单置信度计算
    };
  });
  
  return {
    hotspots,
    kdeResult,
    clusterResult,
    densityBreaks: breaks,
    stats: {
      totalHotspots: hotspots.length,
      totalArea: hotspotGrids.length,
      avgHotspotDensity: hotspots.length > 0 ?
        hotspots.reduce((sum, h) => sum + h.density, 0) / hotspots.length : 0
    }
  };
}

/**
 * 生成语义模糊区域边界
 * 
 * 用于创建"广义商圈"、"科技园区"等非行政区划的vernacular region
 * 
 * @param {Array} pois - POI点集
 * @param {string} regionType - 区域类型描述（用于LLM语义聚类）
 * @param {Object} options - 配置选项
 * @returns {Object} 模糊区域边界
 */
export function generateVernacularRegion(pois, regionType, options = {}) {
  if (!pois || pois.length === 0) {
    return null;
  }
  
  // 1. 根据regionType筛选相关POI（简单关键词匹配）
  let relevantPois = pois;
  if (regionType) {
    const keywords = regionType.toLowerCase().split(/[\s,，]+/);
    relevantPois = pois.filter(p => {
      const props = p.properties || p;
      const text = `${props['名称'] || ''} ${props['大类'] || ''} ${props['中类'] || ''} ${props['小类'] || ''}`.toLowerCase();
      return keywords.some(kw => text.includes(kw));
    });
  }
  
  if (relevantPois.length === 0) {
    relevantPois = pois; // 如果没有匹配的，使用全部
  }
  
  // 2. 执行聚类分析
  const clusterResult = dbscanClustering(relevantPois, {
    eps: options.eps || 200,
    minPoints: options.minPoints || 3,
    resolution: options.resolution || 9
  });
  
  // 3. 对每个簇执行KDE分析，生成密度表面
  const regions = clusterResult.clusters.map(cluster => {
    // 对簇内点进行KDE
    const kde = kernelDensityEstimation(cluster.points.map(p => p.original || p), {
      bandwidth: options.bandwidth || 150,
      resolution: options.resolution || 9
    });
    
    // 确定密度阈值（使用自然断点法）
    const densities = kde.grids.map(g => g.density);
    const breaks = jenksNaturalBreaks(densities, 3);
    const contourThreshold = breaks[0] || 0;
    
    // 提取等值线
    const contours = extractContourLines(kde.grids, [contourThreshold]);
    
    // 生成模糊边界（使用凸包+缓冲）
    const boundary = cluster.boundary;
    
    return {
      id: cluster.id,
      type: regionType || 'general',
      center: cluster.center,
      boundary,
      density: cluster.density,
      confidence: Math.min(cluster.density / options.minPoints, 1),
      kde,
      contours
    };
  });
  
  return {
    regions,
    stats: {
      totalRegions: regions.length,
      totalPois: relevantPois.length,
      coverage: pois.length > 0 ? relevantPois.length / pois.length : 0
    }
  };
}

export default {
  kernelDensityEstimation,
  dbscanClustering,
  jenksNaturalBreaks,
  extractContourLines,
  identifyHotspots,
  generateVernacularRegion
};
