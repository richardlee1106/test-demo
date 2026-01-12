<template>
  <div class="control-panel">
    <div v-if="isMapPanel" class="left-controls" :class="{ 'full-width': isMapPanel }">
      <div class="select-group">
        <el-cascader
          v-model="selectedCategoryPath"
          :options="categoryOptions"
          :props="{ checkStrictly: true, expandTrigger: 'hover' }"
          placeholder="请先按照语义选择类别"
          @change="handleCascaderChange"
          class="group-select glass-cascader"
          popper-class="poi-cascader-popper"
          :teleported="false"
          :show-all-levels="false"
          filterable
          clearable
        >
          <template #default="{ node, data }">
            <span>{{ data.label }}</span>
            <span v-if="!node.isLeaf"> ({{ data.children.length }}) </span>
          </template>
        </el-cascader>
      </div>

      <div class="search-box">
        <button 
          class="primary-btn desktop-btn" 
          :class="{ 'warning-btn': hasSearchResult }"
          @click="handleSemanticQueryClick"
        >
          {{ hasSearchResult ? '清除查询结果' : '语义查询' }}
        </button>
        <button class="save-btn desktop-save-btn" @click="handleSaveResult">保存筛选结果</button>
      </div>
    </div>

    <!-- 语义查询弹窗 -->
    <el-dialog
      v-model="searchDialogVisible"
      title="AI 语义查询"
      width="400px"
      :close-on-click-modal="false"
    >
      <div class="search-dialog-content">
        <el-input
          v-model="searchKeyword"
          placeholder="输入关键词，如：奶茶、火锅、便利店..."
          class="search-input-dialog"
          clearable
          @keyup.enter="confirmSearch"
        />
        <p class="search-tip">AI 将根据语义智能匹配相关 POI，支持品牌名、类别等模糊搜索。</p>
      </div>
      <template #footer>
        <el-button @click="searchDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmSearch" :loading="isSearching">确定</el-button>
      </template>
    </el-dialog>

    <!-- 移动端顶部栏 -->
    <div class="mobile-top-bar mobile-only">
      <el-cascader
        v-model="selectedCategoryPath"
        :options="categoryOptions"
        :props="{ checkStrictly: true }"
        placeholder="请先按照语义选择类别"
        @change="handleCascaderChange"
        class="group-select mobile-select glass-cascader"
        :teleported="false"
        :show-all-levels="false"
      />
      <div class="mobile-btn-group">
        <button class="save-btn" @click="handleSaveResultMobile">保存筛选结果</button>
        <button class="more-btn" @click="toggleMobileMenu">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="white">
            <circle cx="12" cy="12" r="2" />
            <circle cx="6" cy="12" r="2" />
            <circle cx="18" cy="12" r="2" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 移动端菜单遮罩层 -->
    <div
      v-if="showMobileMenu"
      class="mobile-menu-overlay"
      @click.self="showMobileMenu = false"
    >
      <div class="mobile-menu-content">
        <div class="menu-item" @click="handleMobileSemanticQuery">
          <span>{{ hasSearchResult ? '清除查询' : '语义查询' }}</span>
        </div>
        <div class="menu-divider"></div>
        
        <div
          class="menu-item"
          v-if="!drawEnabled"
          @click="handleDrawModeChange('Polygon')"
        >
          <span>绘制多边形</span>
        </div>
        <div
          class="menu-item"
          v-if="!drawEnabled"
          @click="handleDrawModeChange('Circle')"
        >
          <span>绘制圆形</span>
        </div>
        <div class="menu-item" v-else @click="stopDraw">
          <span>停止绘制</span>
        </div>

        <div class="menu-divider"></div>
        <div class="menu-item" @click="run">
          <span>渲染标签云</span>
        </div>
        <div class="menu-item" @click="reset">
          <span>初始化</span>
        </div>
      </div>
    </div>

    <!-- 移动端搜索弹窗（与桌面端共用同一个 el-dialog） -->

    <div v-if="isTagPanel" class="right-controls" :class="{ 'full-width': isTagPanel }">
      <!-- 搜索控件已移动到左侧 -->

      <!-- 实时过滤控件已移动到 MapContainer -->


      <!-- <el-button type="success" @click="debugShow">调试显示</el-button> -->
      <el-select
        v-if="!drawEnabled"
        v-model="selectedDrawMode"
        placeholder="绘制"
        class="control-btn draw-select"
        @change="handleDrawModeChange"
      >
        <el-option label="绘制多边形" value="Polygon" />
        <el-option label="绘制圆形（中心型）" value="Circle" />
      </el-select>
      <button v-else @click="stopDraw" class="warning-btn desktop-btn control-btn">
        停止绘制
      </button>
      <button @click="run" class="success-btn desktop-btn control-btn">
        渲染标签云
      </button>
      <button @click="reset" class="info-btn desktop-btn control-btn">
        初始化
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import DataLoaderWorker from '../workers/dataLoader.worker.js?worker';

