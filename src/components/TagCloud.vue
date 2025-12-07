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
  hoveredFeatureId: Object, // 当前被高亮的 Feature 对象（来自地图交互）
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
    console.log('[TagCloud] 收到来自 Worker 的标签数据:', tags);

    const svg = d3.select(tagCloudContainer.value).select('svg');
    const root = svg.select('g.main-group');
    rootGroupRef = root; // 更新引用，用于后续的高亮操作
    const zoomGroup = svg.select('g.zoom-group');

    if (svg.empty() || root.empty() || zoomGroup.empty()) {
      console.error('[TagCloud] 错误: 在 worker.onmessage 期间未找到 SVG、主组或缩放组。');
      return;
    }

    // 使用 D3 的数据绑定机制 (Join pattern) 更新 DOM
    // key 函数使用 name-originalIndex 确保唯一性，避免复用错误的 DOM 元素
    const texts = root
      .selectAll('text')
      .data(tags, (d) => (d.name ? `${d.name}-${d.originalIndex}` : `${d.originalIndex}`));

    // 处理进入、更新和退出选择集
    texts.join(
      // Enter: 处理新添加的节点
      enter => enter.append('text')
        .attr('text-anchor', 'middle') // 文本居中对齐
        .text(d => d.name)
        .attr('dy', '.35em') // 垂直居中微调
        // 根据密度计算字体大小，如果 worker 未返回 fontSize 则使用默认插值
        .style('font-size', d => `${(d.fontSize || (8 + (1 - d.normalizedDensity) * (24 - 8)))}px`)
        .style('fill', d => {
           if (d.isCenter) return '#FFA500'; // 中心标签显示为橙色
           return d.selected ? '#d23' : '#bfeaf1'; // 选中为红色，普通为淡蓝色
        })
        .style('font-weight', d => d.isCenter ? '900' : (d.selected ? '700' : '400'))
        .style('cursor', 'pointer') // 添加手型光标
        // 初始位置和旋转
        .attr('transform', d => `translate(${d.x}, ${d.y}) rotate(${d.rotation || 0})`)
        // 交互事件监听
        .on('mouseover', (event, d) => {
           if (d.isCenter) return; // 忽略中心标签
           const feature = props.data[d.originalIndex];
           emit('hover-feature', feature); // 触发悬停事件，通知父组件
        })
        .on('mouseout', (event, d) => {
           if (d.isCenter) return;
           emit('hover-feature', null); // 鼠标移出，清除悬停状态
        })
        .on('click', (event, d) => {
           event.stopPropagation();
           if (d.isCenter) return;
           const feature = props.data[d.originalIndex];
           emit('locate-feature', feature); // 触发定位事件
        }),
      // Update: 处理现有节点的更新（如位置变化）
      update => update
        .transition().duration(250) // 添加平滑过渡动画
        .style('font-size', d => `${(d.fontSize || (8 + (1 - d.normalizedDensity) * (24 - 8)))}px`)
        .style('fill', d => {
           if (d.isCenter) return '#FFA500';
           return d.selected ? '#d23' : '#bfeaf1';
        })
        .style('font-weight', d => d.isCenter ? '900' : (d.selected ? '700' : '400'))
        .attr('transform', d => `translate(${d.x}, ${d.y}) rotate(${d.rotation || 0})`)
        ,
      // Exit: 处理删除的节点
      exit => exit.remove()
    );
    
    // 应用当前的高亮状态（如果存在）
    if (props.hoveredFeatureId) {
      updateHighlight(props.hoveredFeatureId);
    }
  };
}

/**
 * 更新标签的高亮样式
 * 当地图上的 POI 被悬停时，对应的高亮右侧标签云中的文字
 * @param {Object} hoveredFeature - 当前悬停的地理要素对象
 */
