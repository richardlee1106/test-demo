/**
 * AI 服务模块 - 与本地 LM Studio 大模型通信
 * 
 * 使用 Qwen3-4B-Instruct 模型通过 OpenAI 兼容 API 进行对话
 * 支持流式响应和 POI 上下文注入
 * 
 * 智能按需传递：默认只传名称，位置问题时传坐标
 */

// API 配置管理
const AI_CONFIG = {
  activeProvider: 'local', // 默认为 local，checkAIService 会自动更新此值
  
  local: {
    id: 'local',
    name: 'Local LM Studio',
    apiBase: '/api/ai',
    modelId: 'qwen3-4b-instruct-2507',
    apiKey: 'lm-studio', // 本地不需要但保留占位
    authHeader: 'Authorization', // 标准 Bearer token
    useBearer: true
  },
  
  mimo: {
    id: 'mimo',
    name: 'Xiaomi MiMo',
    apiBase: '/api/mimo/v1', // 使用 Vite 代理避免 CORS
    modelId: 'mimo-v2-flash',
    apiKey: 'sk-c0wrz156imm4hlryw75p03ecnqsvmpu4mahnh5zbbafcurjq',
    authHeader: 'api-key', // MiMo 使用 api-key 头
    useBearer: false
  }
};

/**
 * 获取当前激活的服务商配置
 */
function getActiveConfig() {
  return AI_CONFIG[AI_CONFIG.activeProvider];
}

// 位置相关关键词
const LOCATION_KEYWORDS = [
  '距离', '最近', '附近', '周边', '临近', '相邻', '多远', '位置', '坐标',
  '公里', '米', '东', '西', '南', '北', '方向', '路线', '到达',
  '哪里', '在哪', '地址', '经纬度', '空间', '分布位置'
];

/**
 * 检测用户问题是否涉及位置/距离
 * @param {string} userMessage - 用户消息
 * @returns {boolean}
 */
export function isLocationRelatedQuery(userMessage) {
  if (!userMessage) return false;
  return LOCATION_KEYWORDS.some(keyword => userMessage.includes(keyword));
}

/**
 * 根据名称查找 POI（支持模糊匹配）
 * @param {Array} features - POI 数组
 * @param {string} name - 要查找的名称
 * @returns {Object|null}
 */
export function findPOIByName(features, name) {
  if (!features || !name) return null;
  
  // 精确匹配
  let found = features.find(f => {
    const poiName = f.properties?.['名称'] || f.properties?.name || '';
    return poiName === name;
  });
  
  // 模糊匹配
  if (!found) {
    found = features.find(f => {
      const poiName = f.properties?.['名称'] || f.properties?.name || '';
      return poiName.includes(name) || name.includes(poiName);
    });
  }
  
  return found;
}

/**
 * 计算两点间距离（Haversine 公式）
 * @param {Array} coord1 - [lon, lat]
 * @param {Array} coord2 - [lon, lat]
 * @returns {number} 距离（米）
 */
export function calculateDistance(coord1, coord2) {
  const R = 6371000; // 地球半径（米）
  const lat1 = coord1[1] * Math.PI / 180;
  const lat2 = coord2[1] * Math.PI / 180;
  const dLat = (coord2[1] - coord1[1]) * Math.PI / 180;
  const dLon = (coord2[0] - coord1[0]) * Math.PI / 180;
  
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  
  return R * c;
}

/**
 * 格式化 POI 数据 - 精简版（只有名称和类别）
 * @param {Array} features - GeoJSON Feature 数组
 * @returns {string}
 */
export function formatPOIContextLite(features) {
  if (!features || features.length === 0) {
    return '当前没有选中任何 POI 数据。';
  }

  // 统计类别分布
  const categoryCount = {};
  const poiNames = [];

  features.forEach(f => {
    const props = f.properties || {};
    const name = props['名称'] || props.name || props.Name || '未命名';
    const category = props['大类'] || props['类别'] || props.category || '未分类';
    
    categoryCount[category] = (categoryCount[category] || 0) + 1;
    poiNames.push(name);
  });

  let summary = `📍 **当前选中区域 POI 统计**\n`;
  summary += `- 总数量: ${features.length} 个\n`;
  summary += `- 类别分布:\n`;

  Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => {
      summary += `  · ${cat}: ${count} 个 (${(count / features.length * 100).toFixed(1)}%)\n`;
    });

  summary += `\n**POI 名称列表**:\n`;
  summary += poiNames.join('、');

  return summary;
}

