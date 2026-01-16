<template>
  <div class="control-panel">
    <div v-if="isMapPanel" class="left-controls" :class="{ 'full-width': isMapPanel }">
      <div class="select-group">
        <!-- 当前选中路径展示 -->
        <div class="current-category-display" v-if="selectedCategoryPath.length > 0">
          <span class="category-tag">{{ getCategoryLabel(selectedCategoryPath) }}</span>
        </div>
      </div>
    </div>

    <!-- POI 类别选择抽屉 -->
    <el-drawer
      v-model="categoryDrawerVisible"
      title="POI 语义分类选择"
      direction="ltr"
      :size="380"
      append-to-body
      class="category-drawer"
      :modal-class="'category-drawer-modal'"
      :with-header="true"
    >
      <div class="drawer-content">
        <p class="drawer-tip">请选择您感兴趣的地理语义类别：</p>
        <el-cascader
          v-model="selectedCategoryPath"
          :options="categoryOptions"
          :props="{ checkStrictly: true, expandTrigger: 'hover' }"
          placeholder="请选择类别..."
          @change="handleCascaderChange"
          class="group-select glass-cascader drawer-cascader"
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
        
        <div class="drawer-actions">
           <p class="drawer-note">提示：支持拼音搜索，悬停展开子级。</p>
        </div>
      </div>
    </el-drawer>

    <!-- 语义查询弹窗 -->
    <el-dialog
      v-model="searchDialogVisible"
      title="AI 语义查询"
      width="90%"
      append-to-body
      class="mirspatial-dialog responsive-dialog"
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
        <button class="save-btn" @click="handleSaveResultMobile">保存结果</button>
        <button class="more-btn" @click="toggleMobileMenu">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="white">
            <circle cx="12" cy="12" r="2" />
            <circle cx="6" cy="12" r="2" />
            <circle cx="18" cy="12" r="2" />
          </svg>
        </button>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="showMobileMenu"
        class="mobile-menu-overlay"
        @click="showMobileMenu = false"
      >
        <div class="mobile-menu-content" @click.stop>
        <div class="menu-item" @click="handleMobileSemanticQuery">
          <div class="menu-item-icon">
             <svg v-if="!hasSearchResult" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </div>
          <span>{{ hasSearchResult ? '清除查询' : '语义查询' }}</span>
        </div>
        
        <div
          class="menu-item"
          @click="handleDrawModeChange('Polygon')"
        >
          <div class="menu-item-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <span>绘制多边形</span>
        </div>

        <div
          class="menu-item"
          @click="handleDrawModeChange('Circle')"
        >
          <div class="menu-item-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="2" fill="currentColor"/>
            </svg>
          </div>
          <span>绘制圆形</span>
        </div>

        <div class="menu-item" @click="triggerVectorUploadMobile">
          <div class="menu-item-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
            </svg>
          </div>
          <span>上传选区</span>
        </div>

        <div class="menu-item" @click="run">
          <div class="menu-item-icon">
             <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 3l14 9-14 9V3z"/>
            </svg>
          </div>
          <span>渲染词云</span>
        </div>

        <div class="menu-item" @click="reset">
          <div class="menu-item-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
            </svg>
          </div>
          <span>初始化</span>
        </div>
        </div>
      </div>
    </Teleport>

    <!-- 移动端搜索弹窗（与桌面端共用同一个 el-dialog） -->

    <div v-if="isTagPanel" class="right-controls" :class="{ 'full-width': isTagPanel }">
      <!-- 搜索控件已移动到左侧 -->
      <!-- <el-button type="success" @click="debugShow">调试显示</el-button> -->
      <div class="action-group">
        <!-- 隐藏的矢量选区上传文件框 -->
        <input 
          type="file" 
          ref="vectorFileInput" 
          @change="handleVectorFileUpload" 
          accept=".geojson,.json,.shp,.zip"
          style="display: none;"
        />
        
        <el-select
          v-if="!drawEnabled"
          v-model="selectedDrawMode"
          placeholder="空间选区"
          class="control-btn draw-select"
          @change="handleDrawModeChange"
        >
          <template #prefix>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </template>
          <el-option label="多边形" value="Polygon" />
          <el-option label="圆形 (半径型)" value="Circle" />
        </el-select>
        
        <button v-else @click="stopDraw" class="warning-btn stop-draw-btn">
          停止绘制
        </button>
        
        <el-tooltip content="上传矢量选区 (GeoJSON)" placement="bottom">
          <button @click="triggerVectorUpload" class="upload-btn icon-btn">
             <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
            </svg>
          </button>
        </el-tooltip>

        <!-- 侧边栏触发按钮 (移动到右侧) -->
        <el-tooltip content="选择 POI 类别" placement="bottom">
          <button 
            class="primary-btn icon-btn" 
            :class="{ 'active': categoryDrawerVisible }"
            @click="categoryDrawerVisible = true"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
        </el-tooltip>

        <!-- AI 搜索按钮 (移动到右侧) -->
        <el-tooltip content="AI 语义查询" placement="bottom">
          <button 
            class="primary-btn icon-btn" 
            :class="{ 'active': hasSearchResult }"
            @click="handleSemanticQueryClick"
          >
            <svg v-if="!hasSearchResult" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </el-tooltip>

        <div class="command-separator"></div>

        <el-tooltip content="导出 CSV 数据" placement="bottom">
          <button class="save-btn icon-btn" @click="handleSaveResult">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
          </button>
        </el-tooltip>

        <el-tooltip content="系统重置" placement="bottom">
          <button @click="reset" class="info-btn icon-btn">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
            </svg>
          </button>
        </el-tooltip>

        <button @click="run" class="run-btn premium-run-btn">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="margin-right: 4px;">
            <path d="M8 5.14v14c0 .86.94 1.4 1.68.97l10.66-7.33a1.15 1.15 0 0 0 0-1.94L9.68 4.17c-.74-.43-1.68.11-1.68.97z"/>
          </svg>
          渲染词云
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import DataLoaderWorker from '../workers/dataLoader.worker.js?worker';

