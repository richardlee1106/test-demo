import { initDatabase } from './database.js';

/**
 * 调用 LLM (通用)
 */
export async function callLLM(prompt, options = {}) {
  const baseUrl = process.env.LLM_BASE_URL || 'http://localhost:1234/v1';
  const model = process.env.LLM_MODEL || 'qwen3-4b-instruct-2507';
  
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature || 0.3,
        stream: options.stream || false
      }),
    });
    
    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }
    
    return await response.json();
  } catch (err) {
    console.warn('[AI Service] Local/Primary LLM failed, trying GLM fallback...', err.message);
    
    // Fallback to Zhipu GLM if API Key is present
    if (process.env.GLM_API_KEY) {
      try {
        const glmResponse = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.GLM_API_KEY}`
          },
          body: JSON.stringify({
            model: 'glm-4',
            messages: [{ role: 'user', content: prompt }],
            temperature: options.temperature || 0.3
          })
        });
        
        if (!glmResponse.ok) throw new Error(`GLM API error: ${glmResponse.status}`);
        return await glmResponse.json();
      } catch (glmErr) {
        console.error('[AI Service] GLM fallback also failed:', glmErr.message);
        throw err; // Throw original error if both fail
      }
    }
    
    throw err;
  }
}

/**
 * 语义搜索逻辑 (集成向量检索与空间过滤)
 * 这里是一个简化的版本，如果本地没有 Milvus，退回到文本搜索
 */
export async function performSpatialRAG(query, options = {}) {
  // 1. 初始化数据库
  await initDatabase();
  
  // 2. 意图解析 (TODO: 实现完整的 prompt 逻辑)
  // 目前先使用简单的关键字搜索 fallback
  const terms = query.split(/\s+/);
  
  // 3. 执行搜索 (调用 database.js 中的 findPOIsFiltered)
  // ...
  return { success: true, results: [] };
}