/**
 * 格式化 POI 数据 - 完整版（包含坐标，用于位置问题）
 * @param {Array} features - GeoJSON Feature 数组
 * @param {string} userMessage - 用户消息（用于提取目标 POI）
 * @returns {string}
 */
export function formatPOIContextFull(features, userMessage) {
  if (!features || features.length === 0) {
    return '当前没有选中任何 POI 数据。';
  }

  // 尝试从用户消息中提取目标 POI 名称
  let targetPOI = null;
  let targetCoord = null;
  
  // 简单的名称提取：查找用户消息中包含的 POI 名称
  for (const f of features) {
    const name = f.properties?.['名称'] || f.properties?.name || '';
    if (name && userMessage.includes(name)) {
      targetPOI = name;
      targetCoord = f.geometry?.coordinates;
      break;
    }
  }

  // 生成带坐标的 POI 列表
  let summary = `📍 **POI 位置数据** (共 ${features.length} 个)\n\n`;
  
  // 如果找到目标 POI，计算距离并排序
  if (targetPOI && targetCoord) {
    summary += `🎯 **目标 POI**: ${targetPOI}\n`;
    summary += `📌 坐标: [${targetCoord[0].toFixed(6)}, ${targetCoord[1].toFixed(6)}]\n\n`;
    
    // 计算所有 POI 到目标的距离
    const poisWithDistance = features
      .filter(f => {
        const name = f.properties?.['名称'] || f.properties?.name || '';
        return name !== targetPOI && f.geometry?.coordinates;
      })
      .map(f => {
        const name = f.properties?.['名称'] || f.properties?.name || '未命名';
        const category = f.properties?.['大类'] || '未分类';
        const coord = f.geometry.coordinates;
        const distance = calculateDistance(targetCoord, coord);
        return { name, category, coord, distance };
      })
      .sort((a, b) => a.distance - b.distance);

    summary += `**按距离排序的 POI 列表**:\n`;
    poisWithDistance.slice(0, 30).forEach((poi, i) => {
      const distStr = poi.distance < 1000 
        ? `${poi.distance.toFixed(0)}米`
        : `${(poi.distance/1000).toFixed(2)}公里`;
      summary += `${i+1}. ${poi.name} [${poi.category}] - 距离: ${distStr}\n`;
    });
    
    if (poisWithDistance.length > 30) {
      summary += `... 还有 ${poisWithDistance.length - 30} 个 POI\n`;
    }
  } else {
    // 没有找到目标，输出所有 POI 的坐标
    summary += `**POI 坐标列表** (前50个):\n`;
    features.slice(0, 50).forEach((f, i) => {
      const name = f.properties?.['名称'] || f.properties?.name || '未命名';
      const category = f.properties?.['大类'] || '未分类';
      const coord = f.geometry?.coordinates;
      if (coord) {
        summary += `${i+1}. ${name} [${category}] - [${coord[0].toFixed(6)}, ${coord[1].toFixed(6)}]\n`;
      } else {
        summary += `${i+1}. ${name} [${category}] - 坐标缺失\n`;
      }
    });
  }

  return summary;
}

/**
 * 智能格式化 POI 上下文（根据用户问题选择精简或完整版）
 * @param {Array} features - GeoJSON Feature 数组
 * @param {string} userMessage - 用户消息
 * @returns {string}
 */
export function formatPOIContext(features, userMessage = '') {
  if (isLocationRelatedQuery(userMessage)) {
    return formatPOIContextFull(features, userMessage);
  }
  return formatPOIContextLite(features);
}

/**
 * 构建系统提示词
 * @param {string} poiContext - POI 上下文信息
 * @param {boolean} isLocationQuery - 是否为位置相关查询
 * @returns {string}
 */
