<template>
  <div class="control-panel">
    <div class="left-controls">
      <div class="select-group">
        <el-select v-model="selectedGroup" placeholder="按地理语义分组" @change="handleGroupChange" class="group-select">
          <el-option v-for="item in groups" :key="item.value" :label="item.label" :value="item.value"></el-option>
        </el-select>
        <el-select v-model="selectedAlgorithm" placeholder="算法选择" class="algorithm-select">
          <el-option v-for="item in algorithms" :key="item.value" :label="item.label" :value="item.value"></el-option>
        </el-select>
      </div>
      
      <!-- Search Control Moved Here -->
      <div class="search-box">
        <el-input 
          v-model="searchKeyword" 
          placeholder="输入关键词..." 
          class="search-input"
          clearable
          @keyup.enter="handleSearch"
        />
        <el-button type="primary" @click="handleSearch">查询</el-button>
        <el-button type="info" @click="handleClearSearch" title="清除查询结果">清除查询结果</el-button>
      </div>
    </div>
    
    <div class="right-controls">
      <!-- Search Control Moved to Left -->

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
      <el-button 
        v-else 
        type="warning" 
        @click="stopDraw" 
        class="control-btn"
      >停止绘制</el-button>
      <el-button type="primary" @click="run" class="control-btn">运行</el-button>
      <el-button type="info" @click="reset" class="control-btn">初始化</el-button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import axios from 'axios';
import { ElMessage } from 'element-plus';

const emit = defineEmits(['data-loaded', 'run-algorithm', 'toggle-draw', 'debug-show', 'reset', 'search', 'clear-search']);
const selectedGroup = ref('');
const drawEnabled = ref(false);
const selectedDrawMode = ref('');
const searchKeyword = ref('');

const props = defineProps({ 
  onRunAlgorithm: Function,
  searchOffset: { type: Number, default: 0 }
});

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

const selectedAlgorithm = ref('basic'); // 设置为默认

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

const run = () => {
  if (props.onRunAlgorithm) {
    props.onRunAlgorithm(selectedAlgorithm.value);
  }
};

/* 已移除 toggleFilter，因为它已移动 */

const handleDrawModeChange = (mode) => {
  if (!mode) return;
  drawEnabled.value = true;
  emit('toggle-draw', { active: true, mode: mode });
  // 重置选择，以便如果需要可以再次选择，
  // 尽管通常我们在停止之前保持绘制模式。
  // selectedDrawMode.value = ''; // 不要立即重置，否则选择框会消失
};

const stopDraw = () => {
  drawEnabled.value = false;
  selectedDrawMode.value = ''; // Reset selection
  emit('toggle-draw', { active: false });
};

const reset = () => {
  // 触发reset事件，由父组件处理清空逻辑
  emit('reset');
};

// Expose methods to parent
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
  justify-content: space-between; /* Push search box to the right edge of this 50% container */
  gap: 16px;
  padding-left: 10px;
  padding-right: 10px; /* Add padding to avoid touching the splitter area exactly */
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
  padding-left: 10px; /* Add padding to separate from splitter area */
  padding-right: 10px;
  box-sizing: border-box;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  /* margin-right: auto; Removed */
}

.search-input {
  width: 160px;
}

.group-select, .algorithm-select {
  width: 220px; /* Increased width */
}

.draw-select {
  width: 120px;
}

.control-btn {
  min-width: 80px;
}

@media (max-width: 768px) {
  .control-panel {
    flex-direction: column;
    height: auto;
    gap: 8px;
    width: 100%;
    padding: 4px 0;
  }

  .left-controls, .right-controls {
    flex: unset;
    width: 100%;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    padding: 0;
    gap: 8px;
    flex-wrap: wrap; /* 允许换行 */
  }

  .group-select, .algorithm-select {
    flex: 1 1 140px; /* 允许伸缩，设置最小宽度 */
    width: auto !important; 
    min-width: 140px;
  }

  .draw-select {
    flex: 2; /* 保证能显示“绘制...”文字 */
    width: auto !important;
    min-width: 90px;
    display: block;
    padding: 0;
  }

  .control-btn {
    flex: 1 1 70px; /* 按钮也允许伸缩 */
    min-width: 70px;
    width: auto !important;
    padding: 8px 10px;
    font-size: 13px;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    white-space: nowrap;
  }
}
</style>
