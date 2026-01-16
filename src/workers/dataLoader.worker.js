// Web Worker 用于异步加载和解析 GeoJSON 数据
self.onmessage = async (e) => {
  const { url, urls, name } = e.data;
  // 支持单个 url 或 url 数组
  const targetUrls = urls || (url ? [url] : []);

  try {
    // 并发请求所有 URL
    const promises = targetUrls.map(async (u) => {
      const response = await fetch(u);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} for url: ${u}`);
      }
      return response.json();
    });

    const results = await Promise.all(promises);
    
    // 合并所有 features
    const allFeatures = results.flatMap(data => data.features || []);
    
    // 根据 poiid 去重（同一个 POI 可能出现在多个分类文件中）
    const seenIds = new Set();
    const uniqueFeatures = allFeatures.filter(feature => {
      const poiid = feature.properties?.poiid;
      if (!poiid || seenIds.has(poiid)) {
        return false;
      }
      seenIds.add(poiid);
      return true;
    });

    // 将结果传回主线程
    self.postMessage({
      success: true,
      name,
      features: uniqueFeatures
    });
  } catch (error) {
    self.postMessage({
      success: false,
      name,
      error: error.message
    });
  }
};
