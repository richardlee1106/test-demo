<template>
  <div class="tag-cloud-wrapper">
    <div ref="tagCloudContainer" class="tag-cloud-container"></div>
    <!-- 缩放控制按钮组 -->
    <div class="zoom-controls">
      <button @click="zoomIn" class="zoom-btn" title="放大">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
          <line x1="11" y1="8" x2="11" y2="14"></line>
          <line x1="8" y1="11" x2="14" y2="11"></line>
        </svg>
      </button>
      <button @click="zoomOut" class="zoom-btn" title="缩小">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
          <line x1="8" y1="11" x2="14" y2="11"></line>
        </svg>
      </button>
      <button @click="resetZoom" class="zoom-btn" title="重置视图">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path>
          <path d="M13 13l6 6"></path>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import * as d3 from 'd3';
import BasicWorker from '../workers/basic.worker.js?worker';
import SpiralWorker from '../workers/spiral.worker.js?worker';
import GeoWorker from '../workers/geo.worker.js?worker';
import { fromLonLat } from 'ol/proj';
import { ElMessage } from 'element-plus';

// 定义组件事件
// hover-feature: 鼠标悬停在标签上时触发，通知地图高亮对应 POI
// locate-feature: 点击标签时触发，通知地图飞向对应 POI
const emit = defineEmits(['hover-feature', 'locate-feature']);

// 定义组件属性
const props = defineProps({
  data: Array, // 标签数据（GeoJSON Feature 数组）
  map: Object, // OpenLayers 地图实例
  algorithm: String, // 布局算法类型 ('basic' | 'spiral' | 'geo')
  selectedBounds: Object, // 选区边界（目前未使用）
  polygonCenter: Object, // 多边形中心点（用于螺旋布局）
  spiralConfig: Object, // 螺旋布局配置
  boundaryPolygon: Array, // 边界多边形顶点
  hoveredFeatureId: Object, // 当前悬浮的 Feature 对象
  clickedFeatureId: Object, // 当前点击的 Feature 对象（常亮）
  drawMode: String, // 当前绘制模式 ('Circle' | 'Polygon' | 'None')
  circleCenter: Array, // 圆形绘制模式下的圆心坐标 [lon, lat]
});

// 响应式引用
const tagCloudContainer = ref(null);
let worker = null; // Web Worker 实例
let svgRef = null; // D3 SVG 选择器引用
let rootGroupRef = null; // 主分组引用 (g.main-group)
let zoomGroupRef = null; // 缩放分组引用 (g.zoom-group)
let zoomBehavior = null; // D3 Zoom 行为实例
let debounceTimer = null; // 防抖定时器

// 常量配置
const MAX_TAGS = 1000; // 标签显示上限，防止 DOM 过多导致卡顿
const RESIZE_DEBOUNCE_MS = 120; // 窗口大小调整防抖时间
const MIN_SCALE = 0.2; // 最小缩放比例
const MAX_SCALE = 5; // 最大缩放比例
let currentTransform = d3.zoomIdentity; // 当前缩放变换状态
let cachedLayoutTags = []; // 缓存布局后的标签数据，用于快速查找

/**
 * 初始化 Web Worker
 * 根据当前的绘制模式 (drawMode) 和算法选择 (algorithm) 实例化对应的 Worker。
 * Worker 用于在后台线程执行耗时的力导向布局计算，避免阻塞 UI 线程。
 */