const emit = defineEmits(['data-loaded', 'run-algorithm', 'toggle-draw', 'debug-show', 'reset', 'search', 'clear-search', 'update:currentAlgorithm', 'save-result', 'loading-change', 'vector-polygon-uploaded']);
// const selectedGroup = ref(''); // Replace with array path
const selectedCategoryPath = ref([]);
const drawEnabled = ref(false);
const selectedDrawMode = ref('');
const searchKeyword = ref('');
const showMobileMenu = ref(false);
const searchDialogVisible = ref(false);
const isSearching = ref(false);
const hasSearchResult = ref(false);
const categoryDrawerVisible = ref(false);
const groupLoading = ref(false);

const props = defineProps({
  onRunAlgorithm: Function,
  searchOffset: { type: Number, default: 0 },
  panelType: { type: String, default: 'map' }, // 'map' (地图) 或 'tag' (标签)
  currentAlgorithm: { type: String, default: 'basic' },
  currentPoiFeatures: { type: Array, default: () => [] } // 当前显示的 POI 数据
});

// 获取当前选中的类别名称（用于在Header显示）
const getCategoryLabel = (path) => {
  if (!path || path.length === 0) return '';
  // 简单实现：只显示最后一级对应的名称，需要遍历树比较麻烦，
  // 这里做个简化：显示最后一级的 value (通常是中文名)
  // 或者如果 options 已经加载，尝试查找 label
  // 为了性能和简单，这里假设 value 就是可读名称，或者用户能接受显示 value
  return path[path.length - 1];
};

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

// ============ 上传矢量面文件功能 ============
const vectorFileInput = ref(null);

// 触发文件选择
const triggerVectorUpload = () => {
  vectorFileInput.value?.click();
};

// 移动端触发上传
const triggerVectorUploadMobile = () => {
  showMobileMenu.value = false;
  triggerVectorUpload();
};

// 处理矢量文件上传
const handleVectorFileUpload = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  
  const fileName = file.name.toLowerCase();
  
  try {
    emit('loading-change', true);
    
    let geojsonData = null;
    
    if (fileName.endsWith('.geojson') || fileName.endsWith('.json')) {
      // 处理 GeoJSON 文件
      const text = await file.text();
      geojsonData = JSON.parse(text);
    } else if (fileName.endsWith('.zip') || fileName.endsWith('.shp')) {
      // Shapefile 需要 shpjs 库解析
      ElMessage.warning('Shapefile 支持正在开发中，请暂时使用 GeoJSON 格式');
      event.target.value = '';
      emit('loading-change', false);
      return;
    } else {
      ElMessage.error('不支持的文件格式，请上传 .geojson 文件');
      event.target.value = '';
      emit('loading-change', false);
      return;
    }
    
    // 验证是否为面要素
    const features = geojsonData.features || (geojsonData.type === 'Feature' ? [geojsonData] : []);
    const polygonFeatures = features.filter(f => 
      f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'
    );
    
    if (polygonFeatures.length === 0) {
      ElMessage.error('上传的文件中没有找到面要素（Polygon），请确保文件包含多边形数据');
      event.target.value = '';
      emit('loading-change', false);
      return;
    }
    
    // 只取第一个面要素作为选区
    const firstPolygon = polygonFeatures[0];
    
    // 发射事件，让父组件处理选区
    emit('vector-polygon-uploaded', firstPolygon);
    
    ElMessage.success(`已加载选区（${polygonFeatures.length} 个面要素，使用第一个）`);
    
  } catch (error) {
    console.error('解析矢量文件失败:', error);
    ElMessage.error('解析文件失败：' + error.message);
  } finally {
    event.target.value = ''; // 清空 input 以便再次选择同一文件
    emit('loading-change', false);
  }
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
  display: flex;
  align-items: center;
  gap: 12px;
}

