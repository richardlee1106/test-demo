<template>
  <div id="app" class="app-layout">
    <!-- 桌面端顶部栏 -->
    <header class="fixed-top-header desktop-only-flex">
      <div class="header-left">
        <ControlPanel ref="controlPanelRefMap"
                      panel-type="map"
                      @data-loaded="handleDataLoaded"
                      @search="handleSearch"
                      @clear-search="handleClearSearch"
                      @save-result="handleSaveResult"
                      @loading-change="isLoading = $event" />
      </div>
      <div class="header-right">
        <ControlPanel ref="controlPanelRefTag"
                      panel-type="tag"
                      @toggle-draw="handleToggleDraw"
                      @debug-show="handleDebugShow"
                      @reset="handleReset"
                      @save-result="handleSaveResult"
                      @vector-polygon-uploaded="handleVectorPolygonUploaded"
                      :on-run-algorithm="handleRunAlgorithm" />
      </div>
    </header>

    <header class="mobile-header mobile-only-block">
      <ControlPanel ref="controlPanelRefMobile"
                    panel-type="mobile"
                    @data-loaded="handleDataLoaded"
                    @toggle-draw="handleToggleDraw"
                    @debug-show="handleDebugShow"
                    @reset="handleReset"
                    @search="handleSearch"
                    @clear-search="handleClearSearch"
                    @save-result="handleSaveResult"
                    @loading-change="isLoading = $event"
                    :on-run-algorithm="handleRunAlgorithm" />
    </header>
    <main 
      class="bottom-split" 
      :class="{ 'ai-expanded': aiExpanded }"
      v-loading="isLoading" 
      element-loading-text="正在加载数据..."
      element-loading-background="rgba(0, 0, 0, 0.7)"
    >
      <!-- 默认模式：左右分布 | AI展开模式：左侧上下分布 -->
      <section class="left-section" :style="leftSectionStyle">
        <!-- 地图面板 -->
        <div class="map-panel" :style="mapPanelStyle">
          <div class="panel-content">
            <MapContainer ref="mapComponent" 
                          :poi-features="allPoiFeatures" 
                          :hovered-feature-id="hoveredFeatureId"
                          @polygon-completed="handlePolygonCompleted" 
                          @map-ready="handleMapReady"
                          @hover-feature="handleFeatureHover"
                          @click-feature="handleFeatureClick"
                          @map-move-end="handleMapMoveEnd"
                          @toggle-filter="handleToggleFilter"
                          @toggle-overlay="handleToggleOverlay"
                          @weight-change="handleWeightChange"
                          @global-analysis-change="handleGlobalAnalysisChange" />
          </div>
        </div>
        
        <!-- 分隔条：默认模式垂直 | AI展开模式水平 -->
        <div :class="aiExpanded ? 'splitter-horizontal' : 'splitter-inner'" 
             @mousedown="aiExpanded ? startDragH() : startDrag1()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path v-if="aiExpanded" d="M12 8l5 5H7zM12 16l-5-5h10z" />
            <path v-else d="M8 12l-5 5 5 5V7zM16 12l5-5-5-5v10z" />
          </svg>
        </div>
        
        <!-- 标签云面板 -->
        <div class="tag-panel" :style="tagPanelStyle">
          <div class="panel-content">
            <TagCloud ref="tagCloudRef"
                      :data="filteredTagData" 
                      :map="map" 
                      :algorithm="selectedAlgorithm" 
                      :selectedBounds="selectedBounds" 
                      :polygonCenter="polygonCenter" 
                      :spiralConfig="spiralConfig" 
                      :boundaryPolygon="selectedPolygon"
                      :hovered-feature-id="hoveredFeatureId"
                      :clicked-feature-id="clickedFeatureId"
                      :draw-mode="selectedDrawMode"
                      :circle-center="circleCenterGeo"
                      :weight-enabled="weightEnabled"
                      :show-weight-value="showWeightValue"
                      @hover-feature="handleFeatureHover"
                      @locate-feature="handleFeatureLocate" />
          </div>
        </div>
      </section>
      
      <!-- AI 分隔条（AI展开时显示） -->
      <div v-if="aiExpanded" class="splitter splitter-ai" @mousedown="startDrag2">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
        </svg>
      </div>
      
      <!-- 右侧面板：AI 对话（使用 v-show 保持状态） -->
      <section v-show="aiExpanded" class="right-panel ai-panel" :style="{ width: `${100 - aiSplitPercent}%` }">
        <div class="panel-content">
          <AiChat ref="aiChatRef" 
                  :poi-features="selectedFeatures" 
                  :boundary-polygon="selectedPolygon"
                  :draw-mode="selectedDrawMode"
                  :circle-center="circleCenterGeo"
                  :map-bounds="mapBounds"
                  :global-analysis-enabled="globalAnalysisEnabled"
                  @close="toggleAiPanel"
                  @render-to-tagcloud="handleRenderAIResult" />
        </div>
      </section>
    </main>
    
    <!-- AI 助手浮动按钮（AI收起时显示） -->
    <div v-if="!aiExpanded" class="ai-fab" @click="toggleAiPanel">
      <div class="ai-fab-icon">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
        </svg>
      </div>
      <span class="ai-fab-text">标签云AI助手</span>
      <div class="ai-fab-badge" v-if="selectedFeatures.length > 0">{{ selectedFeatures.length }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, shallowRef, onMounted, nextTick, computed } from 'vue';