export function buildSystemPrompt(poiContext, isLocationQuery = false) {
  let prompt = `你是一个专业的地理信息分析助手，专注于分析城市兴趣点（POI）数据。

## 你的能力
1. 分析用户选中区域内的 POI 分布特征
2. 提供商业选址、城市规划方面的建议
3. 解读地理空间模式和热点区域
4. 回答关于特定 POI 的问题`;

  if (isLocationQuery) {
    prompt += `
5. 计算 POI 之间的距离关系
6. 查找指定 POI 附近的其他 POI`;
  }

  prompt += `

## 当前数据上下文
${poiContext}

## 回答要求
- 使用中文回答
- 基于提供的 POI 数据进行分析
- 如果用户询问的内容超出数据范围，请诚实说明
- 回答要简洁专业，适当使用 Markdown 格式
- 禁止输出任何思考过程，直接给出答案`;

  if (isLocationQuery) {
    prompt += `
- 距离数据已预先计算，直接使用列表中的距离信息
- 回答位置问题时引用具体的距离数值`;
  }

  return prompt;
}

/**
 * 发送聊天请求（非流式）
 * @param {Array} messages - 消息历史 [{role, content}, ...]
 * @param {Object} options - 可选配置
 * @returns {Promise<string>} AI 回复内容
 */
export async function sendChatMessage(messages, options = {}) {
  const config = getActiveConfig();
  
  // 根据服务商构建认证头
  const headers = {
    'Content-Type': 'application/json'
  };
  if (config.useBearer) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  } else {
    headers[config.authHeader] = config.apiKey;
  }

  // 根据服务商构建请求体
  const body = {
    model: config.modelId,
    messages,
    temperature: options.temperature ?? 0.7,
    stream: false
  };

  if (config.id === 'mimo') {
    body.max_completion_tokens = options.maxTokens ?? 2048;
    body.thinking = { type: 'disabled' };
    body.top_p = 0.95;
  } else {
    body.max_tokens = options.maxTokens ?? 2048;
  }

  const response = await fetch(`${config.apiBase}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AI 请求失败: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * 发送聊天请求（流式）
 * @param {Array} messages - 消息历史
 * @param {Function} onChunk - 每次收到新内容时的回调 (text: string) => void
 * @param {Object} options - 可选配置
 * @returns {Promise<string>} 完整的 AI 回复
 */
export async function sendChatMessageStream(messages, onChunk, options = {}) {
  const config = getActiveConfig();
  console.log(`[AI] 使用服务商: ${config.name} (Model: ${config.modelId})`);

  // 根据服务商构建认证头
  const headers = {
    'Content-Type': 'application/json'
  };
  if (config.useBearer) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  } else {
    headers[config.authHeader] = config.apiKey;
  }

  // 根据服务商构建请求体
  const body = {
    model: config.modelId,
    messages,
    temperature: options.temperature ?? 0.7,
    stream: true
  };

  // 不同服务商的参数差异
  if (config.id === 'mimo') {
    body.max_completion_tokens = options.maxTokens ?? 2048;
    body.thinking = { type: 'disabled' };
    body.top_p = 0.95;
  } else {
    body.max_tokens = options.maxTokens ?? 2048;
  }

  const response = await fetch(`${config.apiBase}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AI 请求失败: ${response.status} - ${error}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullContent += delta;
            onChunk(delta);
          }
        } catch (e) {
          // 忽略解析错误（可能是不完整的 JSON）
        }
      }
    }
  }

  // 过滤 Qwen3 的思考标签内容
  fullContent = fullContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  
  return fullContent;
}

/**
 * 语义搜索 - 利用大模型进行 NLP 级别的 POI 筛选
 * @param {string} keyword - 用户搜索关键词（如 "奶茶"、"火锅"）
 * @param {Array} features - 所有 POI 的 GeoJSON Feature 数组
 * @param {Object} options - 可选配置
 * @returns {Promise<Array>} 语义相关的 POI 数组
 */