function initWorker() {
  // 清理旧 worker，防止内存泄漏和重复处理
  if (worker) {
    worker.terminate();
  }
  
  // 确定 worker 类型
  // 优先级: Geo (圆形模式) > 选定的算法 (basic/spiral)
  if (props.drawMode === 'Circle') {
    worker = new GeoWorker();
  } else if (props.algorithm === 'basic') {
    worker = new BasicWorker();
  } else {
    worker = new SpiralWorker();
  }
  
  // 设置 worker 消息处理回调
  // 当 Worker 计算完成并返回布局后的标签数据时触发
  worker.onmessage = event => {
    const tags = event.data;
    console.log('[TagCloud] 收到来自 Worker 的标签数据:', tags.length);
    
    // 缓存布局数据，用于 centerOnFeature 快速查找
    cachedLayoutTags = tags;

    // 使用 requestAnimationFrame 优化渲染
    requestAnimationFrame(() => {
      const svg = d3.select(tagCloudContainer.value).select('svg');
      const root = svg.select('g.main-group');
      rootGroupRef = root;
      const zoomGroup = svg.select('g.zoom-group');

      if (svg.empty() || root.empty() || zoomGroup.empty()) {
        console.error('[TagCloud] 错误: 未找到 SVG 元素');
        return;
      }

      // 性能优化：标签过多时禁用过渡动画
      const useTransition = tags.length < 500;
      const transitionDuration = useTransition ? 200 : 0;

      // 使用 D3 的数据绑定机制
      // 使用更唯一的 key：名称 + 坐标（避免搜索过滤后 key 冲突）
      const texts = root
        .selectAll('text')
        .data(tags, d => `${d.name}-${d.lon?.toFixed(6)}-${d.lat?.toFixed(6)}`);

      // 预计算样式值，减少函数调用
      const getFontSize = d => `${d.fontSize || 16}px`;
      const getFill = d => d.isCenter ? '#FFA500' : (d.selected ? '#d23' : '#bfeaf1');
      const getFontWeight = d => d.isCenter ? '900' : (d.selected ? '700' : '400');
      const getTransform = d => `translate(${d.x},${d.y})${d.rotation ? ` rotate(${d.rotation})` : ''}`;

      // Enter + Update 合并处理
      texts.join(
        enter => enter.append('text')
          .attr('text-anchor', 'middle')
          .attr('dy', '.35em')
          .style('cursor', 'pointer')
          .text(d => d.name)
          .style('font-size', getFontSize)
          .style('fill', getFill)
          .style('font-weight', getFontWeight)
          .attr('transform', getTransform)
          .on('mouseover', (event, d) => {
            if (d.isCenter) return;
            emit('hover-feature', props.data[d.originalIndex]);
          })
          .on('mouseout', () => emit('hover-feature', null))
          .on('click', (event, d) => {
            event.stopPropagation();
            if (d.isCenter) return;
            emit('locate-feature', props.data[d.originalIndex]);
          }),
        update => {
          // 性能优化：根据数量决定是否使用动画
          const u = useTransition ? update.transition().duration(transitionDuration) : update;
          return u
            .text(d => d.name) // 确保名称也更新
            .style('font-size', getFontSize)
            .style('fill', getFill)
            .style('font-weight', getFontWeight)
            .attr('transform', getTransform);
        },
        exit => exit.remove()
      );

      // 应用高亮状态（悬浮和点击）
      if (props.hoveredFeatureId || props.clickedFeatureId) {
        updateHighlight();
      }
    });
  };
}

/**
 * 更新标签的高亮样式（性能优化版）
 * 同时考虑悬浮和点击状态，点击状态优先级更高（常亮）
 */
function updateHighlight() {
  if (!rootGroupRef || rootGroupRef.empty()) return;
  
  // 使用缓存的布局数据快速查找匹配的标签索引
  const findMatchingIndex = (feature) => {
    if (!feature) return -1;
    const coords = feature.geometry?.coordinates;
    if (!coords) return -1;
    
    // 在缓存的布局数据中查找
    for (const tag of cachedLayoutTags) {
      if (tag.lon !== undefined && tag.lat !== undefined) {
        if (Math.abs(tag.lon - coords[0]) < 0.0001 && 
            Math.abs(tag.lat - coords[1]) < 0.0001) {
          return tag.originalIndex;
        }
      }
    }
    return -1;
  };
  
  // 悬浮和点击的索引
  const hoveredIndex = findMatchingIndex(props.hoveredFeatureId);
  const clickedIndex = findMatchingIndex(props.clickedFeatureId);
  
  // 直接更新样式，不使用过渡动画
  rootGroupRef.selectAll('text')
    .style('fill', d => {
      if (d.isCenter) return '#FFA500';
      // 点击状态优先（常亮），然后是悬浮状态
      if (d.originalIndex === clickedIndex || d.originalIndex === hoveredIndex) {
        return 'orange';
      }
      return d.selected ? '#d23' : '#bfeaf1';
    })
    .style('font-weight', d => {
      if (d.isCenter) return '900';
      if (d.originalIndex === clickedIndex || d.originalIndex === hoveredIndex) {
        return 'bold';
      }
      return d.selected ? '700' : '400';
    });
}

