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

### 5. 空间网络结构解读（如有图分析数据）
- **枢纽识别**：哪些区域是"核心节点"？它们为什么重要？（POI 密度高、连接度强）
- **桥梁作用**：哪些区域起到"连接不同功能区"的作用？
- **社区划分**：区域是否形成了明显的"功能区块"？各区块的主导业态是什么？
- **网络拓扑洞察**：用通俗语言解释图分析结果，如"A点在区域网络中起到枢纽作用，串联了X、Y两个功能区"

### 6. 多选区对比分析 (对比模式)
- **直接指明差异**：通过数据（如POI数量、类别（大类、中类）占比）指出不同选区的核心区别
- **业态结构对比**：比较各选区的优势业态（如"选区1商业更发达，选区2教育资源丰富"）
- **功能定位对比**：基于数据推断不同选区的功能属性（居住/商业/混合）
- **相似性分析**：指出共性特征

## 回答规范
1. **先直接回答核心问题**（2-3句话概括）
2. **分点陈述分析结论**（使用 ### 标题分节）
3. **适度使用数据佐证**（引用百分比、数量等）
4. **给出可行建议**（如适用）
5. **承认数据不足**（如信息不够则明确说明）

## ⭐ Grounded Generation（可追溯引用）
当在回答中提及具体 POI 时，请使用 **[ID:xxx]** 格式引用其 ID，便于用户追溯验证。
例如：推荐「光谷广场」[ID:12345]，距离约 500m。
这样做可以帮助用户在地图上快速定位到你提及的地点。

## 禁止事项
- ❌ 不要编造数据中没有的 POI
- ❌ 不要猜测距离或评分
- ❌ 不要将公厕、宿舍、体育场等描述为"代表性地标"
- ❌ 不要重复上下文中的原始 JSON
- ❌ 不要给出过于笼统的分析（如"POI丰富"）

