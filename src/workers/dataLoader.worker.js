// Web Worker 用于异步加载和解析 GeoJSON 数据
self.onmessage = async (e) => {
  const { url, name } = e.data;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    const features = data.features || [];

    // 将结果传回主线程
    // 这里的 parsing 和遍历都在 worker 线程完成，不会阻塞 UI
    self.postMessage({
      success: true,
      name,
      features
    });
  } catch (error) {
    self.postMessage({
      success: false,
      name,
      error: error.message
    });
  }
};
