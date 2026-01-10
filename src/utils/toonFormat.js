/**
 * TOON (Token-Optimized Object Notation) 格式转换工具
 * 
 * 设计目标：
 * - 为了节省 LLM Token，将 GeoJSON 转换为极简的文本格式
 * - 专门用于地理位置相关的 AI 问答场景
 * - 支持双向转换：GeoJSON ↔ TOON
 * 
 * TOON 格式规范：
 * - 每行代表一个 POI，使用 | 分隔字段
 * - 字段顺序固定：id|name|category|subcategory|lon|lat
 * - 坐标精度：6位小数（约0.1米精度）
 * - 特殊字符转义：| → \\|
 * 
 * 示例：
 * 1|星巴克咖啡|餐饮美食|咖啡厅|114.305539|30.593098
 * 2|全家便利店|购物消费|便利店|114.306123|30.592456
 */

/**
 * 转义 TOON 分隔符
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的字符串
 */
function escapeTOON(str) {
  if (!str) return '';
  return String(str).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * 反转义 TOON 分隔符
 * @param {string} str - 转义后的字符串
 * @returns {string} 原始字符串
 */
function unescapeTOON(str) {
  if (!str) return '';
  return str.replace(/\\\|/g, '|');
}

/**
 * 将 GeoJSON Feature 数组转换为 TOON 格式
 * @param {Array} features - GeoJSON Feature 数组
 * @param {Object} options - 配置选项
 * @param {boolean} options.includeCoords - 是否包含坐标（默认 true）
 * @param {boolean} options.includeId - 是否包含序号（默认 true）
 * @param {number} options.limit - 最大条目数（默认不限制）
 * @returns {string} TOON 格式字符串
 */
export function geoJSONToTOON(features, options = {}) {
  const {
    includeCoords = true,
    includeId = true,
    limit = 0
  } = options;

  if (!features || features.length === 0) {
    return '';
  }

  const items = limit > 0 ? features.slice(0, limit) : features;
  
  // 生成头部（可选，帮助 LLM 理解格式）
  let header = '';
  if (includeId && includeCoords) {
    header = '#序号|名称|大类|中类|经度|纬度\n';
  } else if (includeId) {
    header = '#序号|名称|大类|中类\n';
  } else if (includeCoords) {
    header = '#名称|大类|中类|经度|纬度\n';
  } else {
    header = '#名称|大类|中类\n';
  }

  const lines = items.map((f, idx) => {
    const props = f.properties || {};
    const name = escapeTOON(props['名称'] || props.name || '');
    const category = escapeTOON(props['大类'] || props.category || '');
    const subcategory = escapeTOON(props['中类'] || props.subcategory || '');
    
    const parts = [];
    if (includeId) parts.push(idx + 1);
    parts.push(name, category, subcategory);
    
    if (includeCoords && f.geometry?.coordinates) {
      const [lon, lat] = f.geometry.coordinates;
      parts.push(lon.toFixed(6), lat.toFixed(6));
    }
    
    return parts.join('|');
  });

  return header + lines.join('\n');
}

/**
 * 将 TOON 格式字符串解析为结构化数据
 * 用于解析 LLM 返回的 TOON 格式结果
 * @param {string} toonStr - TOON 格式字符串
 * @returns {Array} 解析后的对象数组
 */
export function parseTOON(toonStr) {
  if (!toonStr) return [];
  
  const lines = toonStr.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  
  return lines.map(line => {
    // 处理转义字符：先将 \| 替换为占位符
    const placeholder = '\x00';
    const safeLine = line.replace(/\\\|/g, placeholder);
    const parts = safeLine.split('|').map(p => p.replace(new RegExp(placeholder, 'g'), '|'));
    
    // 根据字段数量判断格式
    if (parts.length >= 6) {
      // 完整格式：id|name|category|subcategory|lon|lat
      return {
        id: parseInt(parts[0]) || 0,
        name: parts[1],
        category: parts[2],
        subcategory: parts[3],
        coordinates: [parseFloat(parts[4]), parseFloat(parts[5])]
      };
    } else if (parts.length >= 4) {
      // 带序号无坐标：id|name|category|subcategory
      return {
        id: parseInt(parts[0]) || 0,
        name: parts[1],
        category: parts[2],
        subcategory: parts[3],
        coordinates: null
      };
    } else if (parts.length >= 3) {
      // 无序号无坐标：name|category|subcategory
      return {
        id: 0,
        name: parts[0],
        category: parts[1],
        subcategory: parts[2],
        coordinates: null
      };
    }
    
    return null;
  }).filter(Boolean);
}

/**
 * 将解析后的 TOON 数据转换回 GeoJSON Features
 * @param {Array} toonData - parseTOON 返回的数据
 * @returns {Array} GeoJSON Feature 数组
 */
export function toonToGeoJSON(toonData) {
  return toonData.map(item => ({
    type: 'Feature',
    geometry: item.coordinates ? {
      type: 'Point',
      coordinates: item.coordinates
    } : null,
    properties: {
      '名称': item.name,
      '大类': item.category,
      '中类': item.subcategory
    }
  }));
}

/**
 * 计算 TOON 格式相比 GeoJSON 的压缩率
 * @param {Array} features - GeoJSON Feature 数组
 * @returns {Object} 压缩统计信息
 */
export function calculateCompressionRatio(features) {
  if (!features || features.length === 0) {
    return { geoJSONSize: 0, toonSize: 0, ratio: 0 };
  }
  
  const geoJSONStr = JSON.stringify(features);
  const toonStr = geoJSONToTOON(features);
  
  return {
    geoJSONSize: geoJSONStr.length,
    toonSize: toonStr.length,
    ratio: ((1 - toonStr.length / geoJSONStr.length) * 100).toFixed(1) + '%',
    estimatedTokensSaved: Math.floor((geoJSONStr.length - toonStr.length) / 4) // 粗略估计
  };
}

/**
 * 构建包含 TOON 数据的 AI Prompt
 * @param {Array} features - GeoJSON Feature 数组
 * @param {string} userQuery - 用户问题
 * @param {Object} options - 可选配置
 * @returns {string} 完整的 prompt
 */
export function buildTOONPrompt(features, userQuery, options = {}) {
  const { includeCoords = true, limit = 200 } = options;
  
  const toonData = geoJSONToTOON(features, { includeCoords, limit });
  
  return `## POI 数据（TOON 格式）
以下是当前选中区域的 POI 数据，采用 TOON（Token-Optimized Object Notation）格式：
- 每行一个 POI，字段用 | 分隔
- 格式：${includeCoords ? '序号|名称|大类|中类|经度|纬度' : '序号|名称|大类|中类'}

${toonData}

## 用户问题
${userQuery}

## 回答要求
- 如果需要返回 POI 列表，请使用相同的 TOON 格式
- 直接回答问题，不要输出思考过程`;
}

/**
 * 从 AI 响应中提取 TOON 格式数据
 * @param {string} aiResponse - AI 的回复内容
 * @returns {Array|null} 如果响应中包含 TOON 数据则返回解析结果，否则返回 null
 */
export function extractTOONFromResponse(aiResponse) {
  if (!aiResponse) return null;
  
  // 尝试查找 TOON 格式的数据块
  // 特征：多行，每行包含 | 分隔符，可能以 # 开头的注释行
  const lines = aiResponse.split('\n');
  const toonLines = [];
  let inToonBlock = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // 检测是否进入 TOON 数据块
    if (trimmed.includes('|') && (trimmed.match(/\|/g) || []).length >= 2) {
      inToonBlock = true;
      if (!trimmed.startsWith('#')) {
        toonLines.push(trimmed);
      }
    } else if (inToonBlock && trimmed === '') {
      // 空行可能表示数据块结束
      continue;
    } else if (inToonBlock && !trimmed.includes('|')) {
      // 非 TOON 格式行，数据块结束
      break;
    }
  }
  
  if (toonLines.length === 0) return null;
  
  return parseTOON(toonLines.join('\n'));
}

// 默认导出
export default {
  geoJSONToTOON,
  parseTOON,
  toonToGeoJSON,
  calculateCompressionRatio,
  buildTOONPrompt,
  extractTOONFromResponse
};