.select-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.right-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 适配全宽模式 */
.left-controls.full-width,
.right-controls.full-width {
  /* 移除 width: 100%，防止在 flex 布局中撑开容器导致截断 */
  padding: 0;
  min-height: auto;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: flex-end; /* 统统靠右对齐：左组靠分隔线，右组靠屏幕边 */
}

/* 地图控件 - 强制右对齐以靠近中线 */
.left-controls.full-width {
  justify-content: flex-end !important;
}

/* 标签控件 - 强制右对齐以靠近屏边 */
.right-controls.full-width {
  justify-content: flex-end !important;
}

/* 优化 loading 覆盖层圆角 */
:deep(.el-loading-mask) {
  border-radius: 4px;
}
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-group {
  display: flex;
  align-items: center;
  gap: 12px; /* 统一间距 */
}

.command-separator {
  width: 1px;
  height: 24px;
  background: rgba(255, 255, 255, 0.1);
  margin: 0 4px;
}

.icon-btn {
  width: 36px !important;
  height: 36px !important;
  padding: 0 !important;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px !important;
  background: rgba(255, 255, 255, 0.05) !important;
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.1) !important;
  transform: translateY(-1px);
}

.icon-btn.active {
  background: rgba(99, 102, 241, 0.25) !important;
  border-color: rgba(99, 102, 241, 0.6) !important;
  color: #a5b4fc;
  box-shadow: 0 0 15px rgba(99, 102, 241, 0.3);
}

.run-btn.premium-run-btn {
  padding: 0 18px !important;
  font-weight: 700 !important;
  letter-spacing: 0.5px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
  border: none !important;
  color: #fff !important;
  border-radius: 10px !important;
  box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4);
  height: 36px;
  line-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.25s ease;
}

.run-btn.premium-run-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(16, 185, 129, 0.5);
  filter: brightness(1.1);
}

.run-btn.premium-run-btn:active {
  transform: translateY(0);
}

.stop-draw-btn {
  padding: 0 16px !important;
  animation: pulse-red 2s infinite;
}

@keyframes pulse-red {
  0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
  70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
  100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
}

.group-select {
  width: 220px;
}

.draw-select {
  width: 130px;
}

/* 针对内部 wrapper 的样式 (更精致) */
.glass-cascader :deep(.el-input__wrapper),
.draw-select :deep(.el-input__wrapper) {
  background: rgba(15, 23, 42, 0.4) !important;
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  border-radius: 10px !important;
  box-shadow: none !important;
  height: 36px;
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
.primary-btn, .warning-btn, .success-btn, .info-btn, .save-btn, .upload-btn {
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: white;
  font-size: 13px;
  padding: 0 16px;
  cursor: pointer;
  white-space: nowrap;
  font-weight: 600;
  line-height: 36px;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(8px);
}

.primary-btn {
  background: linear-gradient(135deg, rgba(64, 158, 255, 0.8) 0%, rgba(51, 126, 204, 0.8) 100%);
  border-color: rgba(64, 158, 255, 0.4);
}

.primary-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(64, 158, 255, 0.3);
  background: linear-gradient(135deg, rgba(64, 158, 255, 1) 0%, rgba(51, 126, 204, 1) 100%);
}

.warning-btn {
  background: linear-gradient(135deg, rgba(230, 162, 60, 0.8) 0%, rgba(212, 136, 6, 0.8) 100%);
  border-color: rgba(230, 162, 60, 0.4);
}

.warning-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(230, 162, 60, 0.3);
}

.success-btn {
  background: linear-gradient(135deg, rgba(103, 194, 58, 0.8) 0%, rgba(82, 155, 46, 0.8) 100%);
  border-color: rgba(103, 194, 58, 0.4);
}

.success-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(103, 194, 58, 0.3);
}

.info-btn {
  background: linear-gradient(135deg, rgba(144, 147, 153, 0.7) 0%, rgba(115, 118, 122, 0.7) 100%);
  border-color: rgba(144, 147, 153, 0.4);
}

.upload-btn {
  background: linear-gradient(135deg, rgba(155, 89, 182, 0.8) 0%, rgba(142, 68, 173, 0.8) 100%);
  border-color: rgba(155, 89, 182, 0.4);
}

.upload-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(155, 89, 182, 0.5);
}

