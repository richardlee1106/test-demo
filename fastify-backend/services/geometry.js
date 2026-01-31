/**
 * 几何计算服务 (轻量级)
 * 提供凸包计算、中心点计算等基础几何功能
 */

/**
 * 计算一组点的凸包 (Monotone Chain Algorithm)
 * @param {Array<{lat: number, lon: number}>} points - 点集
 * @returns {Array<{lat: number, lon: number}>} 构成凸包的点集（顺时针或逆时针）
 */
export function calculateConvexHull(points) {
  if (!points || points.length < 3) return points;

  // 1. 按照 x (lon) 排序，如果 x 相同则按 y (lat) 排序
  const sorted = points.slice().sort((a, b) => {
    return a.lon === b.lon ? a.lat - b.lat : a.lon - b.lon;
  });

  const crossProduct = (o, a, b) => {
    return (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon);
  };

  // 2. 构建下凸包
  const lower = [];
  for (let i = 0; i < sorted.length; i++) {
    while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], sorted[i]) <= 0) {
      lower.pop();
    }
    lower.push(sorted[i]);
  }

  // 3. 构建上凸包
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0) {
      upper.pop();
    }
    upper.push(sorted[i]);
  }

  // 4. 合并 (移除重复的起始/终止点)
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/**
 * 将凸包点集转换为 GeoJSON Polygon 格式
 * @param {Array<{lat: number, lon: number}>} hullPoints 
 * @returns {Array<Array<number>>} [[lon, lat], [lon, lat], ...] 首尾闭合
 */
export function hullToGeoJSONRing(hullPoints) {
  if (!hullPoints || hullPoints.length === 0) return [];
  
  const ring = hullPoints.map(p => [p.lon, p.lat]);
  
  // 确保首尾闭合
  if (ring.length > 0) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push(first);
    }
  }
  
  return ring;
}

/**
 * 计算一组点的几何中心 (Centroid)
 * @param {Array<{lat: number, lon: number}>} points 
 */
export function calculateCentroid(points) {
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

export default {
    calculateConvexHull,
    hullToGeoJSONRing,
    calculateCentroid
}