import { ElMessage } from 'element-plus';
import ControlPanel from './components/ControlPanel.vue';
import TagCloud from './components/TagCloud.vue';
import MapContainer from './components/MapContainer.vue';
import AiChat from './components/AiChat.vue';
import { semanticSearch } from './utils/aiService';

// 组件引用
// 组件引用
const controlPanelRefMap = ref(null);
const controlPanelRefTag = ref(null);
const controlPanelRefMobile = ref(null);
const tagCloudRef = ref(null);
const mapComponent = ref(null);
const aiChatRef = ref(null);

// 核心数据状态
const map = shallowRef(null); // OpenLayers 地图实例
const tagData = shallowRef([]); // 传递给 TagCloud 的数据（优化：使用 shallowRef）
const selectedAlgorithm = ref('basic'); // 当前选择的布局算法
const spiralConfig = ref(null); // 螺旋布局配置
const selectedBounds = ref(null); // 选中区域的边界
const allPoiFeatures = shallowRef([]); // 所有加载的 POI 数据（优化：使用 shallowRef）
const selectedFeatures = shallowRef([]); // 当前选中的 POI 集合（优化：使用 shallowRef）
const polygonCenter = ref(null); // 选中多边形的中心点（屏幕像素坐标）
const selectedPolygon = ref(null); // 选中多边形的经纬度坐标数组

// 交互状态
const hoveredFeatureId = ref(null); // 当前悬停的要素（用于联动高亮）
const clickedFeatureId = ref(null); // 当前点击的要素（常亮状态）
const filterEnabled = ref(false); // 是否开启实时视野过滤

const mapBounds = ref(null); // 当前地图视野边界 [minLon, minLat, maxLon, maxLat]
const isLoading = ref(false); // 全局/区域加载状态

// 绘图模式状态
const selectedDrawMode = ref(''); // 存储当前的绘图模式 ('Polygon' 或 'Circle')
const circleCenterGeo = ref(null); // 存储圆心经纬度（用于地理布局校正）

// Splitter 状态
const splitPercentage1 = ref(50);  // 默认模式：地图占 50%
const isDragging1 = ref(false);
const isDragging2 = ref(false);
const isDraggingH = ref(false);  // 水平分隔条拖拽状态

// AI 面板状态
const aiExpanded = ref(false);  // AI 面板是否展开
const aiSplitPercent = ref(50);  // AI 展开时左侧区域占比 (0-100%)
const hSplitPercent = ref(50);   // AI 展开时地图和标签云的垂直比例

// 左侧区域样式（计算属性）
const leftSectionStyle = computed(() => {
  if (aiExpanded.value) {
    return { width: `${aiSplitPercent.value}%` };
  } else {
    return { width: '100%' };
  }
});

// 地图面板样式
const mapPanelStyle = computed(() => {
  if (aiExpanded.value) {
    // AI展开时：上下分布，按 hSplitPercent 分配高度
    return { 
      height: `calc(${hSplitPercent.value}% - 5px)`,
      width: '100%'
    };
  } else {
    // 默认模式：左右分布，按 splitPercentage1 分配宽度
    return { 
      width: `calc(${splitPercentage1.value}% - 5px)`,
      height: '100%'
    };
  }
});

// 标签云面板样式
const tagPanelStyle = computed(() => {
  if (aiExpanded.value) {
    // AI展开时：上下分布
    return { 
      height: `calc(${100 - hSplitPercent.value}% - 5px)`,
      width: '100%'
    };
  } else {
    // 默认模式：左右分布
    return { 
      width: `calc(${100 - splitPercentage1.value}% - 5px)`,
      height: '100%'
    };
  }
});