.upload-btn:active {
  transform: translateY(0);
  opacity: 0.9;
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

/* 移动端菜单遮罩层 - 全屏平铺 */
.mobile-menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  z-index: 9999;
  display: flex;
  justify-content: flex-end; /* 恢复右对齐 */
  align-items: flex-start;
  padding-top: 12px;
  padding-right: 12px;
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
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.15); /* 恢复左侧阴影 */
  display: flex;
  flex-direction: column;
  animation: slideInRight 0.25s ease-out; /* 恢复向左滑动进入 */
  border-radius: 12px; /* 四边圆角 */
  margin-right: 8px; /* 恢复右侧边距 */
  margin-top: 8px; /* 顶部边距 */
  overflow-y: auto; /* 内容过多时可滚动 */
}

@keyframes slideInLeft {
  from { 
    transform: translateX(-100%);
    opacity: 0;
  }
  to { 
    transform: translateX(0);
    opacity: 1;
  }
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
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 64px;
  background: rgba(15, 23, 42, 0.95);
  backdrop-filter: blur(16px);
  z-index: 2001;
  display: flex;
  align-items: center;
  padding: 0 16px;
  box-sizing: border-box;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
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

/* 抽屉内样式适配 */
.drawer-content {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.drawer-tip {
  color: #94a3b8;
  font-size: 14px;
  margin: 0;
}

.drawer-cascader {
  width: 100% !important; /* 强制占满抽屉宽度 */
}

/* 覆盖 glass-cascader 在抽屉里的样式 */
.drawer-cascader :deep(.el-input__wrapper) {
  background: rgba(30, 41, 59, 0.5) !important;
  border: 1px solid rgba(148, 163, 184, 0.2) !important;
}

.drawer-note {
  font-size: 12px;
  color: #64748b;
  margin-top: 8px;
}

/* 当前选中分类的标签显示 */
.current-category-display {
  display: flex;
  align-items: center;
}

.category-tag {
  background: rgba(99, 102, 241, 0.2);
  border: 1px solid rgba(99, 102, 241, 0.4);
  color: #a5b4fc;
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 侧边栏抽屉全局样式覆盖 */
:global(.category-drawer) {
  background: #0f172a !important; /* 深蓝色背景 */
  border-right: 1px solid rgba(99, 102, 241, 0.2) !important;
}

:global(.category-drawer .el-drawer__header) {
  margin-bottom: 0 !important;
  padding: 20px !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  color: #f1f5f9;
}

:global(.category-drawer .el-drawer__title) {
  color: #f1f5f9;
  font-size: 16px;
  font-weight: 600;
}

:global(.category-drawer .el-drawer__body) {
  padding: 0 !important;
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
/* 强制覆盖 el-cascader 面板样式以适应抽屉 */
/* 强制覆盖 el-cascader 面板样式以适应抽屉 */
:global(.category-drawer .el-cascader-panel) {
  width: 100% !important;
  display: flex !important;
  background: transparent !important;
  border: none !important;
}

:global(.category-drawer .el-cascader-menu) {
  width: 50% !important;
  min-width: unset !important;
  flex: 1 1 50% !important;
  box-sizing: border-box !important;
  border-right: 1px solid rgba(255, 255, 255, 0.1) !important;
  background: transparent !important; /* 确保透明，显示 drawer 背景 */
  color: #f1f5f9 !important; /* 白色文字 */
}

:global(.category-drawer .el-cascader-menu__list) {
  background: transparent !important;
  padding: 0 !important;
}

/* 节点样式 */
:global(.category-drawer .el-cascader-node) {
  color: #cbd5e1 !important;
  padding-left: 12px !important;
  height: 40px !important;
  line-height: 40px !important;
}

/* 节点悬停/聚焦 */
:global(.category-drawer .el-cascader-node:not(.is-disabled):focus),
:global(.category-drawer .el-cascader-node:not(.is-disabled):hover) {
  background: rgba(255, 255, 255, 0.08) !important;
  color: #fff !important;
}

/* 选中项高亮 */
:global(.category-drawer .el-cascader-node.is-active) {
  color: #818cf8 !important; /* Indigo-400 */
  font-weight: 600 !important;
  background: rgba(99, 102, 241, 0.15) !important;
}

/* 箭头颜色 */
:global(.category-drawer .el-cascader-node__postfix) {
  color: #94a3b8 !important;
}

/* 下拉容器定位与背景 */
:global(.category-drawer .el-cascader__dropdown) {
  width: 100% !important;
  left: 0 !important;
  right: 0 !important;
  box-shadow: none !important;
  border: none !important;
  background: transparent !important;
  position: relative !important; /* 尝试相对定位，使其嵌入文档流 */
  top: 0 !important;
  margin: 0 !important;
}

/* 隐藏讨厌的 Popper 箭头 (菱形) */
:global(.category-drawer .el-popper__arrow) {
  display: none !important;
}
</style>