const emit = defineEmits(['data-loaded', 'run-algorithm', 'toggle-draw', 'debug-show', 'reset', 'search', 'clear-search', 'update:currentAlgorithm', 'save-result', 'loading-change']);
// const selectedGroup = ref(''); // Replace with array path
const selectedCategoryPath = ref([]);
const drawEnabled = ref(false);
const selectedDrawMode = ref('');
const searchKeyword = ref('');
const showMobileMenu = ref(false);
const searchDialogVisible = ref(false);
const isSearching = ref(false);
const hasSearchResult = ref(false);
const groupLoading = ref(false);

const props = defineProps({
  onRunAlgorithm: Function,
  searchOffset: { type: Number, default: 0 },
  panelType: { type: String, default: 'map' }, // 'map' (地图) 或 'tag' (标签)
  currentAlgorithm: { type: String, default: 'basic' },
  currentPoiFeatures: { type: Array, default: () => [] } // 当前显示的 POI 数据
});

const isMapPanel = computed(() => props.panelType === 'map');
const isTagPanel = computed(() => props.panelType === 'tag');

// 之前是硬编码的 groups，现在改为从 catalog.json 加载
const categoryOptions = ref([]);

// 全量分类数据（包含3级）
const fullCategoryOptions = ref([]);

// 加载分类目录
onMounted(async () => {
  try {
    const res = await fetch('/split_data/catalog.json');
    if (res.ok) {
      const fullData = (await res.json()).reverse();
      fullCategoryOptions.value = fullData;
      
      // 仅供 UI 显示的选项：截断到第2级（中类），隐藏第3级（小类）
      // 使用递归或映射来构建新的树
      categoryOptions.value = fullData.map(l1 => ({
        ...l1,
        children: l1.children?.map(l2 => ({
          ...l2,
          children: null, // 移除第3级子节点，使 UI 认为这是叶子节点
          leaf: true      // 显式标记为叶子
        }))
      }));
    } else {
      console.error('Failed to load category catalog');
    }
  } catch (error) {
    console.error('Error loading catalog:', error);
  }
});

// 默认使用动态重心引力算法
const localAlgorithm = ref('basic');

const dataWorker = ref(null);

// 辅助函数：根据路径在树中找到节点
const findNode = (options, path) => {
  let currentOptions = options;
  let currentNode = null;
  for (const val of path) {
    currentNode = currentOptions.find(opt => opt.value === val);
    if (!currentNode) return null;
    currentOptions = currentNode.children || [];
  }
  return currentNode;
};

// 辅助函数：获取节点下所有叶子节点的路径
const getAllLeafPaths = (node, currentPath) => {
  if (!node.children || node.children.length === 0) {
    return [currentPath];
  }
  let paths = [];
  for (const child of node.children) {
    paths = paths.concat(getAllLeafPaths(child, [...currentPath, child.value]));
  }
  return paths;
};

