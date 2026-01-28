/**
 * Phase 3 优化：空结果智能拓展搜索
 * 
 * 当 Executor 检索结果为空时，自动触发拓展搜索逻辑：
 * 1. 扩大半径：自动将半径扩大 2 倍重试
 * 2. 泛化类别：如果搜 "精品手冲咖啡"，找不到时自动降级搜 "咖啡厅"
 * 3. 反问用户：生成建议信息供 Writer 使用
 */

import { generalizeCategories } from './categoryOntology.js'

/**
 * 拓展搜索配置
 */
const EXPANSION_CONFIG = {
  // 半径拓展
  radiusExpansion: {
    enabled: true,
    multiplier: 2,           // 半径扩大倍数
    maxRadius: 10000,        // 最大拓展半径（米）
    maxRetries: 2            // 最大重试次数
  },
  
  // 类别泛化
  categoryGeneralization: {
    enabled: true,
    maxLevels: 2             // 最多向上泛化2级（如 川菜 → 中餐 → 餐饮）
  },
  
  // 建议生成
  suggestions: {
    enabled: true,
    includeRadiusSuggestion: true,
    includeCategorySuggestion: true
  }
}

/**
 * 拓展搜索策略生成器
 * 
 * 根据原始查询计划生成一系列可尝试的拓展策略
 * 
 * @param {Object} originalPlan - 原始查询计划
 * @param {Object} context - 查询上下文（包含锚点等）
 * @returns {Object} 拓展策略
 */
export function generateExpansionStrategies(originalPlan, context = {}) {
  const strategies = []
  const originalRadius = originalPlan.radius_m || 1000
  const originalCategories = originalPlan.categories || []
  
  // 策略 1: 扩大半径
  if (EXPANSION_CONFIG.radiusExpansion.enabled) {
    let expandedRadius = originalRadius * EXPANSION_CONFIG.radiusExpansion.multiplier
    expandedRadius = Math.min(expandedRadius, EXPANSION_CONFIG.radiusExpansion.maxRadius)
    
    if (expandedRadius > originalRadius) {
      strategies.push({
        type: 'expand_radius',
        description: `扩大搜索范围至 ${expandedRadius}m`,
        modifiedPlan: {
          ...originalPlan,
          radius_m: expandedRadius,
          _expansion_applied: 'radius',
          _original_radius: originalRadius
        }
      })
    }
  }
  
  // 策略 2: 泛化类别
  if (EXPANSION_CONFIG.categoryGeneralization.enabled && originalCategories.length > 0) {
    const generalizedCats = generalizeCategories(originalCategories)
    
    if (generalizedCats.length > 0) {
      strategies.push({
        type: 'generalize_category',
        description: `从 "${originalCategories.join(', ')}" 泛化为 "${generalizedCats.join(', ')}"`,
        modifiedPlan: {
          ...originalPlan,
          categories: generalizedCats,
          _expansion_applied: 'category',
          _original_categories: originalCategories
        }
      })
    }
  }
  
  // 策略 3: 同时扩大半径 + 泛化类别
  if (strategies.length >= 2) {
    const radiusStrategy = strategies.find(s => s.type === 'expand_radius')
    const categoryStrategy = strategies.find(s => s.type === 'generalize_category')
    
    if (radiusStrategy && categoryStrategy) {
      strategies.push({
        type: 'expand_both',
        description: `扩大范围至 ${radiusStrategy.modifiedPlan.radius_m}m 并泛化类别`,
        modifiedPlan: {
          ...originalPlan,
          radius_m: radiusStrategy.modifiedPlan.radius_m,
          categories: categoryStrategy.modifiedPlan.categories,
          _expansion_applied: 'both',
          _original_radius: originalRadius,
          _original_categories: originalCategories
        }
      })
    }
  }
  
  // 策略 4: 移除类别限制（全品类搜索）
  if (originalCategories.length > 0) {
    strategies.push({
      type: 'remove_category_filter',
      description: '移除类别限制，搜索所有 POI',
      modifiedPlan: {
        ...originalPlan,
        categories: [],
        _expansion_applied: 'no_category',
        _original_categories: originalCategories
      }
    })
  }
  
  return {
    original: originalPlan,
    strategies,
    hasStrategies: strategies.length > 0
  }
}

/**
 * 生成用户友好的反问/建议信息
 * 
 * @param {Object} expansionResult - 拓展搜索结果
 * @returns {Object} 反问信息
 */