// 监听悬浮和点击状态变化
watch(() => props.hoveredFeatureId, () => updateHighlight(), { flush: 'sync' });
watch(() => props.clickedFeatureId, () => updateHighlight(), { flush: 'sync' });

/**
 * 主布局函数：准备数据并发送给 Worker
 * @param {String} algorithm - 当前使用的算法名称
 */
const runLayout = (algorithm) => {
  console.log('[TagCloud] runLayout 被调用. 数据量:', props.data?.length); 
  if (!props.data) {
    console.log('[TagCloud] runLayout 提前返回. Data 为空');
    return;
  }

  const width = tagCloudContainer.value.clientWidth;
  const height = tagCloudContainer.value.clientHeight;

  // 始终重新选择 SVG 以确保引用不是过期的
  let svg = d3.select(tagCloudContainer.value).select('svg');
  if (svg.empty()) {
    svg = d3.select(tagCloudContainer.value).append('svg');
    // 创建嵌套的组结构用于缩放和平移 (zoom/pan)
    svg.append('g').attr('class', 'zoom-group');
  }

  // 获取 zoom group 并在其中设置 main group
  const zoomGroup = svg.select('g.zoom-group');
  let root = zoomGroup.select('g.main-group');
  if (root.empty()) {
    root = zoomGroup.append('g').attr('class', 'main-group');
  }

  svg.attr('width', width)
     .attr('height', height)
     .style('background-color', 'rgba(255, 255, 255, 0.1)'); // 调试用背景色

  // 设置缩放行为 (Zoom Behavior) - 性能优化版
  if (!zoomBehavior) {
    let lastZoomTime = 0;
    const ZOOM_THROTTLE = 16; // 约 60fps
    
    zoomBehavior = d3.zoom()
      .scaleExtent([MIN_SCALE, MAX_SCALE])
      .filter((event) => {
        // 过滤掉不需要的事件，提高性能
        return !event.ctrlKey && !event.button;
      })
      .on('zoom', (event) => {
        // 节流处理，减少重绘次数
        const now = performance.now();
        if (now - lastZoomTime < ZOOM_THROTTLE) return;
        lastZoomTime = now;
        
        currentTransform = event.transform;
        zoomGroup.attr('transform', currentTransform);
      });
  }

  // 始终应用缩放行为，确保事件监听器存在
  svg.call(zoomBehavior);
  
  if (!svgRef || !zoomGroupRef) {
    svgRef = svg;
    zoomGroupRef = zoomGroup;
  }

  // 计算标签位置和选择标记
  // 提取需要的数据属性，构建轻量级对象发送给 Worker
  let tags = (props.data || []).map((feature, index) => {
    const name = feature?.properties?.['名称'] ?? feature?.properties?.name ?? feature?.properties?.Name ?? '';
    const weight = feature?.properties?.weight; // 如果有权重则提取
    
    // 提取地理坐标用于 Geo 布局
    let lon, lat;
    if (feature.geometry && feature.geometry.coordinates) {
      // 假设坐标是 [lon, lat] (GeoJSON 标准)
      [lon, lat] = feature.geometry.coordinates;
    }

    return {
      name,
      weight, // 传递权重给 worker
      lon, lat, // 传递坐标
      x: width / 2, // 初始位置
      y: height / 2,
      originalIndex: index, // 保持原始索引以便反查
    };
  }).filter(t => t.name && t.name.trim() !== '');

  console.log('[TagCloud] 名称提取后数量:', tags.length);

  // 削减非常大的数据集以保持 DOM 大小可控
  if (tags.length > MAX_TAGS) {
    // 按密度排序后选取前 MAX_TAGS 个，保留最重要的节点
    const tempTags = calculateDensityGrid(tags, 64, width, height);
    tempTags.sort((a, b) => b.normalizedDensity - a.normalizedDensity);
    tags = tempTags.slice(0, MAX_TAGS);
    console.log('[TagCloud] 已削减至上限:', tags.length);
  }

  // 使用网格快速计算近似密度，用于字体大小插值
  if (tags.length <= MAX_TAGS) {
    tags = calculateDensityGrid(tags, 64, width, height);
  }

  // 高亮显示在选中边界内的标签（如果有）
  const rect = getSelectedRect(props.selectedBounds);
  if (rect) {
    tags = tags.map(t => ({
      ...t,
      selected: t.x >= rect.xMin && t.x <= rect.xMax && t.y >= rect.yMin && t.y <= rect.yMax,
    }));
  } else {
    tags = tags.map(t => ({ ...t, selected: false }));
  }

  console.log('[TagCloud] 发送给 Worker 的数据量:', tags.length);
  
  // 传递多边形中心给 worker 用于螺旋算法（确保可序列化）
  const serializablePolygonCenter = (props.polygonCenter && typeof props.polygonCenter.x === 'number' && typeof props.polygonCenter.y === 'number')
    ? { x: props.polygonCenter.x, y: props.polygonCenter.y }
    : { x: width / 2, y: height / 2 };
  
  // 转换配置对象为普通对象
  const plainConfig = props.spiralConfig ? {
    initialDistance: Number(props.spiralConfig.initialDistance ?? 5),
    spiralSpacing: Number(props.spiralConfig.spiralSpacing ?? 8),
    angleStep: Number(props.spiralConfig.angleStep ?? 0.2),
    minTagSpacing: Number(props.spiralConfig.minTagSpacing ?? 25),
    fontMin: 18,
    fontMax: 22
  } : null;
  
  let boundaryPixels = null;
  if (Array.isArray(props.boundaryPolygon) && props.boundaryPolygon.length && props.map) {
    try {
      boundaryPixels = props.boundaryPolygon.map(([lng, lat]) => {
        const coord = fromLonLat([lng, lat]);
        const px = props.map.getPixelFromCoordinate(coord);
        return [px[0], px[1]];
      });
    } catch (e) {
      boundaryPixels = null;
    }
  }
  
  // 净化数据以移除 Vue Proxies，防止 postMessage 克隆错误
  const sanitizedTags = JSON.parse(JSON.stringify(tags));
  const sanitizedCenter = props.circleCenter ? JSON.parse(JSON.stringify(props.circleCenter)) : null;

  worker.postMessage({ 
    tags: sanitizedTags, 
    algorithm, 
    width, 
    height,
    polygonCenter: serializablePolygonCenter,
    config: plainConfig,
    boundary: boundaryPixels,
    // Geo Worker 参数
    center: sanitizedCenter,
  });
};

