/**
 * AI 服务工具函数
 */

// 位置相关关键词
const LOCATION_KEYWORDS = [
  '距离', '最近', '附近', '周边', '临近', '相邻', '多远', '位置', '坐标',
  '公里', '米', '东', '西', '南', '北', '方向', '路线', '到达',
  '哪里', '在哪', '地址', '经纬度', '空间', '分布位置'
]

/**
 * 判断是否为位置相关查询
 */
function isLocationRelatedQuery(userMessage) {
  if (!userMessage) return false
  return LOCATION_KEYWORDS.some(keyword => userMessage.includes(keyword))
}

/**
 * 计算两点间距离（米）
 */
function calculateDistance(coord1, coord2) {
  const R = 6371000
  const lat1 = coord1[1] * Math.PI / 180
  const lat2 = coord2[1] * Math.PI / 180
  const dLat = (coord2[1] - coord1[1]) * Math.PI / 180
  const dLon = (coord2[0] - coord1[0]) * Math.PI / 180
  
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  
  return R * c
}

/**
 * 格式化 POI 上下文（精简版）
 */
function formatPOIContextLite(features) {
  if (!features || features.length === 0) {
    return '当前没有选中任何 POI 数据。'
  }

  const categoryCount = {}
  const poiNames = []

  features.forEach(f => {
    const props = f.properties || {}
    const name = props['名称'] || props.name || props.Name || '未命名'
    const category = props['大类'] || props['类别'] || props.category || '未分类'
    
    categoryCount[category] = (categoryCount[category] || 0) + 1
    poiNames.push(name)
  })

  let summary = `📍 **当前选中区域 POI 统计**\n`
  summary += `- 总数量: ${features.length} 个\n`
  summary += `- 类别分布:\n`

  Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => {
      summary += `  · ${cat}: ${count} 个 (${(count / features.length * 100).toFixed(1)}%)\n`
    })

  summary += `\n**POI 名称列表**:\n`
  summary += poiNames.join('、')

  return summary
}

/**
 * 格式化 POI 上下文（完整版，含坐标）
 */
function formatPOIContextFull(features, userMessage) {
  if (!features || features.length === 0) {
    return '当前没有选中任何 POI 数据。'
  }

  let targetPOI = null
  let targetCoord = null
  
  for (const f of features) {
    const name = f.properties?.['名称'] || f.properties?.name || ''
    if (name && userMessage.includes(name)) {
      targetPOI = name
      targetCoord = f.geometry?.coordinates
      break
    }
  }

  let summary = `📍 **POI 位置数据** (共 ${features.length} 个)\n\n`
  
  if (targetPOI && targetCoord) {
    summary += `🎯 **目标 POI**: ${targetPOI}\n`
    summary += `📌 坐标: [${targetCoord[0].toFixed(6)}, ${targetCoord[1].toFixed(6)}]\n\n`
    
    const poisWithDistance = features
      .filter(f => {
        const name = f.properties?.['名称'] || f.properties?.name || ''
        return name !== targetPOI && f.geometry?.coordinates
      })
      .map(f => {
        const name = f.properties?.['名称'] || f.properties?.name || '未命名'
        const category = f.properties?.['大类'] || '未分类'
        const coord = f.geometry.coordinates
        const distance = calculateDistance(targetCoord, coord)
        return { name, category, coord, distance }
      })
      .sort((a, b) => a.distance - b.distance)

    summary += `**按距离排序的 POI 列表**:\n`
    poisWithDistance.slice(0, 30).forEach((poi, i) => {
      const distStr = poi.distance < 1000 
        ? `${poi.distance.toFixed(0)}米`
        : `${(poi.distance/1000).toFixed(2)}公里`
      summary += `${i+1}. ${poi.name} [${poi.category}] - 距离: ${distStr}\n`
    })
  } else {
    summary += `**POI 坐标列表** (前50个):\n`
    features.slice(0, 50).forEach((f, i) => {
      const name = f.properties?.['名称'] || f.properties?.name || '未命名'
      const category = f.properties?.['大类'] || '未分类'
      const coord = f.geometry?.coordinates
      if (coord) {
        summary += `${i+1}. ${name} [${category}] - [${coord[0].toFixed(6)}, ${coord[1].toFixed(6)}]\n`
      }
    })
  }

  return summary
}

/**
 * 格式化 POI 上下文（自动选择版本）
 */
function formatPOIContext(features, userMessage = '') {
  if (isLocationRelatedQuery(userMessage)) {
    return formatPOIContextFull(features, userMessage)
  }
  return formatPOIContextLite(features)
}

/**
 * 构建系统提示词
 */
function buildSystemPrompt(poiContext, isLocationQuery = false) {
  let prompt = `你是一个名为「标签云 AI 助手」的专业地理信息分析专家。

## 你的身份限制
1. **你是谁**：你是「标签云（TagCloud）」系统的内置 AI 助手。
2. **你的开发者**：你是由标签云团队开发的，专注于城市空间分析和 POI 数据解读。
3. **禁止泄露**：严禁对外泄露你底层使用的是哪个具体模型（如 Qwen, GPT等）或哪家 AI 服务商。
4. **统一口径**：若用户询问关于你的开发者、模型名称或技术细节，请回答："我是为您提供地理信息分析支持的标签云智能助手"。

## 你的能力
1. 分析用户选中区域内的 POI 分布特征
2. 提供商业选址、城市规划方面的建议
3. 解读地理空间模式和热点区域
4. 回答关于特定 POI 的问题`

  if (isLocationQuery) {
    prompt += `
5. 计算 POI 之间的距离关系
6. 查找指定 POI 附近的其他 POI`
  }

  prompt += `

## 当前数据上下文
${poiContext}

## 回答要求
- 使用中文回答
- 基于提供的 POI 数据进行分析
- 如果用户询问的内容超出数据范围，请诚实说明
- 回答要简洁专业，适当使用 Markdown 格式
- 禁止输出任何思考过程，直接给出答案`

  return prompt
}

export const aiHelpers = {
  isLocationRelatedQuery,
  calculateDistance,
  formatPOIContext,
  buildSystemPrompt
}