export function generateSuggestionMessage(expansionResult) {
  const {
    originalQuery,
    originalRadius,
    originalCategories,
    attemptedStrategies,
    successfulStrategy,
    finalPoiCount
  } = expansionResult
  
  // 如果拓展成功找到了结果
  if (successfulStrategy && finalPoiCount > 0) {
    const messages = []
    
    if (successfulStrategy.type === 'expand_radius') {
      messages.push({
        type: 'info',
        text: `📍 在 ${originalRadius}m 范围内未找到结果，已自动扩展至 ${successfulStrategy.modifiedPlan.radius_m}m，找到 ${finalPoiCount} 个相关地点。`
      })
    } else if (successfulStrategy.type === 'generalize_category') {
      messages.push({
        type: 'info',
        text: `🔍 未找到"${originalCategories?.join('、')}"，已扩展搜索至"${successfulStrategy.modifiedPlan.categories?.join('、')}"相关类别，找到 ${finalPoiCount} 个地点。`
      })
    } else if (successfulStrategy.type === 'expand_both') {
      messages.push({
        type: 'info',
        text: `🔄 已扩大搜索范围并放宽类别限制，找到 ${finalPoiCount} 个相关地点。`
      })
    }
    
    return {
      hasMessage: true,
      messages,
      expansionApplied: successfulStrategy.type
    }
  }
  
  // 如果所有策略都失败了，生成反问
  if (!successfulStrategy || finalPoiCount === 0) {
    const suggestions = []
    
    // 建议扩大范围
    if (EXPANSION_CONFIG.suggestions.includeRadiusSuggestion) {
      const suggestedRadius = Math.min(
        (originalRadius || 1000) * 3, 
        EXPANSION_CONFIG.radiusExpansion.maxRadius
      )
      suggestions.push({
        type: 'action',
        text: `扩大搜索范围至 ${suggestedRadius}m`,
        action: { type: 'expand_radius', radius: suggestedRadius }
      })
    }
    
    // 建议换个类别
    if (EXPANSION_CONFIG.suggestions.includeCategorySuggestion && originalCategories?.length > 0) {
      const generalized = generalizeCategories(originalCategories)
      if (generalized.length > 0) {
        suggestions.push({
          type: 'action',
          text: `搜索更广泛的"${generalized[0]}"类别`,
          action: { type: 'generalize_category', categories: generalized }
        })
      }
    }
    
    return {
      hasMessage: true,
      messages: [{
        type: 'not_found',
        text: `⚠️ 在当前 ${originalRadius || 1000}m 范围内未找到符合条件的"${originalCategories?.join('、') || '相关地点'}"。`,
        suggestions
      }],
      expansionApplied: null
    }
  }
  
  return { hasMessage: false, messages: [], expansionApplied: null }
}

/**
 * 执行拓展搜索
 * 
 * 这是一个包装函数，用于在 Executor 中调用
 * 
 * @param {Function} searchFn - 实际的搜索函数
 * @param {Object} originalPlan - 原始查询计划
 * @param {Object} context - 查询上下文
 * @param {Object} options - 选项
 * @returns {Promise<Object>} 拓展搜索结果
 */
export async function executeWithExpansion(searchFn, originalPlan, context = {}, options = {}) {
  const { maxRetries = 2 } = options
  
  // 先执行原始搜索
  let result = await searchFn(originalPlan)
  
  // 如果有结果，直接返回
  if (result.pois && result.pois.length > 0) {
    return {
      ...result,
      expansion: {
        applied: false,
        attemptedStrategies: []
      }
    }
  }
  
  // 生成拓展策略
  const expansionPlan = generateExpansionStrategies(originalPlan, context)
  
  if (!expansionPlan.hasStrategies) {
    return {
      ...result,
      expansion: {
        applied: false,
        attemptedStrategies: [],
        message: generateSuggestionMessage({
          originalRadius: originalPlan.radius_m,
          originalCategories: originalPlan.categories,
          attemptedStrategies: [],
          successfulStrategy: null,
          finalPoiCount: 0
        })
      }
    }
  }
  
  // 依次尝试拓展策略
  const attemptedStrategies = []
  let successfulStrategy = null
  
  for (let i = 0; i < Math.min(expansionPlan.strategies.length, maxRetries); i++) {
    const strategy = expansionPlan.strategies[i]
    console.log(`[ExpansionSearch] 尝试策略 ${i + 1}: ${strategy.description}`)
    
    attemptedStrategies.push(strategy)
    
    try {
      result = await searchFn(strategy.modifiedPlan)
      
      if (result.pois && result.pois.length > 0) {
        successfulStrategy = strategy
        console.log(`[ExpansionSearch] 策略成功: 找到 ${result.pois.length} 个结果`)
        break
      }
    } catch (err) {
      console.warn(`[ExpansionSearch] 策略 ${strategy.type} 执行失败:`, err.message)
    }
  }
  
  // 生成消息
  const suggestionMessage = generateSuggestionMessage({
    originalRadius: originalPlan.radius_m,
    originalCategories: originalPlan.categories,
    attemptedStrategies,
    successfulStrategy,
    finalPoiCount: result.pois?.length || 0
  })
  
  return {
    ...result,
    expansion: {
      applied: !!successfulStrategy,
      successfulStrategy,
      attemptedStrategies,
      message: suggestionMessage
    }
  }
}

export default {
  EXPANSION_CONFIG,
  generateExpansionStrategies,
  generateSuggestionMessage,
  executeWithExpansion
}
