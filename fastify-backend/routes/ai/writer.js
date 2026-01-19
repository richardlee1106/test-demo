/**
 * 阶段 3: Writer (解释器)
 * 
 * 职责：
 * - 基于 Executor 的压缩结果 JSON 生成自然语言回答
 * - 绝不读取原始 POI 数据
 * - Token 消耗: < 2000
 */

import { getLLMConfig } from '../../services/llm.js'

/**
 * Writer System Prompt
 * 专注于基于压缩数据生成自然语言回答
 */
const WRITER_SYSTEM_PROMPT = `你是「GeoLoom-RAG 空间认知助手」，一个专业的地理信息分析专家。

## 身份限制
- 你是 GeoLoom-RAG 团队开发的智能地理助手
- 禁止透露底层模型信息

## 当前数据上下文
{result_context}

## 核心能力：多维空间分析
你需要基于上述数据，从以下维度深度解读区域特征：

### 1. 业态结构分析
- 主导业态是什么？占比如何？
- 业态多样性如何？（是单一功能区还是混合功能区？）
- 缺失哪些常见业态？（潜在商业机会）

### 2. 空间分布规律
- POI 是均匀分布还是聚集分布？
- 热点区域集中在哪里？（根据 H3 网格分析）
- 是否存在明显的功能分区？

### 3. 代表性地标识别
- 区域内有哪些**真正具有地标价值**的 POI？
- 地标应该是：辨识度高、知名度广、可用于定位的设施
- **绝对排除**：公厕、宿舍、体育场、配套设施等不具地标意义的 POI

### 4. 区域定性判断
- 这是什么类型的区域？（商业区/居民区/文教区/工业区/综合区）
- 该区域的核心功能是什么？
- 该区域适合什么人群？

## 回答规范
1. **先直接回答核心问题**（2-3句话概括）
2. **分点陈述分析结论**（使用 ### 标题分节）
3. **适度使用数据佐证**（引用百分比、数量等）
4. **给出可行建议**（如适用）
5. **承认数据不足**（如信息不够则明确说明）

## 禁止事项
- ❌ 不要编造数据中没有的 POI
- ❌ 不要猜测距离或评分
- ❌ 不要将公厕、宿舍、体育场等描述为"代表性地标"
- ❌ 不要重复上下文中的原始 JSON
- ❌ 不要给出过于笼统的分析（如"POI丰富"）

## 表格格式（需要时使用）
| 名称 | 类别 | 特点 |
|------|------|------|`

/**
 * 构建精简的结果上下文（供 LLM 使用）
 * 
 * 这是关键的 Token 控制点：
 * - 只传必要信息
 * - 使用紧凑格式
 * - 限制 POI 数量
 * 
 * @param {Object} executorResult - Executor 输出
 * @returns {string} 格式化的上下文字符串
 */