onMounted(() => {
  initWorker();
  runLayout(props.algorithm);

  // 监听窗口大小调整，防抖动重新布局
  window.addEventListener('resize', resize);
});

// 公开的 resize 方法，供父组件调用（如卷帘调整时）
const resize = () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runLayout(props.algorithm), RESIZE_DEBOUNCE_MS);
};

function scheduleRunLayout() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runLayout(props.algorithm), 80);
}

// 监听属性变化以触发更新
watch([
  () => props.algorithm,
  () => props.data,
  () => props.selectedBounds,
  () => props.polygonCenter,
  () => props.boundaryPolygon,
  () => props.drawMode,
  () => props.circleCenter
], ([newAlgorithm, newData, newBounds, newCenter, newPoly, newMode, newCircleCenter], [oldAlgorithm, oldData, oldBounds, oldCenter, oldPoly, oldMode, oldCircleCenter]) => {
  // 检查是否需要重新初始化 worker (算法改变 或 模式改变)
  const modeChanged = newMode !== oldMode;
  const algChanged = newAlgorithm !== oldAlgorithm;
  
  if (modeChanged || algChanged) {
    initWorker();
  }
  scheduleRunLayout();
});

// 工具函数：获取选择区域矩形（暂时禁用）
function getSelectedRect(bounds) {
  return null; 
}

/**
 * 计算网格密度
 * 将画布划分为网格，统计每个单元格内的点数，用于近似计算局部密度
 * 用于动态调整标签字体大小（密度高的区域字体小，密度低的区域字体大）
 */