const handleCascaderChange = () => {
  const path = selectedCategoryPath.value;
  if (!path || path.length === 0) return;

  emit('loading-change', true);

  if (!dataWorker.value) {
    dataWorker.value = new DataLoaderWorker();
    
    dataWorker.value.onmessage = (e) => {
      const { success, name, features, error } = e.data;
      if (success) {
        ElMessage.success(`成功加载！共 ${features.length} 个 POI`);
        emit('data-loaded', { success: true, name, features });
      } else {
        console.error(error);
        ElMessage.error(`加载失败！${name}`);
        emit('data-loaded', { success: false, name, features: [] });
      }
      emit('loading-change', false);
    };
    
    dataWorker.value.onerror = (e) => {
      console.error('Worker error:', e);
      ElMessage.error(`数据加载遇到错误！`);
      emit('loading-change', false);
    };
  }

  // 1. 找到选中的节点 - 注意：这里必须使用 fullCategoryOptions (包含3级结构) 来查找
  // 因为 path 是 [大类, 中类]，我们需要从全量数据中找到对应的中类节点，它下面包含了小类
  const selectedNode = findNode(fullCategoryOptions.value, path);
  
  if (!selectedNode) {
    emit('loading-change', false);
    return;
  }

  // 2. 获取该节点下所有叶子节点（如果是叶子节点则只包含自己）
  // 此时 selectedNode 是真实的"中类"节点，它包含"小类"children
  const leafPaths = getAllLeafPaths(selectedNode, path);

  // 3. 构建 URL 列表
  // 路径格式: [大类, 中类, 小类] -> /split_data/大类/中类/小类.geojson
  const urls = leafPaths.map(p => `/split_data/${p.join('/')}.geojson`);
  
  // 警告：如果选择了大类，可能会加载非常多的文件
  if (urls.length > 50) {
    ElMessage.warning(`正在加载 ${urls.length} 个子分类数据，请稍候...`);
  }

  // 4. 发送给 Worker
  dataWorker.value.postMessage({
    urls: urls,
    name: path.join(' > ')
  });
};

onBeforeUnmount(() => {
  if (dataWorker.value) {
    dataWorker.value.terminate();
  }
});

// 语义查询按钮点击处理
const handleSemanticQueryClick = () => {
  if (hasSearchResult.value) {
    // 有查询结果时，清除结果
    handleClearSearch();
  } else {
    // 没有查询结果时，打开弹窗
    searchDialogVisible.value = true;
  }
};

// 确认搜索
const confirmSearch = async () => {
  if (!searchKeyword.value.trim()) {
    ElMessage.warning('请输入搜索关键词');
    return;
  }
  isSearching.value = true;
  emit('search', searchKeyword.value);
  // 搜索完成后由父组件调用 setSearchResult 更新状态
  searchDialogVisible.value = false;
  isSearching.value = false;
};

const handleClearSearch = () => {
  searchKeyword.value = '';
  hasSearchResult.value = false;
  emit('clear-search');
};

// 保存筛选结果为 CSV
const handleSaveResult = () => {
  emit('save-result');
};

// const props = defineProps({ onRunAlgorithm: Function }); // Merged above



/* 已移除 toggleFilter，因为它已移动 */

const handleDrawModeChange = (mode) => {
  if (!mode) return;
  drawEnabled.value = true;
  emit('toggle-draw', { active: true, mode: mode });
  // 重置选择，以便如果需要可以再次选择，
  // 尽管通常我们在停止之前保持绘制模式。
  // selectedDrawMode.value = ''; // 不要立即重置，否则选择框会消失
  showMobileMenu.value = false; // 选择后关闭菜单
};
const stopDraw = () => {
  drawEnabled.value = false;
  selectedDrawMode.value = ''; // 重置选择
  emit('toggle-draw', { active: false });
  showMobileMenu.value = false;
};

const run = () => {
  if (props.onRunAlgorithm) {
    // 传递当前算法给父组件（或者父组件直接使用自己的状态）
    props.onRunAlgorithm(localAlgorithm.value);
  }
  showMobileMenu.value = false;
};

const reset = () => {
  // 触发reset事件，由父组件处理清空逻辑
  emit('reset');
  showMobileMenu.value = false;
};

const toggleMobileMenu = () => {
  showMobileMenu.value = !showMobileMenu.value;
};