// 切换 AI 面板
function toggleAiPanel() {
  aiExpanded.value = !aiExpanded.value;
  
  // 展开时重置为50%分布
  if (aiExpanded.value) {
    aiSplitPercent.value = 50;
    hSplitPercent.value = 50;
  }
  
  // 切换后需要多次触发 resize 确保布局正确
  nextTick(() => {
    handleResize();
    // 延迟再次触发以确保标签云正确渲染
    setTimeout(() => {
      handleResize();
      if (tagCloudRef.value && typeof tagCloudRef.value.resize === 'function') {
        tagCloudRef.value.resize();
      }
    }, 100);
    setTimeout(() => handleResize(), 300);
  });
}

// 叠加模式状态
const activeGroups = ref([]); // [{ name: 'A', features: [] }, ...]
const overlayEnabled = ref(false);

// 权重渲染状态
const weightEnabled = ref(false); // 是否启用权重渲染
const showWeightValue = ref(false); // 是否显示权重值

// 全域感知模式（开启后 AI 将综合分析所有类别 POI）
const globalAnalysisEnabled = ref(false);

/**
 * 节流函数工具
 * 用于限制高频事件（如地图移动）的触发频率
 * @param {Function} func - 需要节流的函数
 * @param {number} limit - 时间间隔（毫秒）
 */
function throttle(func, limit) {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  }
}

/**
 * 计算属性：过滤后的标签数据
 * 如果开启了实时过滤，则只显示当前地图视野内的 POI
 * 否则显示所有 tagData 中的数据（通常是绘图选中的数据）
 */
const filteredTagData = computed(() => {
  if (!filterEnabled.value || !mapBounds.value) {
    return tagData.value;
  }
  const bounds = mapBounds.value; // [minLon, minLat, maxLon, maxLat]
  return tagData.value.filter(f => {
    const [lon, lat] = f.geometry.coordinates;
    return lon >= bounds[0] && lon <= bounds[2] && lat >= bounds[1] && lat <= bounds[3];
  });
});

onMounted(() => {
  window.addEventListener('resize', handleResize);
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup', stopDrag);

  // 初始化标签云为空数据；用户需要显式加载数据
  tagData.value = [];
});

// 处理窗口大小调整，更新地图尺寸
const handleResize = () => {
  if (map.value && typeof map.value.updateSize === 'function') {
    map.value.updateSize();
  }
  if (tagCloudRef.value && typeof tagCloudRef.value.resize === 'function') {
    tagCloudRef.value.resize();
  }
};

/**
 * 处理运行算法请求
 * 当用户在控制面板点击"生成词云"时触发
 * @param {Object|string} payload - 包含算法名称和配置的对象，或仅算法名称字符串
 */
const handleRunAlgorithm = (payload) => {
  const algorithm = typeof payload === 'string' ? payload : payload?.algorithm;
  selectedAlgorithm.value = algorithm || 'spiral';
  spiralConfig.value = typeof payload === 'object' ? payload?.config || null : null;
  
  // 如果当前模式是 'Circle'，TagCloud 组件会根据 selectedDrawMode 自动处理
  // 这里主要确保数据源是最新的选中数据
  
  console.log('[App] 选中的要素:', selectedFeatures.value);
  console.log('[App] 地图对象:', map.value); 
  tagData.value = selectedFeatures.value;
};

/**
 * 处理数据加载完成
 * 当用户上传文件或加载预设数据后触发
 * @param {Object} payload - { success, name, features }
 */
const handleDataLoaded = (payload) => {
  if (payload && payload.success && payload.features) {
    const newGroup = { name: payload.name, features: payload.features };
    
    if (!overlayEnabled.value) {
      // 覆盖模式：替换所有
      activeGroups.value = [newGroup];
    } else {
      // 叠加模式：追加
      const exists = activeGroups.value.find(g => g.name === payload.name);
      if (!exists) {
        activeGroups.value.push(newGroup);
      } else {
        Object.assign(exists, newGroup);
      }
    }
    
    updateAllPoiFeatures();
    
    // 注意：这里只加载数据，不自动渲染红点
    // 用户需要通过绘制选区来触发 POI 渲染
    // 这符合原始设计：选择器选择类别 → 加载数据 → 绘制选区 → 渲染选区内 POI
    
    console.log(`[App] 数据已加载: 当前 ${activeGroups.value.length} 个分组，共 ${allPoiFeatures.value.length} 个 POI (未渲染，等待选区)`);
  }
};

/**
 * 更新所有 POI 特征，合并所有活动分组并分配颜色索引
 */
function updateAllPoiFeatures() {
  let merged = [];
  activeGroups.value.forEach((group, index) => {
    // 为每个 feature 添加 _groupIndex 属性
    const taggedFeatures = group.features.map(f => {
      const newProps = { ...f.properties, _groupIndex: index };
      return { ...f, properties: newProps };
    });
    merged = merged.concat(taggedFeatures);
  });
  allPoiFeatures.value = merged;
  
  // MapContainer 组件会自动监听 poiFeatures 变化并根据当前 geometry 重新筛选
}

