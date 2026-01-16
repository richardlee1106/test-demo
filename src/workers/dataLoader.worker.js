// Web Worker 用于从后端 API 加载 POI 数据
self.onmessage = async (e) => {
  const { categories, name, bounds, limit = 2000 } = e.data;

  try {
    const response = await fetch('/api/spatial/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categories: categories || [],
        bounds,
        limit
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Unknown error');
    }

    // 将结果传回主线程
    self.postMessage({
      success: true,
      name,
      features: data.features
    });
  } catch (error) {
    self.postMessage({
      success: false,
      name,
      error: error.message
    });
  }
};