function buildResultContext(executorResult) {
  const { results } = executorResult
  if (!results) return '⚠️ 无可用数据'
  
  const sections = []
  
  // 0. 执行错误/异常提示
  if (results.execution_failure || results.error_message) {
    sections.push(`⚠️ **查询执行遇到问题**: ${results.error_message || '无法获取位置信息'}`)
    // 如果是严重错误，可能不需要展示其他空数据，但为了上下文完整，我们继续
  }
  
  // 1. 锚点信息
  if (results.anchor) {
    const lon = typeof results.anchor.lon === 'number' ? results.anchor.lon.toFixed(5) : 'Unknown';
    const lat = typeof results.anchor.lat === 'number' ? results.anchor.lat.toFixed(5) : 'Unknown';
    sections.push(`🎯 **参考位置**: ${results.anchor.name || '未知位置'} (${lon}, ${lat})`)
  }
  
  // 2. 区域画像
  if (results.area_profile && results.area_profile.total_count > 0) {
    const profile = results.area_profile
    let profileText = `📊 **区域概览** (共 ${profile.total_count} 个 POI)\n\n`
    
    if (profile.dominant_categories?.length > 0) {
      profileText += '**主要类别分布**:\n'
      profile.dominant_categories.forEach(cat => {
        const examples = cat.examples?.length > 0 ? `，如 ${cat.examples.join('、')}` : ''
        const rating = cat.avg_rating ? `，平均评分 ${cat.avg_rating}` : ''
        profileText += `- ${cat.category}: ${cat.count} 个 (${cat.percentage}%)${rating}${examples}\n`
      })
    }
    
    if (profile.rare_categories?.length > 0) {
      profileText += '\n**稀缺类别**:\n'
      profile.rare_categories.forEach(cat => {
        profileText += `- ${cat.category}: 仅 ${cat.count} 个\n`
      })
    }
    
    sections.push(profileText)
  }
  
  // 3. 空间分布 (H3 聚合)
  if (results.spatial_analysis?.grids?.length > 0) {
    const { grids, resolution } = results.spatial_analysis
    let spatialText = `🗺️ **空间分布分析**:\n`
    
    // 列出 Top 网格 (简化格式)
    spatialText += '\n**热点区域**:\n'
    grids.forEach((g, i) => {
      // g: { id, c (count), m (main_cat), p (rep_poi), r (ratio) }
      if (i < 5) { // 只列出前 5 个
         spatialText += `- 热区 ${i+1}: ${g.p || '未命名'} 附近，主导业态: ${g.m}\n`
      }
    })
    
    sections.push(spatialText)
  }

  // 4. 代表性地标 (不显示距离)
  if (results.landmarks?.length > 0) {
    let landmarkText = '🏛️ **区域内代表性 POI** (共 ' + results.landmarks.length + ' 个):\n'
    results.landmarks.forEach((l, idx) => {
      landmarkText += `${idx + 1}. **${l.name}** [${l.type}]\n`
    })
    sections.push(landmarkText)
  }
  
  // 4. POI 列表（核心数据）- 仅当不是纯区域分析时显示
  const skipPoiList = results.stats?.skip_poi_search === true
  
  if (!skipPoiList && results.pois?.length > 0) {
    // 限制最多显示 15 条
    const displayPOIs = results.pois.slice(0, 15)
    
    let poiText = `📍 **检索结果** (${results.pois.length} 条${results.pois.length > 15 ? '，显示前 15 条' : ''}):\n\n`
    
    displayPOIs.forEach((poi, i) => {
      const dist = poi.distance_m > 0 ? `${poi.distance_m}m` : ''
      const info = [poi.category, dist].filter(Boolean).join(' | ')
      poiText += `${i + 1}. **${poi.name}** [${info}]\n`
    })
    
    sections.push(poiText)
  } else if (!skipPoiList && (!results.pois || results.pois.length === 0)) {
    // 只有在非纯分析模式下才提示未找到 POI
    sections.push('⚠️ 未检索到符合条件的 POI 数据。')
  }
  // 纯区域分析模式下不显示 POI 列表，只展示区域画像
  
  // 5. 执行统计（简化）
  if (results.stats) {
    const stats = results.stats
    let statsText = '\n---\n📈 '
    const statParts = []
    
    if (stats.total_candidates) {
      statParts.push(`候选 ${stats.total_candidates} 个`)
    }
    if (stats.semantic_rerank_applied) {
      statParts.push('已应用语义排序')
    }
    if (stats.execution_time_ms) {
      statParts.push(`耗时 ${stats.execution_time_ms}ms`)
    }
    
    if (statParts.length > 0) {
      statsText += statParts.join(' | ')
      sections.push(statsText)
    }
  }
  
  return sections.join('\n\n')
}

/**
 * 阶段 3 主入口：生成回答（流式）
 * 
 * @param {string} userQuestion - 用户原始问题
 * @param {Object} executorResult - Executor 输出
 * @param {Object} options - 选项
 * @yields {string} 流式文本块
 */