// 移动端语义查询处理
const handleMobileSemanticQuery = () => {
  showMobileMenu.value = false;
  if (hasSearchResult.value) {
    // 有查询结果时，清除结果
    handleClearSearch();
  } else {
    // 没有查询结果时，打开弹窗
    searchDialogVisible.value = true;
  }
};

// 移动端保存筛选结果
const handleSaveResultMobile = () => {
  showMobileMenu.value = false;
  emit('save-result');
};

// 向父组件暴露方法
const setDrawEnabled = (val) => {
  drawEnabled.value = val;
  if (!val) {
    selectedDrawMode.value = '';
  }
};

// 设置搜索结果状态（由父组件调用）
const setSearchResult = (hasResult) => {
  hasSearchResult.value = hasResult;
};

// 设置搜索中状态
const setSearching = (val) => {
  isSearching.value = val;
};

defineExpose({ setDrawEnabled, setSearchResult, setSearching });

/* const debugShow = () => {
  if (!selectedGroup.value) {
    ElMessage.warning('请先选择地理语义分组');
    return;
    }
  emit('debug-show', selectedGroup.value);
}; */
</script>

<style scoped>
.control-panel {
  display: flex;
  width: 100%;
  height: 100%;
}

.left-controls {
  width: 50%;
  display: flex;
  align-items: center;
  justify-content: space-between; /* 将搜索框推到此 50% 容器的右边缘 */
  gap: 16px;
  padding-left: 10px;
  padding-right: 10px; /* 添加内边距以避免紧贴分隔条区域 */
  box-sizing: border-box;
}

.select-group {
  display: flex;
  gap: 16px;
  position: relative; /* 必须添加此项，否则 loading 动画可能飘到屏幕外 */
  min-width: 100px;
}

.right-controls {
  width: 50%;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 16px;
  padding-left: 10px; /* 添加内边距以与分隔条区域分开 */
  padding-right: 10px;
  box-sizing: border-box;
}

/* 适配全宽模式 */
.left-controls.full-width,
.right-controls.full-width {
  width: 100%;
  padding: 8px; /* 增加内边距 */
  min-height: 56px; /* 确保最小高度，允许自适应 */
  background: #333; /* 背景色 */
  display: flex;
  align-items: center;
  flex-wrap: wrap; /* 允许换行 */
}

/* 地图控件 - 左对齐（默认） */
.left-controls.full-width {
  justify-content: flex-start;
}

/* 标签控件 - 右对齐 */
.right-controls.full-width {
  justify-content: flex-end;
}

/* 优化 loading 覆盖层圆角 */
:deep(.el-loading-mask) {
  border-radius: 4px;
}
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  /* margin-right: auto; 已移除 */
}

.search-input {
  width: 160px;
}

.group-select {
  width: 280px;
}

/* 级联选择器下拉面板样式 (teleported=false 后生效) */
:deep(.el-cascader__dropdown),
:deep(.el-popper) {
  min-width: 400px;
}

:deep(.el-cascader-panel) {
  min-width: 400px;
}

/* 下拉菜单高度：自适应内容，仅限制最大高度 */
:deep(.el-cascader-menu) {
  min-width: 200px;
  height: auto;
  max-height: 60vh; /* 最大不超过视口60% */
}

:deep(.el-cascader-menu .el-scrollbar__wrap) {
  height: auto;
  max-height: calc(60vh - 10px);
}

/* 彻底隐藏级联选择器中的单选圆圈 */
:deep(.el-cascader-node .el-radio),
:deep(.el-cascader-node .el-radio__input),
:deep(.el-cascader-node .el-radio__inner) {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
  margin: 0 !important;
  visibility: hidden !important;
}

/* 选中项样式 */
:deep(.el-cascader-node.is-active > .el-cascader-node__content) {
  font-weight: bold;
  color: var(--el-color-primary);
}

/* 节点内容左侧间距（补偿圆圈消失） */
:deep(.el-cascader-node__content) {
  padding-left: 12px !important;
}