const handleToggleOverlay = (val) => {
  overlayEnabled.value = val;
  if (!val && activeGroups.value.length > 1) {
    // 如果关闭叠加，保留最后一个选中的
    activeGroups.value = [activeGroups.value[activeGroups.value.length - 1]];
    updateAllPoiFeatures();
  }
};

/**
 * 处理权重变化事件
 * @param {Object} payload - { enabled, showValue, weightType?, needLoad? }
 */
async function handleWeightChange(payload) {
  console.log('[App] 权重变化:', payload);
  
  weightEnabled.value = payload.enabled;
  showWeightValue.value = payload.showValue;
  
  // 如果需要加载栅格
  if (payload.needLoad && payload.enabled) {
    if (!tagCloudRef.value) {
      ElMessage.error('标签云组件未就绪');
      return;
    }
    
    ElMessage.info('正在加载人口密度栅格数据...');
    
    try {
      const success = await tagCloudRef.value.loadRaster();
      if (success) {
        ElMessage.success('人口密度栅格加载成功！权重渲染已启用');
      } else {
        ElMessage.error('栅格加载失败，请检查文件路径');
        weightEnabled.value = false;
      }
    } catch (error) {
      console.error('[App] 栅格加载失败:', error);
      ElMessage.error('栅格加载失败');
      weightEnabled.value = false;
    }
  }
}



const handleSearch = async (keyword) => {
  if (!keyword || !keyword.trim()) {
    // 恢复显示所有选中点
    tagData.value = selectedFeatures.value;
    if (mapComponent.value) {
      mapComponent.value.showHighlights(selectedFeatures.value, { full: true });
    }
    // 通知子组件无搜索结果
    if (controlPanelRefMap.value?.setSearchResult) controlPanelRefMap.value.setSearchResult(false);
    return;
  }
  
  // 显示 loading 提示
  ElMessage.info('正在进行 AI 语义搜索，请稍候...');
  
  try {
    // 调用 AI 语义搜索 (传入当前空间上下文)
    // 优先使用绘制/上传的多边形选区，其次是当前地图视野
    const spatialContext = {
      viewport: mapBounds.value,
      boundary: selectedPolygon.value, // 修正字段名匹配后端 Executor
      mode: selectedPolygon.value ? 'Polygon' : 'Viewport'
    };
    
    // 传入 colorIndex: 0 (红色)，表示这是常规查询结果，非 AI 推荐
    const filtered = await semanticSearch(keyword.trim(), [], { 
      spatialContext,
      colorIndex: 0 
    });
    
    tagData.value = filtered;
    if (mapComponent.value) {
      mapComponent.value.showHighlights(filtered, { fitView: true });
    }
    
    if (filtered.length > 0) {
      ElMessage.success(`AI 语义搜索完成，找到 ${filtered.length} 条相关信息！`);
      // 通知子组件有搜索结果
      if (controlPanelRefMap.value?.setSearchResult) controlPanelRefMap.value.setSearchResult(true);
    } else {
      ElMessage.warning(`未找到与「${keyword}」语义相关的 POI`);
      if (controlPanelRefMap.value?.setSearchResult) controlPanelRefMap.value.setSearchResult(false);
    }
  } catch (error) {
    console.error('[App] AI 语义搜索失败:', error);
    ElMessage.error('AI 语义搜索失败，请稍后重试');
    if (controlPanelRefMap.value?.setSearchResult) controlPanelRefMap.value.setSearchResult(false);
  }
};

const handleClearSearch = () => {
  // 恢复显示所有选中点
  tagData.value = selectedFeatures.value;
  // 通知子组件清除搜索结果
  if (controlPanelRefMap.value?.setSearchResult) controlPanelRefMap.value.setSearchResult(false);
  if (mapComponent.value) {
    mapComponent.value.showHighlights(selectedFeatures.value, { fitView: true });
  }
  ElMessage.info('已清除查询结果');
};

/**
 * 保存筛选结果为 CSV 文件
 * 优先级逻辑：
 * 1. 如果有搜索/筛选后的 tagData（标签云数据），保存 tagData
 * 2. 如果没有 tagData 但有 selectedFeatures（绘制工具选中的点），保存 selectedFeatures
 * 3. 如果都没有，则没有可保存的数据
 */