export async function* generateAnswer(userQuestion, executorResult, options = {}) {
  const startTime = Date.now()
  
  console.log('[Writer] 开始生成回答')
  
  // 构建精简上下文
  const resultContext = buildResultContext(executorResult)
  const systemPrompt = WRITER_SYSTEM_PROMPT.replace('{result_context}', resultContext)
  
  // 检查是否需要澄清
  const queryPlan = executorResult.results?.query_executed
  if (queryPlan?.query_type === 'clarification_needed' && queryPlan?.clarification_question) {
    yield queryPlan.clarification_question
    return
  }
  
  try {
    // 获取 LLM 配置（自动选择本地或云端）
    const { baseUrl, model, apiKey, isLocal } = await getLLMConfig()
    
    console.log(`[Writer] 使用 ${isLocal ? '本地' : '云端'} 模型: ${model}`)
    
    // 构建请求头
    const headers = { 'Content-Type': 'application/json' }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }
    
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userQuestion }
        ],
        temperature: 0.7,
        max_tokens: 1500,
        stream: true,
      }),
    })
    
    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status} ${response.statusText}`)
    }
    
    // 流式输出
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let totalTokens = 0
    
    // 过滤 <think> 标签的状态机
    let inThinkTag = false
    let pendingContent = ''
    
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      
      buffer += decoder.decode(value, { stream: true })
      
      // 按行解析 SSE
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        
        try {
          const parsed = JSON.parse(data)
          let content = parsed.choices?.[0]?.delta?.content || ''
          
          if (content) {
            // 处理 <think> 标签
            pendingContent += content
            
            // 检查是否进入/退出 think 标签
            if (pendingContent.includes('<think>')) {
              inThinkTag = true
              pendingContent = pendingContent.replace(/<think>/g, '')
            }
            
            if (pendingContent.includes('</think>')) {
              inThinkTag = false
              // 移除 think 标签及其内容
              pendingContent = pendingContent.replace(/[\s\S]*?<\/think>/g, '')
            }
            
            // 如果不在 think 标签内，输出内容
            if (!inThinkTag && pendingContent) {
              yield pendingContent
              totalTokens += pendingContent.length
              pendingContent = ''
            }
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
    
    // 输出剩余内容
    if (pendingContent && !inThinkTag) {
      yield pendingContent
    }
    
    const duration = Date.now() - startTime
    
    // 估算 token 消耗（中文约 1.5 字符/token，英文约 4 字符/token）
    const estimatedPromptTokens = Math.ceil(systemPrompt.length / 1.5) + Math.ceil(userQuestion.length / 1.5)
    const estimatedCompletionTokens = Math.ceil(totalTokens / 1.5)
    
    // 返回 token 使用统计（通过特殊标记，由调用方捕获）
    // 注意：这不会被 yield 到用户，仅用于内部统计
    const tokenUsage = {
      prompt_tokens: estimatedPromptTokens,
      completion_tokens: estimatedCompletionTokens,
      total_tokens: estimatedPromptTokens + estimatedCompletionTokens
    }
    
    console.log(`[Writer] 完成 (${duration}ms, ~${totalTokens} chars, est. ${tokenUsage.total_tokens} tokens)`)
    
    // 通过 options.onTokenUsage 回调传递 token 统计
    if (options.onTokenUsage && typeof options.onTokenUsage === 'function') {
      options.onTokenUsage(tokenUsage)
    }
    
  } catch (err) {
    console.error('[Writer] 生成失败:', err.message)
    yield `\n\n⚠️ 生成回答时出错: ${err.message}`
  }
}

/**
 * 非流式生成回答（用于测试或批量场景）
 * 
 * @param {string} userQuestion - 用户问题
 * @param {Object} executorResult - Executor 输出
 * @returns {Promise<string>} 完整回答
 */
export async function generateAnswerSync(userQuestion, executorResult) {
  let fullContent = ''
  
  for await (const chunk of generateAnswer(userQuestion, executorResult)) {
    fullContent += chunk
  }
  
  return fullContent
}

/**
 * 构建快速回复（不调用 LLM，用于简单场景）
 * 
 * @param {Object} executorResult - Executor 输出
 * @returns {string} 快速回复
 */
export function buildQuickReply(executorResult) {
  const { results } = executorResult
  
  if (!results) {
    return '抱歉，查询过程中出现问题，请稍后重试。'
  }
  
  if (results.error) {
    return `查询失败: ${results.error}`
  }
  
  if (results.execution_failure || results.error_message) {
    return `⚠️ ${results.error_message || '无法获取位置信息'}`
  }
  
  if (!results.pois || results.pois.length === 0) {
    if (results.anchor) {
      return `在 ${results.anchor.name} 附近未找到符合条件的 POI。`
    }
    return '未找到符合条件的 POI，请尝试调整搜索条件。'
  }
  
  // 简单列表回复
  let reply = ''
  
  if (results.anchor) {
    reply += `在 **${results.anchor.name}** 附近找到 ${results.pois.length} 个结果：\n\n`
  } else {
    reply += `找到 ${results.pois.length} 个结果：\n\n`
  }
  
  reply += '| 名称 | 类别 | 距离 | 评分 |\n'
  reply += '|------|------|------|------|\n'
  
  results.pois.slice(0, 10).forEach(poi => {
    const dist = poi.distance_m > 0 ? `${poi.distance_m}m` : '-'
    const rating = poi.rating ? poi.rating.toFixed(1) : '-'
    reply += `| ${poi.name} | ${poi.category} | ${dist} | ${rating} |\n`
  })
  
  return reply
}

export default {
  generateAnswer,
  generateAnswerSync,
  buildQuickReply,
  buildResultContext
}