:deep(.el-cascader-node__label) {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.draw-select {
  width: 120px;
}

/* 语义查询弹窗样式 */
.search-dialog-content {
  padding: 10px 0;
}

.search-input-dialog {
  width: 100%;
}

.search-tip {
  margin-top: 12px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}

.control-btn {
  min-width: 80px;
}

.mobile-only {
  display: none;
}

/* 移动端菜单样式 */
.mobile-top-bar {
  display: none; /* 桌面端默认隐藏 */
  width: 100%;
  align-items: center;
  justify-content: space-between; /* 左右两端对齐 */
  gap: 8px;
  padding: 0 8px;
  box-sizing: border-box;
}

/* 按钮组容器 - 固定在右侧 */
.mobile-btn-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* 通用按钮基础样式 (用于保持一致性) */
/* 通用按钮基础样式 (用于保持一致性) */
.primary-btn, .warning-btn, .success-btn, .info-btn, .save-btn {
  flex-shrink: 0;
  border: none;
  border-radius: 4px;
  color: white;
  font-size: 13px;
  padding: 0 12px;
  cursor: pointer;
  white-space: nowrap;
  font-weight: 500;
  line-height: 32px;
  transition: transform 0.15s, box-shadow 0.15s;
  height: 32px;
  display: inline-flex; /* 确保内容垂直居中 */
  align-items: center;
  justify-content: center;
  outline: none; /* 去除点击时的默认轮廓 */
}

.primary-btn {
  background: linear-gradient(135deg, #409eff 0%, #337ecc 100%);
}

.primary-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.4);
}

.primary-btn:active {
  transform: translateY(0);
  opacity: 0.9;
}

.warning-btn {
  background: linear-gradient(135deg, #e6a23c 0%, #d48806 100%);
}

.warning-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(230, 162, 60, 0.4);
}

.success-btn {
  background: linear-gradient(135deg, #67c23a 0%, #529b2e 100%);
}

.success-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(103, 194, 58, 0.4);
}

.info-btn {
  background: linear-gradient(135deg, #909399 0%, #73767a 100%);
}

.info-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(144, 147, 153, 0.4);
}

/* 选择器 UI 优化 (高级感) */
.glass-cascader {
  /* 确保自身背景透明 */
  background: transparent !important;
}

/* 针对内部 wrapper 的样式 */
.glass-cascader :deep(.el-input__wrapper) {
  background: rgba(255, 255, 255, 0.1) !important; /* 半透明背景 */
  backdrop-filter: blur(10px); /* 毛玻璃效果 */
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.3) !important;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1) !important;
  border-radius: 6px !important;
  padding: 0 11px !important;
  transition: all 0.3s ease;
}

/* 悬停状态 */
.glass-cascader:hover :deep(.el-input__wrapper) {
  background: rgba(255, 255, 255, 0.2) !important;
  border-color: rgba(255, 255, 255, 0.5) !important;
}

/* 聚焦状态 */
.glass-cascader :deep(.el-input__wrapper.is-focus) {
  background: rgba(255, 255, 255, 0.25) !important;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.6) inset, 0 4px 12px rgba(0, 0, 0, 0.2) !important;
  border-color: rgba(255, 255, 255, 0.8) !important;
}

/* 输入框文字颜色 */
.glass-cascader :deep(.el-input__inner) {
  color: #fff !important; /* 白色文字适应深色背景 */
  font-weight: 500;
  text-shadow: 0 1px 2px rgba(0,0,0,0.2);
}

/* 占位符颜色 */
.glass-cascader :deep(.el-input__inner::placeholder) {
  color: rgba(255, 255, 255, 0.7) !important;
}

/* 图标颜色 */
.glass-cascader :deep(.el-input__suffix-inner .el-icon) {
  color: rgba(255, 255, 255, 0.8) !important;
}

/* 桌面端按钮通用类 */
.desktop-btn, .desktop-save-btn {
  height: 32px;
  line-height: 32px;
}

/* 移动端保存按钮样式 - 与选择器高度协调 */
.save-btn {
  flex-shrink: 0;
  height: 32px; /* 与 el-cascader 默认高度一致 */
  background: linear-gradient(135deg, #f56c6c 0%, #e6a23c 100%);
  border: none;
  border-radius: 4px;
  color: white;
  font-size: 13px;
  padding: 0 12px;
  cursor: pointer;
  white-space: nowrap;
  font-weight: 500;
  line-height: 32px;
  transition: transform 0.15s, box-shadow 0.15s;
}

.save-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(245, 108, 108, 0.4);
}

