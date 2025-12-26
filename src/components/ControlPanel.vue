<template>
  <div class="control-panel">
    <div v-if="isMapPanel" class="left-controls" :class="{ 'full-width': isMapPanel }">
      <div class="select-group">
        <el-select
          v-model="selectedGroup"
          placeholder="按地理语义分组"
          @change="handleGroupChange"
          class="group-select"
        >
          <el-option
            v-for="item in groups"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          ></el-option>
        </el-select>
        <el-select
          v-model="localAlgorithm"
          placeholder="算法选择"
          class="algorithm-select"
          @change="handleAlgorithmChange"
        >
          <el-option
            v-for="item in algorithms"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          ></el-option>
        </el-select>
      </div>

      <div class="search-box">
        <el-input
          v-model="searchKeyword"
          placeholder="输入关键词..."
          class="search-input"
          clearable
          @keyup.enter="handleSearch"
        />
        <el-button type="primary" @click="handleSearch">查询</el-button>
        <el-button type="info" @click="handleClearSearch" title="清除查询结果"
          >清除查询结果</el-button
        >
      </div>
    </div>

    <!-- 移动端顶部栏 -->
    <div class="mobile-top-bar mobile-only">
      <el-select
        v-model="selectedGroup"
        placeholder="按地理语义分组"
        @change="handleGroupChange"
        class="group-select mobile-select"
      >
        <el-option
          v-for="item in groups"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        ></el-option>
      </el-select>
      <el-select
        v-model="localAlgorithm"
        placeholder="算法选择"
        class="algorithm-select mobile-select"
        @change="handleAlgorithmChange"
      >
        <el-option
          v-for="item in algorithms"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        ></el-option>
      </el-select>
      <button class="more-btn" @click="toggleMobileMenu">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="white">
          <circle cx="12" cy="12" r="2" />
          <circle cx="6" cy="12" r="2" />
          <circle cx="18" cy="12" r="2" />
        </svg>
      </button>
    </div>

    <!-- 移动端菜单遮罩层 -->
    <div
      v-if="showMobileMenu"
      class="mobile-menu-overlay"
      @click.self="showMobileMenu = false"
    >
      <div class="mobile-menu-content">
        <div class="menu-item" @click="openSearchOverlay">
          <span>搜索</span>
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
          <span>运行</span>
        </div>
        <div class="menu-item" @click="reset">
          <span>初始化</span>
        </div>
      </div>
    </div>

    <!-- 搜索浮层 -->
    <div v-if="showSearchOverlay" class="search-overlay">
      <div class="search-overlay-content">
        <el-input
          v-model="searchKeyword"
          placeholder="输入关键词..."
          class="search-input-overlay"
          clearable
          @keyup.enter="handleSearchMobile"
        />
        <el-button type="primary" @click="handleSearchMobile">查询</el-button>
        <el-button type="info" @click="handleClearSearchMobile">清除</el-button>
        <button class="close-btn" @click="showSearchOverlay = false">
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>

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
      <el-button v-else type="warning" @click="stopDraw" class="control-btn"
        >停止绘制</el-button
      >
      <el-button type="primary" @click="run" class="control-btn"
        >渲染标签云</el-button
      >
      <el-button type="info" @click="reset" class="control-btn"
        >初始化</el-button
      >
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import axios from 'axios';
import { ElMessage } from 'element-plus';

const emit = defineEmits(['data-loaded', 'run-algorithm', 'toggle-draw', 'debug-show', 'reset', 'search', 'clear-search', 'update:currentAlgorithm']);
const selectedGroup = ref('');
const drawEnabled = ref(false);
const selectedDrawMode = ref('');
const searchKeyword = ref('');
const showMobileMenu = ref(false);
const showSearchOverlay = ref(false);

const props = defineProps({
  onRunAlgorithm: Function,
  searchOffset: { type: Number, default: 0 },
  panelType: { type: String, default: 'map' }, // 'map' (地图) 或 'tag' (标签)
  currentAlgorithm: { type: String, default: 'basic' }
});