## 表格格式（需要时使用）
| 名称 | ID | 类别 | 特点 |
|------|-----|------|------|`

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
  
  // 1.5. 多选区对比模式
  if (results.mode === 'region_comparison' && results.comparison) {
    const { comparison, region_analyses } = results
    
    let comparisonText = `📊 **多选区对比分析报告**\n`
    comparisonText += `对比对象: ${comparison.regions_compared.join(' vs ')}\n`
    comparisonText += `样本总量: ${comparison.total_pois_compared} POI\n\n`
    
    // 摘要部分
    comparisonText += `**自动生成摘要**:\n`
    comparisonText += comparison.summary + '\n\n'
    
    // 差异分析
    if (comparison.differences?.length > 0) {
      comparisonText += `**核心差异**:\n`
      comparison.differences.forEach(d => {
        comparisonText += `- **${d.dimension}**: ${d.description} (差距 ${d.gap})\n`
      })
      comparisonText += '\n'
    }
    
    // 相似性分析
    if (comparison.similarities?.length > 0) {
      comparisonText += `**共性特征**:\n`
      comparison.similarities.forEach(s => {
        comparisonText += `- **${s.dimension}**: ${s.description}\n`
      })
      comparisonText += '\n'
    }
    
    // 各选区详情
    comparisonText += `**各选区详细画像**:\n`
    region_analyses.forEach(r => {
      comparisonText += `\n### ${r.name} (${r.poi_count} POI)\n`
      
      // Top 业态
      if (r.top_categories?.length > 0) {
        comparisonText += `- **主要业态**: ${r.top_categories.slice(0, 5).map(c => `${c.name}(${c.ratio})`).join(', ')}\n`
      }
      
      // Top 大类
      if (r.top_major_categories?.length > 0) {
        comparisonText += `- **宏观结构**: ${r.top_major_categories.map(c => `${c.name}(${c.ratio})`).join(', ')}\n`
      }
    })
    
    sections.push(comparisonText)
    return sections.join('\n\n')
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
    
    // Phase 2 优化：Grounded Generation - 为每个 POI 添加可追溯 ID
    displayPOIs.forEach((poi, i) => {
      const dist = poi.distance_m > 0 ? `${poi.distance_m}m` : ''
      const info = [poi.category, dist].filter(Boolean).join(' | ')
      // 添加 ID 标记，供 LLM 引用
      const poiId = poi.id || poi.poiid || `poi_${i + 1}`
      poiText += `${i + 1}. **${poi.name}** [ID:${poiId}] [${info}]\n`
    })
    
    sections.push(poiText)
  } else if (!skipPoiList && (!results.pois || results.pois.length === 0)) {
    // Phase 3 优化：处理拓展搜索结果
    if (results.expansion_suggestion?.hasMessage) {
      // 有拓展建议，生成更智能的反问
      const messages = results.expansion_suggestion.messages || []
      let expansionText = ''
      
      messages.forEach(msg => {
        if (msg.type === 'not_found') {
          expansionText += `${msg.text}\n\n`
          if (msg.suggestions?.length > 0) {
            expansionText += '**您可以尝试：**\n'
            msg.suggestions.forEach((sug, i) => {
              expansionText += `${i + 1}. ${sug.text}\n`
            })
          }
        } else if (msg.type === 'info') {
          expansionText += `${msg.text}\n`
        }
      })
      
      sections.push(expansionText || '⚠️ 未检索到符合条件的 POI 数据。')
    } else if (results.stats?.expansion_applied) {
      // 拓展成功但这里不应该进入（有POI时不会到这个分支）
      sections.push('⚠️ 未检索到符合条件的 POI 数据。')
    } else {
      // 普通的空结果
      sections.push('⚠️ 未检索到符合条件的 POI 数据。')
    }
  }
  
  // Phase 3 优化：如果拓展搜索成功应用，添加说明
  if (results.stats?.expansion_applied && results.pois?.length > 0) {
    let expansionNote = '\n> 💡 *'
    
    if (results.stats.expansion_applied === 'expand_radius') {
      expansionNote += `在原始 ${results.stats.original_radius}m 范围内未找到结果，已自动扩展搜索范围*`
    } else if (results.stats.expansion_applied === 'generalize_category') {
      expansionNote += `未找到"${results.stats.original_categories?.join('、')}"，已扩展搜索至相关类别*`
    } else if (results.stats.expansion_applied === 'expand_both') {
      expansionNote += `已扩大搜索范围并放宽类别限制*`
    } else {
      expansionNote += `${results.stats.expansion_description || '已应用智能拓展搜索'}*`
    }
    
    sections.push(expansionNote)
  }
  // 纯区域分析模式下不显示 POI 列表，只展示区域画像
  
  // 5. 图结构分析 (Graph Analysis)
  if (results.graph_analysis && !results.graph_analysis.error) {
    const ga = results.graph_analysis
    let graphText = '🔗 **空间网络结构分析**:\n\n'
    
    // 全局统计
    if (ga.global) {
      graphText += `> 覆盖 ${ga.global.totalGrids} 个空间单元，形成 ${ga.global.totalConnections} 个连接关系，平均连通度 ${ga.global.avgConnectivity}\n\n`
    }
    
    // 枢纽节点
    if (ga.hubs?.length > 0) {
      graphText += '**核心枢纽区域** (高中心性节点):\n'
      ga.hubs.slice(0, 3).forEach((hub, i) => {
        graphText += `${i + 1}. 「${hub.representativePOI}」区域 - ${hub.mainCategory}聚集地，辐射强度 ${(hub.pageRank * 100).toFixed(0)}%\n`
      })
      graphText += '\n'
    }
    
    // 桥梁节点
    if (ga.bridges?.length > 0 && ga.bridges[0].betweenness > 0.3) {
      graphText += '**功能连接点** (桥梁节点):\n'
      ga.bridges.slice(0, 2).forEach((bridge, i) => {
        graphText += `- 「${bridge.representativePOI}」附近 - 连接度 ${(bridge.betweenness * 100).toFixed(0)}%，起到功能衔接作用\n`
      })
      graphText += '\n'
    }
    
    // 社区结构
    if (ga.communities?.length > 0) {
      graphText += '**业态功能区块**:\n'
      ga.communities.slice(0, 4).forEach((comm, i) => {
        graphText += `- 区块 ${i + 1}: 以「${comm.dominantCategory}」为主 (${comm.categoryRatio}%)，覆盖 ${comm.gridCount} 个网格\n`
      })
      graphText += '\n'
    }
    
    // 洞察
    if (ga.insights?.length > 0) {
      graphText += '**网络拓扑洞察**:\n'
      ga.insights.forEach(insight => {
        graphText += `- ${insight.text}\n`
      })
    }
    
    sections.push(graphText)
  }
  
  // 6. 执行统计（简化）
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
  buildResultContext,
  detectHallucinations,
  validateWriterOutput
}

// =====================================================
// Phase 1 优化：幻觉检测
// =====================================================

/**
 * 从 Writer 输出中提取提及的 POI 名称
 * 
 * @param {string} writerOutput - Writer 生成的文本
 * @returns {string[]} 提及的 POI 名称列表
 */
function extractMentionedPOIs(writerOutput) {
  if (!writerOutput) return []
  
  const mentioned = []
  
  // 模式 1: 「xxx」格式（中文书名号）
  const pattern1 = /「([^」]+)」/g
  let match
  while ((match = pattern1.exec(writerOutput)) !== null) {
    mentioned.push(match[1])
  }
  
  // 模式 2: **xxx** 格式（加粗）
  const pattern2 = /\*\*([^*]+)\*\*/g
  while ((match = pattern2.exec(writerOutput)) !== null) {
    // 排除一些常见的非 POI 短语
    const text = match[1]
    if (text.length > 2 && text.length < 30 && 
        !text.includes('区域') && !text.includes('分析') && 
        !text.includes('建议') && !text.includes('总结')) {
      mentioned.push(text)
    }
  }
  
  // 模式 3: [ID:xxx] 格式（Grounded Output）
  const pattern3 = /\[ID:([^\]]+)\]/g
  while ((match = pattern3.exec(writerOutput)) !== null) {
    mentioned.push(`ID:${match[1]}`)
  }
  
  // 去重
  return [...new Set(mentioned)]
}