function calculateDensityGrid(items, cellSize, width, height) {
  if (!items || items.length === 0) return [];
  const cols = Math.max(1, Math.ceil(width / cellSize));
  const rows = Math.max(1, Math.ceil(height / cellSize));
  const grid = Array.from({ length: rows }, () => Array(cols).fill(0));
  
  // 填充网格计数
  for (const t of items) {
    const ci = Math.min(cols - 1, Math.max(0, Math.floor(t.x / cellSize)));
    const ri = Math.min(rows - 1, Math.max(0, Math.floor(t.y / cellSize)));
    grid[ri][ci] += 1;
  }
  
  // 计算每个点的平滑密度（包含周围3x3网格）
  const densities = items.map(t => {
    const ci = Math.min(cols - 1, Math.max(0, Math.floor(t.x / cellSize)));
    const ri = Math.min(rows - 1, Math.max(0, Math.floor(t.y / cellSize)));
    let sum = 0, count = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = ri + dr, c = ci + dc;
        if (r >= 0 && r < rows && c >= 0 && c < cols) {
          sum += grid[r][c];
          count++;
        }
      }
    }
    return sum / Math.max(1, count);
  });
  const max = Math.max(1, ...densities);
  // 归一化密度，用于调整字体大小
  return items.map((t, i) => ({ ...t, normalizedDensity: densities[i] / max }));
}

// 缩放控制方法
const zoomIn = () => {
  if (svgRef) {
    svgRef.transition().duration(300).call(
      d3.zoom().scaleBy, 1.5
    );
  }
};

const zoomOut = () => {
  if (svgRef) {
    svgRef.transition().duration(300).call(
      d3.zoom().scaleBy, 1 / 1.5
    );
  }
};

const resetZoom = () => {
  if (svgRef) {
    currentTransform = d3.zoomIdentity;
    svgRef.transition().duration(300).call(
      d3.zoom().transform, d3.zoomIdentity
    );
  }
};

/**
 * 定位到指定要素 (Center On Feature) - 性能优化版
 * @param {Object} feature - 目标地理要素
 */
const centerOnFeature = (feature) => {
  if (!feature || !svgRef || !zoomBehavior) return;

  // 使用坐标快速查找（O(n) 但不遍历 DOM）
  const targetCoords = feature.geometry?.coordinates;
  if (!targetCoords) return;
  
  let targetD = null;
  for (const tag of cachedLayoutTags) {
    if (tag.lon && tag.lat) {
      const dx = Math.abs(tag.lon - targetCoords[0]);
      const dy = Math.abs(tag.lat - targetCoords[1]);
      if (dx < 0.000001 && dy < 0.000001) {
        targetD = tag;
        break;
      }
    }
  }
  
  if (targetD) {
    const width = tagCloudContainer.value.clientWidth;
    const height = tagCloudContainer.value.clientHeight;
    const scale = 2.0;
    const duration = 500; // 缩短动画时长
    
    const t = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-targetD.x, -targetD.y);
    
    // 使用 requestAnimationFrame 避免阻塞
    requestAnimationFrame(() => {
      svgRef.transition().duration(duration).call(
        zoomBehavior.transform, t
      );
    });
  }
};

// 暴露方法给父组件调用
defineExpose({
  centerOnFeature,
  resize
});
</script>

<style scoped>
.tag-cloud-wrapper {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.tag-cloud-container {
  width: 100%;
  height: 100%;
  background-color: #001018; /* 深海蓝背景 */
}

/* 性能优化: 启用 GPU 加速和减少重绘 */
.tag-cloud-container :deep(svg) {
  will-change: transform;
  contain: layout style paint;
  touch-action: none; /* 优化触摸事件 */
}

.tag-cloud-container :deep(g.zoom-group) {
  will-change: transform;
}

.tag-cloud-container :deep(g.main-group) {
  will-change: transform;
}

.tag-cloud-container :deep(text) {
  /* 减少文本渲染开销 */
  text-rendering: optimizeSpeed;
  font-kerning: none;
  shape-rendering: optimizeSpeed;
  /* 禁用可能导致重排的属性 */
  pointer-events: auto;
  user-select: none;
}

.zoom-controls {
  position: absolute;
  bottom: 20px;
  right: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(0, 0, 0, 0.5);
  padding: 8px;
  border-radius: 8px;
  z-index: 10;
}

.zoom-btn {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.1);
  color: white;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}

.zoom-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}
</style>