const isMapPanel = computed(() => props.panelType === 'map');
const isTagPanel = computed(() => props.panelType === 'tag');

const groups = ref([
  { value: '餐饮美食', label: '餐饮美食' },
  { value: '公司企业', label: '公司企业' },
  { value: '购物消费', label: '购物消费' },
  { value: '交通设施', label: '交通设施' },
  { value: '金融机构', label: '金融机构' },
  { value: '酒店住宿', label: '酒店住宿' },
  { value: '科教文化', label: '科教文化' },
  { value: '旅游景点', label: '旅游景点' },
  { value: '汽车相关', label: '汽车相关' },
  { value: '商务住宅', label: '商务住宅' },
  { value: '生活服务', label: '生活服务' },
  { value: '休闲娱乐', label: '休闲娱乐' },
  { value: '医疗保健', label: '医疗保健' },
  { value: '运动健身', label: '运动健身' },
]);

const algorithms = ref([
  { value: 'basic', label: '动态重心引力' },
  { value: 'spiral', label: '阿基米德螺线' },
]);

const localAlgorithm = ref(props.currentAlgorithm);

// 监听 props 变化更新本地状态
watch(() => props.currentAlgorithm, (newVal) => {
  localAlgorithm.value = newVal;
});

const handleAlgorithmChange = (val) => {
  emit('update:currentAlgorithm', val);
};

const handleGroupChange = async () => {
  if (!selectedGroup.value) return;
  try {
    const response = await axios.get(`/data/${selectedGroup.value}.geojson`);
    const features = response.data?.features || [];
    ElMessage.success(`成功加载！${selectedGroup.value}`);
    emit('data-loaded', { success: true, name: selectedGroup.value, features });
  } catch (error) {
    ElMessage.error(`加载失败！${selectedGroup.value}`);
    emit('data-loaded', { success: false, name: selectedGroup.value, features: [] });
  }
}

const handleSearch = () => {
  emit('search', searchKeyword.value);
};

const handleClearSearch = () => {
  searchKeyword.value = '';
  emit('clear-search');
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

const openSearchOverlay = () => {
  showMobileMenu.value = false;
  showSearchOverlay.value = true;
};

const handleSearchMobile = () => {
  handleSearch();
  // showSearchOverlay.value = false; // 可选：保留打开以查看结果或关闭？目前保持打开。
};

const handleClearSearchMobile = () => {
  handleClearSearch();
};

// 向父组件暴露方法
const setDrawEnabled = (val) => {
  drawEnabled.value = val;
  if (!val) {
    selectedDrawMode.value = '';
  }
};

defineExpose({ setDrawEnabled });

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

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  /* margin-right: auto; 已移除 */
}

.search-input {
  width: 160px;
}

.group-select,
.algorithm-select {
  width: 200px; /* 减小宽度以适应布局 */
}

.draw-select {
  width: 120px;
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
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px;
  box-sizing: border-box;
}

.more-btn {
  background: none;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
  padding: 4px 8px;
  color: #333;
  display: flex;
  align-items: center;
  justify-content: center;
}

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
}

.mobile-menu-content {
  width: 120px;
  background: white;
  height: 100%;
  padding: 20px 0;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
}

.menu-item {
  padding: 12px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  font-size: 16px;
  color: #333;
}

.menu-item:hover {
  background: #f5f5f5;
}

.menu-icon {
  font-size: 18px;
  width: 24px;
  text-align: center;
}

.menu-divider {
  height: 1px;
  background: #eee;
  margin: 8px 0;
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
    flex-direction: row; /* 顶部栏保持行布局 */
    height: auto;
    padding: 8px 0;
    align-items: center;
  }

  .mobile-select {
    flex: 1;
    min-width: 0; /* 允许收缩 */
  }
}
</style>