.save-btn:active {
  transform: translateY(0);
  opacity: 0.9;
}

/* 桌面端保存按钮特定样式 */
.desktop-save-btn {
  height: 32px;
  line-height: 32px;
}

/* 三点菜单按钮 - 与选择器高度协调 */
.more-btn {
  height: 32px;
  width: 40px;
  background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform 0.15s, box-shadow 0.15s;
}

.more-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(44, 62, 80, 0.4);
}

.more-btn:active {
  transform: translateY(0);
}

.more-btn svg {
  fill: white;
}

/* 移动端菜单遮罩层 - 添加淡入动画 */
.mobile-menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2000;
  display: flex;
  justify-content: flex-end;
  align-items: flex-start; /* 顶部对齐 */
  padding-top: 50px; /* 为顶部栏留出空间 */
  animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 移动端菜单内容 - 自适应高度 */
.mobile-menu-content {
  width: 160px;
  background: linear-gradient(180deg, #ffffff 0%, #f8f9fa 100%);
  height: auto; /* 自适应内容高度 */
  max-height: calc(100vh - 100px); /* 最大高度，留边距 */
  padding: 16px 0;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  animation: slideInRight 0.25s ease-out;
  border-radius: 12px; /* 四边圆角 */
  margin-right: 8px; /* 右侧边距 */
  margin-top: 8px; /* 顶部边距 */
  overflow-y: auto; /* 内容过多时可滚动 */
}

@keyframes slideInRight {
  from { 
    transform: translateX(100%);
    opacity: 0;
  }
  to { 
    transform: translateX(0);
    opacity: 1;
  }
}

.menu-item {
  padding: 14px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  font-size: 15px;
  color: #333;
  transition: background 0.15s, padding-left 0.15s;
}

.menu-item:hover {
  background: linear-gradient(90deg, #f0f4ff 0%, #ffffff 100%);
  padding-left: 24px;
}

.menu-item:active {
  background: #e8ecf0;
}

.menu-icon {
  font-size: 18px;
  width: 24px;
  text-align: center;
}

.menu-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, #e0e0e0 50%, transparent 100%);
  margin: 10px 16px;
}

/* 搜索浮层样式 */
.search-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 60px; /* 顶部栏区域高度 */
  background: white;
  z-index: 2001;
  display: flex;
  align-items: center;
  padding: 0 8px; /* 稍微减小内边距 */
  box-sizing: border-box; /* 确保 padding 不会撑大 width */
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.search-overlay-content {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 4px; /* 减小间距，让控件更紧凑 */
}

.search-input-overlay {
  flex: 1;
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: #666;
  padding: 4px;
  display: flex;
  align-items: center;
}

@media (max-width: 768px) {
  .desktop-only {
    display: none !important;
  }

  .mobile-only {
    display: flex !important;
  }

  .control-panel {
    flex-direction: row;
    height: auto;
    padding: 8px 0;
    align-items: center;
  }

  /* 移动端顶部栏：选择器左侧自适应，按钮组右侧固定 */
  .mobile-top-bar {
    display: flex !important;
    width: 100%;
    flex-direction: row;
    align-items: center;
    justify-content: space-between; /* 两端对齐 */
    gap: 8px;
    padding: 0 8px;
  }

  /* 选择器占满左侧剩余空间 */
  .mobile-select {
    flex: 1 1 auto; /* 使用 auto 让 flex item 基于内容或宽度伸缩 */
    width: auto !important; /* 强制覆盖 .group-select 的固定宽度 */
    min-width: 0;
    max-width: none;
  }
  
  /* 强制 el-cascader 及其内部 input 占满 */
  .mobile-select :deep(.el-input),
  .mobile-select :deep(.el-input__wrapper) {
    width: 100% !important;
    box-sizing: border-box;
  }

  /* 按钮组固定在右侧 */
  .mobile-btn-group {
    flex-shrink: 0;
  }
}
</style>