function handleSaveResult() {
  let features = [];
  let dataSource = '';
  
  console.log('[App] 保存检查 - tagData:', tagData.value?.length, 
              'selectedFeatures:', selectedFeatures.value?.length,
              'filteredTagData:', filteredTagData.value?.length);

  // 优先级 1: 如果开启了视野过滤且有数据
  if (filterEnabled.value && filteredTagData.value && filteredTagData.value.length > 0) {
    features = filteredTagData.value;
    dataSource = '视野内筛选';
  }
  // 优先级 2: 标签云/搜索结果数据
  else if (tagData.value && tagData.value.length > 0) {
    features = tagData.value;
    dataSource = '标签云数据';
  }
  // 优先级 3: 绘制工具选中的点（地图上高亮显示的点）
  else if (selectedFeatures.value && selectedFeatures.value.length > 0) {
    features = selectedFeatures.value;
    dataSource = '绘制选中区域';
  }
  // 优先级 4: 所有加载的数据
  else if (allPoiFeatures.value && allPoiFeatures.value.length > 0) {
    features = allPoiFeatures.value;
    dataSource = '全部加载数据';
  }
  
  if (!features || features.length === 0) {
    ElMessage.warning('没有可保存的筛选结果');
    return;
  }
  
  // 构建 CSV 内容
  const headers = ['名称', '大类', '中类', '小类', '经度', '纬度'];
  let csvContent = headers.join(',') + '\n';
  
  features.forEach(f => {
    const props = f.properties || {};
    const coords = f.geometry?.coordinates || ['', ''];
    const name = (props['名称'] || props.name || '').replace(/,/g, '，').replace(/"/g, '""');
    const bigCategory = (props['大类'] || props.category || '').replace(/,/g, '，');
    const midCategory = (props['中类'] || props.subcategory || '').replace(/,/g, '，');
    const smallCategory = (props['小类'] || '').replace(/,/g, '，');
    csvContent += `"${name}","${bigCategory}","${midCategory}","${smallCategory}",${coords[0]},${coords[1]}\n`;
  });
  
  // 创建并下载文件
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `POI_${dataSource}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  
  ElMessage.success(`已保存 ${features.length} 条 POI 数据 (${dataSource})`);
}

// 第一个分隔条拖拽处理（默认模式：地图 | 标签云）
const startDrag1 = () => {
  isDragging1.value = true;
  document.body.style.cursor = 'col-resize';
};

// 第二个分隔条拖拽处理（AI展开模式：左侧区域 | AI）
const startDrag2 = () => {
  isDragging2.value = true;
  document.body.style.cursor = 'col-resize';
};

// 水平分隔条拖拽处理（AI展开模式：地图 | 标签云 上下分布）
const startDragH = () => {
  isDraggingH.value = true;
  document.body.style.cursor = 'row-resize';
};

const onDrag = (e) => {
  const containerWidth = document.body.clientWidth;
  const containerHeight = document.body.clientHeight - 50; // 减去 header 高度
  
  if (isDragging1.value) {
    // 默认模式：调整地图和标签云的左右比例
    let percentage = (e.clientX / containerWidth) * 100;
    percentage = Math.max(20, Math.min(80, percentage));
    splitPercentage1.value = percentage;
    handleResize();
  } else if (isDragging2.value) {
    // AI展开模式：调整左侧区域和AI面板的比例
    let percentage = (e.clientX / containerWidth) * 100;
    percentage = Math.max(30, Math.min(75, percentage));
    aiSplitPercent.value = percentage;
    handleResize();
  } else if (isDraggingH.value) {
    // AI展开模式：调整地图和标签云的上下比例
    const mainTop = 50; // header 高度
    let percentage = ((e.clientY - mainTop) / containerHeight) * 100;
    percentage = Math.max(25, Math.min(75, percentage));
    hSplitPercent.value = percentage;
    handleResize();
  }
};

const stopDrag = () => {
  isDragging1.value = false;
  isDragging2.value = false;
  isDraggingH.value = false;
  document.body.style.cursor = '';
  handleResize();
};

/**
 * 处理开启/关闭绘制模式
 * @param {Object|boolean} payload - 包含模式信息的对象或布尔值(旧版)
 */
const handleToggleDraw = (payload) => {
  if (!mapComponent.value) return;
  
  // 支持布尔值（旧版兼容）和对象负载
  const enabled = (typeof payload === 'object') ? payload.active : payload;
  const mode = (typeof payload === 'object') ? payload.mode : 'Polygon';

  if (enabled) {
    console.log(`[App] 开启绘制模式: ${mode}`);
    mapComponent.value.openPolygonDraw(mode);
  } else {
    console.log('[App] 关闭绘制模式');
    mapComponent.value.closePolygonDraw();
  }
};

/**
 * 处理实时过滤开关切换
 * @param {boolean} enabled - 是否开启
 */
const handleToggleFilter = (enabled) => {
  filterEnabled.value = enabled;
  console.log('[App] 实时过滤状态:', enabled ? '开启' : '关闭');
  if (!enabled) {
    // 关闭时重置或保持当前状态
  } else {
    // 开启时可能需要立即触发一次更新
    if (mapComponent.value) {
       // mapComponent.value.emitBounds(); // 如果需要立即更新边界
    }
  }
};

/**
 * 处理全域感知模式切换
 * @param {boolean} enabled 
 */
const handleGlobalAnalysisChange = (enabled) => {
  globalAnalysisEnabled.value = enabled;
  console.log('[App] 全域感知模式:', enabled ? '开启' : '关闭');
};

/**
 * 处理地图移动结束
 * 使用节流函数限制频率，更新地图边界用于实时过滤
 */
const handleMapMoveEnd = throttle((bounds) => {
  mapBounds.value = bounds;
  // console.log('[App] 地图边界更新:', bounds);
}, 500); // 每500ms最多触发一次

/**
 * 处理要素悬停
 * 实现 MapContainer 和 TagCloud 之间的联动高亮
 * @param {Object|string} id - 悬停的要素或其 ID
 */
const handleFeatureHover = (id) => {
  hoveredFeatureId.value = id;
};

/**
 * 处理要素点击
 * 当在地图上点击要素时，对应标签橙色常亮（无定位动画）
 * @param {Object} feature - 被点击的要素对象
 */
const handleFeatureClick = (feature) => {
  console.log('[App] 处理要素点击:', feature);
  // 设置点击状态（常亮），不受悬浮状态影响
  clickedFeatureId.value = feature;
};

/**
 * 处理要素定位请求
 * 当在 TagCloud 点击标签时，只有地图飞向该 POI
 * @param {Object} feature - 目标要素对象
 */
const handleFeatureLocate = (feature) => {
  console.log('[App] 定位到地图要素');
  
  // 1. 更新高亮状态（橙色高亮）
  hoveredFeatureId.value = feature;
  
  // 2. 地图飞向该 POI（TagCloud 不动）
  if (mapComponent.value) {
    mapComponent.value.flyTo(feature);
  }
};

/**
 * 处理多边形/圆形绘制完成
 * 接收地图组件筛选出的 POI 数据
 * 注意：绘制完成后仅保存选中数据，不自动渲染标签云
 * 用户需要点击"渲染标签云"按钮才会渲染
 * @param {Object} payload - { polygon, center, selected, type, circleCenter }
 */
const handlePolygonCompleted = (payload) => {
  const inside = Array.isArray(payload?.selected) ? payload.selected : [];
  selectedFeatures.value = inside;
  // 注意：不再自动设置 tagData，需要用户点击"渲染标签云"按钮
  // tagData.value = inside;
  
  polygonCenter.value = payload?.center || null;
  selectedPolygon.value = Array.isArray(payload?.polygon) ? payload.polygon : null;
  
  // 存储绘图模式特定的数据
  selectedDrawMode.value = payload?.type || 'Polygon';
  circleCenterGeo.value = payload?.circleCenter || null;
  
  console.log(`[App] 绘制完成 (${selectedDrawMode.value}). 选中 ${inside.length} 个要素，等待用户点击渲染按钮`);
  
  // 同步控制面板状态（自动关闭绘制按钮状态）
  if (controlPanelRefTag.value) {
    controlPanelRefTag.value.setDrawEnabled(false);
  }
  if (controlPanelRefMobile.value) {
    controlPanelRefMobile.value.setDrawEnabled(false);
  }
  
  if (!inside.length) {
    ElMessage.warning('该区域内没有任何信息！');
  } else {
    ElMessage.success(`已选中 ${inside.length} 个POI，点击"渲染标签云"按钮进行渲染`);
  }
};

/**
 * 处理地图初始化完成
 * 获取 OpenLayers 地图实例引用
 */
const handleMapReady = (mapInstance) => {
  console.log('[App] 地图初始化完成:', mapInstance);
  map.value = mapInstance;
};

/**
 * 调试显示：渲染当前分组的所有 POI 为高亮
 */
function handleDebugShow(groupName) {
  if (!allPoiFeatures.value.length) {
    ElMessage.warning('请先加载地理语义分组数据');
    return;
  }
  console.log('[App] 调试显示所有要素');
  mapComponent.value.showHighlights(allPoiFeatures.value, { full: true });
  selectedFeatures.value = allPoiFeatures.value;
}

/**
 * 处理上传的矢量面文件
 * 将上传的 GeoJSON 多边形渲染到地图上，并筛选 POI
 */
// 处理上传的矢量面文件
function handleVectorPolygonUploaded(feature) {
  console.log('[App] 收到上传的矢量面要素:', feature);
  
  if (!feature || !feature.geometry) {
    ElMessage.error('无效的面要素');
    return;
  }
  
  // 获取多边形坐标
  const geomType = feature.geometry.type;
  let coordinates;
  
  if (geomType === 'Polygon') {
    coordinates = feature.geometry.coordinates[0]; // 取外环
  } else if (geomType === 'MultiPolygon') {
    coordinates = feature.geometry.coordinates[0][0]; // 取第一个多边形的外环
  } else {
    ElMessage.error('不支持的几何类型: ' + geomType);
    return;
  }
  
  // 调用 MapContainer 来渲染多边形并触发筛选
  // 注意：MapContainer 内部现在会自动触发 onPolygonComplete，从而发射 polygon-completed 事件
  // 所以这里不需要再手动计算筛选结果
  if (mapComponent.value && mapComponent.value.addUploadedPolygon) {
    mapComponent.value.addUploadedPolygon(coordinates);
    ElMessage.success('已应用选区，正在筛选...');
  } else {
    ElMessage.warning('地图组件未就绪');
  }
}

/**
 * 处理 AI 请求渲染到标签云
 * @param {Array} data - POI 名称数组 或 GeoJSON Feature 数组
 */
function handleRenderAIResult(data) {
  if (!data || data.length === 0) return;
  
  let featuresToRender = [];

  // 情况1: 传递的是 Feature 数组 (后端搜索结果)
  if (typeof data[0] === 'object' && data[0].type === 'Feature') {
    featuresToRender = data;
    console.log('[App] 渲染外部 POI 数据:', featuresToRender.length);
  } 
  // 情况2: 传递的是名称数组 (遗留逻辑)
  else if (typeof data[0] === 'string') {
    const nameSet = new Set(data);
    featuresToRender = allPoiFeatures.value.filter(p => 
      p.properties && (nameSet.has(p.properties['名称']) || nameSet.has(p.properties.name))
    );
    
    if (featuresToRender.length === 0) {
      ElMessage.warning('未在当前数据中找到匹配的 POI');
      return;
    }
  }

  // 更新选中数据
  selectedFeatures.value = featuresToRender;
  // 关键修复：同时更新 tagData，确保标签云组件能够渲染这些数据
  tagData.value = featuresToRender;
  
  // 对于搜索结果，强制设置为第5组颜色（紫色），以区分常规数据
  featuresToRender.forEach(f => {
    if (f.properties) f.properties._groupIndex = 4;
  });

  // 联动地图高亮
  if (mapComponent.value) {
    // 如果是外部数据，可能需要在地图上额外绘制
    mapComponent.value.showHighlights(featuresToRender, { 
      fitView: true,
      clearPrevious: true 
    });
  }
  
  ElMessage.success(`已将 ${featuresToRender.length} 个结果渲染到标签云`);
}



/**
 * 初始化：清空所有数据
 * 重置所有状态到初始值
 */
function handleReset() {
  // 清空标签云数据
  tagData.value = [];
  selectedFeatures.value = [];
  polygonCenter.value = null;
  selectedPolygon.value = null;
  hoveredFeatureId.value = null;
  
  // 重置绘图模式状态
  selectedDrawMode.value = '';
  circleCenterGeo.value = null;

  // 清空地图上的多边形和高亮
  if (mapComponent.value) {
    mapComponent.value.clearPolygon();
    mapComponent.value.closePolygonDraw(); // 确保停止绘制
  }
  
  // 重置控制面板状态
  // 重置控制面板状态
  if (controlPanelRefTag.value) {
    controlPanelRefTag.value.setDrawEnabled(false);
  }
  if (controlPanelRefMobile.value) {
    controlPanelRefMobile.value.setDrawEnabled(false);
  }
  
  console.log('[App] 已重置所有数据');
  ElMessage.success('已清空所有数据');
}
</script>

<style>
html, body, #app {
  height: 100vh;
  width: 100vw;
  margin: 0;
  overflow: hidden;
}

.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

/* .top-controls 已移除 */

.fixed-top-header {
  flex: 0 0 auto;
  display: flex;
  width: 100%;
  background: #333;
  z-index: 2000;
  border-bottom: 1px solid #444;
}

.header-left {
  width: 53%;
  box-sizing: border-box;
}

.header-right {
  width: 47%;
  box-sizing: border-box;
}

.mobile-header {
  flex: 0 0 auto;
  width: 100%;
  background: #333;
  z-index: 2000;
  border-bottom: 1px solid #444;
  min-height: 50px;
}

.desktop-only-flex {
  display: flex;
}

.mobile-only-block {
  display: none;
}

@media (max-width: 768px) {
  .desktop-only-flex {
    display: none !important;
  }
  .mobile-only-block {
    display: block !important;
  }
  
  .fixed-top-header {
    display: none;
  }
}

.bottom-split {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
  z-index: 1;
}

/* 左侧区域（包含地图和标签云） */
.left-section {
  display: flex;
  flex-direction: row; /* 默认模式：左右分布 */
  height: 100%;
  overflow: hidden;
}

.bottom-split.ai-expanded .left-section {
  flex-direction: column; /* AI展开模式：上下分布 */
}

/* 地图面板 */
.map-panel {
  overflow: hidden;
  background: #000;
  display: flex;
  flex-direction: column;
}

/* 标签云面板 */
.tag-panel {
  overflow: hidden;
  background: #001018;
  display: flex;
  flex-direction: column;
}

/* 右侧AI面板 */
.right-panel { 
  height: 100%; 
  overflow: hidden; 
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: linear-gradient(180deg, #0a0f1a 0%, #111827 100%);
}

.ai-panel {
  border-left: 1px solid rgba(99, 102, 241, 0.3);
}

.panel-content {
  flex: 1;
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 100%;
}

/* 垂直分隔条 */
.splitter {
  width: 10px;
  background: linear-gradient(180deg, #2c3e50 0%, #1a252f 100%);
  cursor: col-resize;
  z-index: 10;
  transition: all 0.2s;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
}
.splitter:hover, .splitter:active {
  background: linear-gradient(180deg, #3498db 0%, #2980b9 100%);
  color: #fff;
}

/* 内部分隔条（在 left-section 内部，用于地图和标签云之间） */
.splitter-inner {
  width: 10px;
  min-width: 10px;
  height: 100%;
  background: linear-gradient(180deg, #4c1d95 0%, #312e81 100%);
  cursor: col-resize;
  z-index: 10;
  transition: all 0.2s;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #a5b4fc;
}
.splitter-inner:hover, .splitter-inner:active {
  background: linear-gradient(180deg, #7c3aed 0%, #6366f1 100%);
  color: #fff;
}

/* AI 分隔条特殊样式 */
.splitter-ai {
  background: linear-gradient(180deg, #4c1d95 0%, #312e81 100%);
}
.splitter-ai:hover, .splitter-ai:active {
  background: linear-gradient(180deg, #7c3aed 0%, #6366f1 100%);
}

/* 水平分隔条 */
.splitter-horizontal {
  height: 10px;
  width: 100%;
  background: linear-gradient(90deg, #4c1d95 0%, #312e81 100%);
  cursor: row-resize;
  z-index: 10;
  transition: all 0.2s;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #a5b4fc;
}
.splitter-horizontal:hover, .splitter-horizontal:active {
  background: linear-gradient(90deg, #7c3aed 0%, #6366f1 100%);
  color: #fff;
}

/* AI 浮动按钮 */
.ai-fab {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-radius: 50px;
  color: white;
  cursor: pointer;
  z-index: 1000;
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.5);
  transition: all 0.3s ease;
  animation: fabPulse 2s infinite;
}

.ai-fab:hover {
  transform: translateX(-50%) scale(1.05);
  box-shadow: 0 6px 30px rgba(99, 102, 241, 0.7);
}

@keyframes fabPulse {
  0%, 100% { box-shadow: 0 4px 20px rgba(99, 102, 241, 0.5); }
  50% { box-shadow: 0 4px 30px rgba(139, 92, 246, 0.7); }
}

.ai-fab-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ai-fab-text {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}

.ai-fab-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  background: #ef4444;
  border-radius: 11px;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #0a0f1a;
}

@media (max-width: 768px) {
  .bottom-split {
    flex-direction: column;
  }
  
  /* 移动端默认模式：地图和标签云上下布局 */
  .left-section {
    width: 100% !important;
    height: 100%;
    flex-direction: column !important;
  }
  
  .map-panel, .tag-panel {
    width: 100% !important;
    height: 50% !important;
    flex: none !important;
  }
  
  /* 移动端展开AI时：隐藏地图和标签云 */
  .bottom-split.ai-expanded .left-section {
    display: none !important;
  }
  
  .bottom-split.ai-expanded .right-panel {
    width: 100% !important;
    height: 100% !important;
    flex: 1;
  }
  
  .right-panel {
    width: 100% !important;
    height: auto;
    flex: 1;
  }
  
  /* 隐藏分隔条 */
  .splitter, .splitter-horizontal, .splitter-inner, .splitter-ai {
    display: none !important;
  }
  
  .ai-panel {
    border-left: none;
    border-top: none;
  }
  
  .ai-fab {
    bottom: 16px;
    padding: 10px 16px;
  }
  .ai-fab-text {
    font-size: 13px;
  }
}
</style>