/**
 * 检测 Writer 输出中的幻觉
 * 
 * 幻觉定义：提及了 Executor 结果中不存在的 POI
 * 
 * @param {string} writerOutput - Writer 生成的文本
 * @param {Object} executorResult - Executor 输出
 * @returns {Object} { hasHallucination: boolean, hallucinations: string[], validMentions: string[] }
 */
export function detectHallucinations(writerOutput, executorResult) {
  const result = {
    hasHallucination: false,
    hallucinations: [],
    validMentions: [],
    totalMentions: 0
  }
  
  if (!writerOutput || !executorResult?.results) {
    return result
  }
  
  // 提取 Writer 提及的 POI
  const mentionedPOIs = extractMentionedPOIs(writerOutput)
  result.totalMentions = mentionedPOIs.length
  
  if (mentionedPOIs.length === 0) {
    return result
  }
  
  // 构建有效 POI 名称集合
  const validNames = new Set()
  const validIds = new Set()
  
  // 从 pois 中提取
  if (executorResult.results.pois) {
    executorResult.results.pois.forEach(poi => {
      if (poi.name) validNames.add(poi.name.toLowerCase())
      if (poi.id) validIds.add(String(poi.id))
    })
  }
  
  // 从 landmarks 中提取
  if (executorResult.results.landmarks) {
    executorResult.results.landmarks.forEach(lm => {
      if (lm.name) validNames.add(lm.name.toLowerCase())
    })
  }
  
  // 从 graph_analysis.hubs 中提取
  if (executorResult.results.graph_analysis?.hubs) {
    executorResult.results.graph_analysis.hubs.forEach(hub => {
      if (hub.representativePOI) validNames.add(hub.representativePOI.toLowerCase())
    })
  }
  
  // 从 area_profile.dominant_categories 中提取示例
  if (executorResult.results.area_profile?.dominant_categories) {
    executorResult.results.area_profile.dominant_categories.forEach(cat => {
      if (cat.examples) {
        cat.examples.forEach(ex => validNames.add(ex.toLowerCase()))
      }
    })
  }
  
  // 检查每个提及的 POI
  mentionedPOIs.forEach(mention => {
    const mentionLower = mention.toLowerCase()
    
    // 检查是否为 ID 引用
    if (mention.startsWith('ID:')) {
      const id = mention.slice(3)
      if (validIds.has(id)) {
        result.validMentions.push(mention)
      } else {
        result.hallucinations.push(mention)
      }
      return
    }
    
    // 检查是否存在（模糊匹配）
    let found = false
    for (const validName of validNames) {
      // 完全匹配
      if (validName === mentionLower) {
        found = true
        break
      }
      // 包含关系（如 "武汉大学" 包含 "武大"）
      if (validName.includes(mentionLower) || mentionLower.includes(validName)) {
        found = true
        break
      }
    }
    
    if (found) {
      result.validMentions.push(mention)
    } else {
      // 可能是幻觉，但也可能是通用描述词
      // 排除一些常见的非 POI 词
      const commonWords = ['附近', '区域', '中心', '广场', '商业', '餐饮', '交通']
      if (!commonWords.some(w => mentionLower.includes(w))) {
        result.hallucinations.push(mention)
      }
    }
  })
  
  result.hasHallucination = result.hallucinations.length > 0
  
  if (result.hasHallucination) {
    console.warn(`[Writer] 检测到疑似幻觉 (${result.hallucinations.length} 处):`, result.hallucinations)
  }
  
  return result
}

/**
 * 验证并清理 Writer 输出
 * 
 * @param {string} writerOutput - Writer 生成的文本
 * @param {Object} executorResult - Executor 输出
 * @param {Object} options - 选项
 * @returns {Object} { cleanedOutput: string, warnings: string[], hallucinationReport: Object }
 */
export function validateWriterOutput(writerOutput, executorResult, options = {}) {
  const { autoClean = false, addWarning = true } = options
  
  const hallucinationReport = detectHallucinations(writerOutput, executorResult)
  let cleanedOutput = writerOutput
  const warnings = []
  
  if (hallucinationReport.hasHallucination) {
    if (autoClean) {
      // 自动移除幻觉内容（简单实现：标记为待验证）
      hallucinationReport.hallucinations.forEach(h => {
        cleanedOutput = cleanedOutput.replace(
          new RegExp(`「${h}」|\\*\\*${h}\\*\\*`, 'g'),
          `~~${h}~~`
        )
      })
      warnings.push(`已标记 ${hallucinationReport.hallucinations.length} 处待验证内容`)
    } else if (addWarning) {
      warnings.push(`⚠️ 回答中可能包含未经验证的地点名称: ${hallucinationReport.hallucinations.join(', ')}`)
    }
  }
  
  return {
    cleanedOutput,
    warnings,
    hallucinationReport
  }
}