function updateHighlight(hoveredFeature) {
  if (!rootGroupRef || rootGroupRef.empty()) return;
  
  rootGroupRef.selectAll('text')
    .transition().duration(200)
    .style('fill', d => {
      if (d.isCenter) return '#FFA500';
      if (!props.data || !props.data[d.originalIndex]) return d.selected ? '#d23' : '#bfeaf1';
      const feature = props.data[d.originalIndex];
      // 鲁棒的匹配策略：先比较引用，再比较名称和坐标
      let isHovered = feature === hoveredFeature;
      if (!isHovered && feature && hoveredFeature) {
         const getName = (f) => f?.properties?.['名称'] ?? f?.properties?.name ?? f?.properties?.Name ?? '';
         const n1 = getName(feature);
         const n2 = getName(hoveredFeature);
         if (n1 && n2 && n1 === n2) {
            const c1 = feature.geometry?.coordinates;
            const c2 = hoveredFeature.geometry?.coordinates;
            if (c1 && c2) {
               // 坐标浮点数比较，使用极小值 epsilon
               const dx = Math.abs(c1[0] - c2[0]);
               const dy = Math.abs(c1[1] - c2[1]);
               if (dx < 0.000001 && dy < 0.000001) isHovered = true;
            }
         }
      }
      return isHovered ? 'orange' : (d.selected ? '#d23' : '#bfeaf1');
    })
    .style('font-weight', d => {
      if (d.isCenter) return '900';
      if (!props.data || !props.data[d.originalIndex]) return d.selected ? '700' : '400';
      const feature = props.data[d.originalIndex];
      const isHovered = feature === hoveredFeature;
      return isHovered ? 'bold' : (d.selected ? '700' : '400');
    });
}

// 监听 props.hoveredFeatureId 变化，实时更新高亮
watch(() => props.hoveredFeatureId, (newVal) => {
  updateHighlight(newVal);
});

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

  // 设置缩放行为 (Zoom Behavior) 如果尚未设置
    if (!svgRef || !zoomGroupRef) {
      zoomBehavior = d3.zoom()
        .scaleExtent([MIN_SCALE, MAX_SCALE]) // 设置缩放范围
        .on('zoom', (event) => {
          currentTransform = event.transform;
          zoomGroup.attr('transform', currentTransform); // 应用变换
        });

      svg.call(zoomBehavior);
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
 * 定位到指定要素 (Center On Feature)
 * 当用户在地图上点击某个 POI 时，标签云视图会自动缩放并定位到对应的标签
 * @param {Object} feature - 目标地理要素
 */
const centerOnFeature = (feature) => {
  if (!feature || !rootGroupRef || rootGroupRef.empty() || !svgRef) {
    console.warn('[TagCloud] centerOnFeature: 缺少 feature 或 D3 引用');
    return;
  }

  console.log('[TagCloud] centerOnFeature 被调用，目标:', feature.properties?.name || feature.id);

  // 查找对应的标签数据
  let targetD = null;
  
  // 遍历所有文本节点寻找匹配项
  rootGroupRef.selectAll('text').each(function(d) {
    const feat = props.data[d.originalIndex];
    if (feat === feature) {
      targetD = d;
    } else if (feat && feature) {
      // 辅助函数获取名称
      const getName = (f) => f?.properties?.['名称'] ?? f?.properties?.name ?? f?.properties?.Name ?? '';
      const name1 = getName(feat);
      const name2 = getName(feature);
      
      if (name1 && name2 && name1 === name2) {
         // 二次检查坐标，使用 epsilon
         const c1 = feat.geometry?.coordinates;
         const c2 = feature.geometry?.coordinates;
         if (c1 && c2) {
            const dx = Math.abs(c1[0] - c2[0]);
            const dy = Math.abs(c1[1] - c2[1]);
            // 使用小 epsilon 进行浮点比较
            if (dx < 0.000001 && dy < 0.000001) {
               targetD = d;
            }
         }
      }
    }
  });
  
  if (targetD) {
    console.log('[TagCloud] 找到目标标签:', targetD.name);
    const width = tagCloudContainer.value.clientWidth;
    const height = tagCloudContainer.value.clientHeight;
    // 放大比例 2.0，时长 1000ms
    const scale = 2.0; 
    const duration = 1000; 
    
    // 计算变换矩阵以将目标居中
    const t = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-targetD.x, -targetD.y);
      
    if (zoomBehavior) {
      svgRef.transition().duration(duration).call(
        zoomBehavior.transform, t
      );
    }
  } else {
    console.warn('[TagCloud] 未找到目标标签，可能被过滤或未显示');
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