export async function semanticSearch(keyword, features, options = {}) {
  if (!keyword || !keyword.trim() || !features || features.length === 0) {
    return [];
  }

  const kw = keyword.trim();
  
  // 提取所有 POI 名称
  const poiNames = features.map(f => {
    return f?.properties?.['名称'] ?? f?.properties?.name ?? f?.properties?.Name ?? '';
  }).filter(name => name); // 过滤空名称

  // 如果 POI 数量过多，分批处理（每批最多 200 个，避免 token 限制）
  const BATCH_SIZE = 200;
  const batches = [];
  for (let i = 0; i < poiNames.length; i += BATCH_SIZE) {
    batches.push(poiNames.slice(i, i + BATCH_SIZE));
  }

  console.log(`[AI Search] 关键词: "${kw}", 共 ${poiNames.length} 个 POI, 分 ${batches.length} 批处理`);

  // 收集所有匹配的名称
  const matchedNames = new Set();

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    
    // 构建 Prompt
    const prompt = `你是一个 POI（兴趣点）语义分析专家。

## 任务
用户搜索关键词：「${kw}」

以下是 POI 名称列表：
${batch.join('、')}

## 要求
1. 分析每个 POI 名称，判断其是否与搜索关键词「${kw}」语义相关
2. 语义相关包括：
   - 直接包含关键词
   - 属于该类别的品牌（如搜索"奶茶"，"一点点"、"沪上阿姨"、"蜜雪冰城"都相关）
   - 属于该类别的同义词或近义词
3. 仅返回相关的 POI 名称，用「|」分隔
4. 如果没有任何相关的 POI，返回「无」
5. 禁止输出任何解释、思考过程或额外文字，直接返回结果

## 示例
搜索"火锅"的相关 POI：海底捞|呷哺呷哺|小龙坎|捞王`;

    try {
      const messages = [
        { role: 'user', content: prompt }
      ];

      const response = await sendChatMessage(messages, {
        temperature: 0.3, // 降低随机性，保证结果稳定
        maxTokens: 1024
      });

      // 解析 AI 返回的结果
      const result = response.trim();
      if (result && result !== '无') {
        // 按 | 分割并添加到匹配集合
        result.split('|').forEach(name => {
          const trimmed = name.trim();
          if (trimmed && trimmed !== '无') {
            matchedNames.add(trimmed);
          }
        });
      }

      console.log(`[AI Search] 批次 ${batchIndex + 1}/${batches.length} 完成，当前匹配 ${matchedNames.size} 个`);
    } catch (error) {
      console.error(`[AI Search] 批次 ${batchIndex + 1} 失败:`, error);
      // 继续处理其他批次
    }
  }

  // 根据匹配的名称过滤原始 features
  const matchedFeatures = features.filter(f => {
    const name = f?.properties?.['名称'] ?? f?.properties?.name ?? f?.properties?.Name ?? '';
    return matchedNames.has(name);
  });

  console.log(`[AI Search] 最终匹配 ${matchedFeatures.length} 个 POI`);
  return matchedFeatures;
}

/**
 * 检查 AI 服务可用性并自动选择最佳服务商
 * 策略：优先检测 Local，若通则使用 Local；否则切换到 MiMo
 * @returns {Promise<boolean>}
 */
export async function checkAIService() {
  try {
    // 1. 尝试检测 Local LM Studio
    console.log('[AI] 正在检测本地 LM Studio...');
    const localResp = await fetch(`${AI_CONFIG.local.apiBase}/models`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (localResp.ok) {
      console.log('[AI] 本地服务在线，切换至 Local 模式');
      AI_CONFIG.activeProvider = 'local';
      return true;
    }
  } catch (e) {
    console.log('[AI] 本地服务不可用:', e.message);
  }

  // 2. 本地不可用，切换到 MiMo (假定云服务通过代理可达)
  console.log('[AI] 本地服务离线，切换至 Xiaomi MiMo 模式');
  AI_CONFIG.activeProvider = 'mimo';
  
  // 可以在这里简单验证一下 Key 是否有效 (可选)
  return true;
}

/**
 * 获取当前服务商信息
 */
export function getCurrentProviderInfo() {
  return getActiveConfig();
}

/**
 * 获取可用模型列表 (仅针对当前激活的服务商)
 * @returns {Promise<Array>}
 */
export async function getAvailableModels() {
  const config = getActiveConfig();
  try {
    const response = await fetch(`${config.apiBase}/models`, {
      headers: { 'Authorization': `Bearer ${config.apiKey}` }
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.data || [];
  } catch {
    return [];
  }
}
