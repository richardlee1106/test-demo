/**
 * AI 服务模块 - 与本地 LM Studio 大模型通信
 * 
 * 使用 Qwen3-4B-Instruct 模型通过 OpenAI 兼容 API 进行对话
 * 支持流式响应和 POI 上下文注入
 * 
 * 智能按需传递：默认只传名称，位置问题时传坐标
 */

// API 配置
const API_BASE = '/api/ai'; // 通过 Vite 代理转发
const MODEL_ID = 'qwen3-4b-instruct-2507';

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
  const response = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL_ID,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
      stream: false,
    }),
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
  const response = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL_ID,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
      stream: true,
      // Qwen3 特定参数：禁用思考模式
      chat_template_kwargs: { enable_thinking: false },
    }),
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
 * 检查 AI 服务是否可用
 * @returns {Promise<boolean>}
 */
export async function checkAIService() {
  try {
    const response = await fetch(`${API_BASE}/models`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 获取可用模型列表
 * @returns {Promise<Array>}
 */
export async function getAvailableModels() {
  try {
    const response = await fetch(`${API_BASE}/models`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.data || [];
  } catch {
    return [];
  }
}
