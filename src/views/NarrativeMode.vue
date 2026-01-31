<template>
  <div class="narrative-mode-container">
    <!-- 背景效果层 (来自 Demo) -->
    <div class="bg-gradient"></div>
    <div class="grid-overlay"></div>
    <div class="floating-orb orb-1"></div>
    <div class="floating-orb orb-2"></div>

    <!-- 1. 底层：真实地理地图 -->
    <MapContainer 
      ref="mapRef"
      class="background-map"
      :poiFeatures="poiFeatures"
      :filterEnabled="true"
      :globalAnalysisEnabled="true"
      :showControls="false"
      @map-ready="onMapReady"
      @map-move-end="onMapMove"
    />

    <!-- 2. 中层：Three.js 特效层 (极光描边 & 区域遮罩) -->
    <canvas ref="canvasRef" class="effect-canvas"></canvas>

    <!-- 3. 顶层：UI 控制与解说字幕 -->
    <div class="narrative-ui">
      <!-- 进度指示器 (来自 Demo) -->
      <div v-if="isPlaying && narrativeSteps.length > 0" class="progress-ring-container">
        <svg width="48" height="48" class="progress-ring-svg">
          <circle class="ring-bg" cx="24" cy="24" r="20"/>
          <circle 
            class="ring-progress" 
            cx="24" cy="24" r="20" 
            :style="{ strokeDashoffset: progressOffset }"
          />
        </svg>
        <div class="progress-text">{{ currentStepIndex + 1 }}/{{ narrativeSteps.length }}</div>
      </div>

      <!-- 左侧脚本面板 -->
      <transition name="fade-slide">
        <div v-if="scriptVisible" class="script-panel" :class="{ 'generating': isGenerating }">
          <div class="panel-header">
            <div class="brand-mini">
              <div class="brand-icon-mini">✨</div>
              <div class="brand-text-mini">
                <h1>AI 空间叙事</h1>
                <span>SPACE NARRATIVE</span>
              </div>
            </div>
            <el-button link @click="scriptVisible = false" class="close-btn">
              <el-icon><Close /></el-icon>
            </el-button>
          </div>
          
          <div class="script-content" ref="scriptContentRef">
            <!-- 1. AI 分析报告 (始终优先展示) -->
            <div v-if="aiResponse" class="ai-text-response">
              <div class="response-title">AI 分析报告</div>
              <div class="response-body" v-html="formattedAiResponse"></div>
            </div>

            <!-- 2. 漫游剧本步骤 (紧随报告之后) -->
            <div v-if="narrativeSteps.length > 0" class="narrative-steps-section">
              <div class="response-title">漫游剧本</div>
              <div class="modern-steps">
                <div 
                  v-for="(step, index) in narrativeSteps" 
                  :key="index"
                  class="modern-step-item"
                  :class="{ 'active': currentStepIndex === index, 'finished': currentStepIndex > index }"
                >
                  <div class="step-line"></div>
                  <div class="step-dot"></div>
                  <div class="step-info">
                    <div class="step-label">STEP {{ index + 1 }}</div>
                    <div class="step-title">{{ step.focus === 'overview' ? '区域全景' : step.focus }}</div>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- 3. 空白状态 -->
            <div v-if="!aiResponse && !isGenerating" class="empty-state">
              <div class="empty-icon">🗺️</div>
              <p>点击下方按钮开启空间叙事之旅</p>
            </div>

            <!-- 4. 生成中的 Loading -->
            <div v-if="isGenerating" class="loading-state">
              <div class="loader-spinner-mini"></div>
              <span>正在感知空间并生成叙事流...</span>
            </div>
          </div>

          <div class="panel-footer">
            <div class="action-row">
              <button 
                class="btn-modern btn-generate" 
                :disabled="isGenerating"
                @click="handleGenerate"
              >
                <el-icon v-if="isGenerating" class="is-loading"><Loading /></el-icon>
                <el-icon v-else><MagicStick /></el-icon>
                {{ isGenerating ? 'AI 解析中...' : '生成区域解说' }}
              </button>
              <button 
                v-if="narrativeSteps.length > 0" 
                class="btn-modern btn-play-narrative"
                :class="{ 'playing': isPlaying }"
                @click="playNarrative" 
                :disabled="isPlaying"
              >
                <el-icon><VideoPlay /></el-icon>
                {{ isPlaying ? '播放中' : '开始漫游' }}
              </button>
            </div>
          </div>
        </div>
      </transition>

      <!-- 底部字幕卡片 (来自 Demo) -->
      <transition name="up">
        <div v-if="isPlaying && currentVoiceText" class="subtitle-card">
          <div class="card-glow"></div>
          <div class="district-name-container">
            <span class="district-prefix">NOW FOCUSING</span>
            <h2 class="district-name-text">{{ currentNarrativeFocus }}</h2>
          </div>
          <div class="narrative-text-container">
            <p class="narrative-text">
              {{ typedText }}<span class="typing-cursor"></span>
            </p>
          </div>
          
          <!-- 解说控制栏 -->
          <div class="card-controls">
            <div class="voice-visualizer">
              <div v-for="i in 5" :key="i" class="audio-bar" :style="{ animationDelay: (i * 0.2) + 's' }"></div>
            </div>
          </div>
        </div>
      </transition>
      
      <!-- 右下角设置与返回 -->
      <div class="action-buttons">
        <button class="round-tool-btn" @click="scriptVisible = !scriptVisible" :title="scriptVisible ? '隐藏面板' : '显示面板'">
          <el-icon><View v-if="scriptVisible" /><Hide v-else /></el-icon>
        </button>
        <button class="round-tool-btn danger" @click="goBack" title="返回主页">
          <el-icon><ArrowLeft /></el-icon>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, shallowRef, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import * as THREE from 'three';
import { marked } from 'marked';
import MapContainer from '../components/MapContainer.vue';
import { fromLonLat } from 'ol/proj';

/**
 * ==========================================
 * 1. 状态定义
 * ==========================================
 */
const router = useRouter();
const mapRef = ref(null);
const canvasRef = ref(null);
const poiFeatures = ref([]);
const narrativeSteps = ref([]);
const aiResponse = ref(''); // 存储原始文本回复
const currentStepIndex = ref(-1);
const isGenerating = ref(false);
const isPlaying = ref(false);
const scriptVisible = ref(true);
const currentVoiceText = ref('');
const boundaryData = ref(null);
const scriptContentRef = ref(null); // 用于自动滚动

// 打字机效果相关的状态
const typedText = ref('');
const currentNarrativeFocus = computed(() => {
  if (currentStepIndex.value >= 0 && narrativeSteps.value[currentStepIndex.value]) {
    const focus = narrativeSteps.value[currentStepIndex.value].focus;
    return focus === 'overview' ? '区域概览' : focus;
  }
  return '空间叙事';
});

// 进度环相关的计算
const progressOffset = computed(() => {
  if (narrativeSteps.value.length === 0) return 125.6;
  const progress = (currentStepIndex.value + 1) / narrativeSteps.value.length;
  return 125.6 * (1 - progress);
});

/**
 * 打字机效果函数
 */
let typeInterval = null;
const typeText = (text) => {
  clearInterval(typeInterval);
  typedText.value = '';
  let i = 0;
  typeInterval = setInterval(() => {
    if (i < text.length) {
      typedText.value += text[i];
      i++;
    } else {
      clearInterval(typeInterval);
    }
  }, 50); //打字速度
};

// 监听文本变化，触发打字机效果
watch(currentVoiceText, (newVal) => {
  if (newVal) {
    typeText(newVal.replace(/<[^>]+>/g, '')); // 移除 HTML 标签后再打字
  }
});

// Three.js 实例
const scene = shallowRef(null);
const camera = shallowRef(null);
const renderer = shallowRef(null);
const clock = shallowRef(new THREE.Clock());
const boundaryMesh = shallowRef(null);
const boundaryMaterial = shallowRef(null);
const maskMesh = shallowRef(null); // 背景遮罩
const mapInstance = shallowRef(null);
const spatialClusters = ref([]); // 空间聚类数据
const vernacularRegions = ref([]); // 语义模糊区域数据
const fuzzyRegions = ref([]); // 模糊区域数据（三层边界模型）
const clusterBoundaries = ref([]); // 聚类边界网格数组
const fuzzyRegionMeshes = ref([]); // 模糊区域Three.js网格数组
const isDrawingCluster = ref(false); // 是否正在绘制聚类边界
const currentSubtitle = ref(''); // 当前字幕文本
const subtitleHistory = ref([]); // 字幕历史记录
const isSubtitleVisible = ref(false); // 字幕是否可见
const subtitleContainerRef = ref(null); // 字幕容器引用
const aiPanelRef = ref(null); // AI面板引用（用于碰撞检测）
const subtitlePosition = ref({ x: 0, y: 0 }); // 字幕位置（动态计算）
const subtitleSafeZone = ref({ left: 0, top: 0, right: 0, bottom: 0 }); // 字幕安全区域
const activeRegionIndex = ref(-1); // 当前激活的模糊区域索引
const regionNarrativeSteps = ref([]); // 基于模糊区域的解说步骤

let frameId = null;

const formattedAiResponse = computed(() => {
  // 1. 移除 JSON 代码块 (包括 ```json ... ``` 和 纯 JSON 文本)
  let cleanText = aiResponse.value
    .replace(/```json[\s\S]*?```/g, '') // 移除 markdown json 块
    .replace(/\{[\s\S]*"narrative_flow"[\s\S]*\}/, ''); // 移除裸 json
  
  // 2. 也是为了隐藏可能的残留思考过程
  cleanText = cleanText.replace(/<think>[\s\S]*?<\/think>/g, '');
  
  return marked.parse(cleanText);
});

// 监听 aiResponse 变化，自动滚动到底部
watch(aiResponse, () => {
  nextTick(() => {
    if (scriptContentRef.value) {
      scriptContentRef.value.scrollTop = scriptContentRef.value.scrollHeight;
    }
  });
});

const initThree = () => {
  if (!canvasRef.value) return;

  const width = window.innerWidth;
  const height = window.innerHeight;

  const s = new THREE.Scene();
  const r = new THREE.WebGLRenderer({
    canvas: canvasRef.value,
    alpha: true,
    antialias: true
  });
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  r.setSize(width, height);

  const c = new THREE.OrthographicCamera(0, width, 0, height, 0.1, 1000);
  c.position.z = 10;

  scene.value = s;
  camera.value = c;
  renderer.value = r;

  // 1. 创建全局暗场遮罩 (聚光灯效果的基础)
  const maskGeo = new THREE.PlaneGeometry(width * 2, height * 2);
  const maskMat = new THREE.ShaderMaterial({
    uniforms: {
      uResolution: { value: new THREE.Vector2(width, height) },
      uFocus: { value: new THREE.Vector2(width / 2, height / 2) },
      uRadius: { value: 0.35 },
      uOpacity: { value: 0.6 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec2 uResolution;
      uniform vec2 uFocus;
      uniform float uRadius;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        vec2 st = gl_FragCoord.xy / uResolution;
        vec2 focus = uFocus / uResolution;
        float d = distance(st, focus);
        float mask = smoothstep(uRadius, uRadius + 0.2, d);
        gl_FragColor = vec4(0.0, 0.0, 0.0, mask * uOpacity);
      }
    `,
    transparent: true,
    depthTest: false
  });
  const m = new THREE.Mesh(maskGeo, maskMat);
  m.position.set(width / 2, height / 2, 1);
  s.add(m);
  maskMesh.value = m;

  animate();
};

const handleResize = () => {
  if (!camera.value || !renderer.value) return;
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.value.right = width;
  camera.value.bottom = height;
  camera.value.updateProjectionMatrix();

  renderer.value.setSize(width, height);
  if (maskMesh.value) {
    maskMesh.value.geometry.dispose();
    maskMesh.value.geometry = new THREE.PlaneGeometry(width * 2, height * 2);
    maskMesh.value.position.set(width / 2, height / 2, 1);
    maskMesh.value.material.uniforms.uResolution.value.set(width, height);
    maskMesh.value.material.uniforms.uFocus.value.set(width / 2, height / 2);
  }
};

const cleanupThree = () => {
  if (frameId) cancelAnimationFrame(frameId);
  window.removeEventListener('resize', handleResize);
  if (renderer.value) renderer.value.dispose();
  if (scene.value) {
    scene.value.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }
};

// ==========================================
// 核心修复：每一帧都重新计算几何体坐标
// ==========================================
const syncThreeWithMap = () => {
  if (!mapInstance.value || !scene.value || !camera.value) return;
  
  // 1. 同步边界线 (Aurora Line)
  if (boundaryData.value && boundaryMesh.value) {
    const ring = boundaryData.value.coordinates[0];
    const positions = boundaryMesh.value.geometry.attributes.position;
    const array = positions.array;
    let needsUpdate = false;
    
    // 如果点数不一致（极少情况，除非数据变了），则重新生成几何体
    // 这里我们假设点数在 updateBoundaryLine 初始化后不变，只更新位置
    
    ring.forEach((coord, i) => {
      // 关键：实时将 经纬度 -> 屏幕像素坐标 (Screen Coordinates)
      // 注意：OpenLayers 的像素坐标原点在左上角，Three.js Y轴向上，需反转 Y
      const pixel = mapInstance.value.getPixelFromCoordinate(fromLonLat(coord));
      if (pixel) {
        // 更新 BufferGeometry
        array[i * 3] = pixel[0];     // x
        array[i * 3 + 1] = window.innerHeight - pixel[1]; // y (Three.js 坐标系反转)
        array[i * 3 + 2] = 0;        // z
      }
    });
    
    positions.needsUpdate = true;
    
    // 更新 Uniforms 时间
    if (boundaryMaterial.value) {
      boundaryMaterial.value.uniforms.uTime.value = clock.value.getElapsedTime();
    }

    // 更新遮罩中心
    // 计算当前的边界几何中心屏幕坐标
    let centerX = 0, centerY = 0;
    let count = 0;
    ring.forEach(coord => {
      const pixel = mapInstance.value.getPixelFromCoordinate(fromLonLat(coord));
      if(pixel) {
        centerX += pixel[0];
        centerY += pixel[1];
        count++;
      }
    });
    
    if (count > 0 && maskMesh.value) {
      maskMesh.value.material.uniforms.uFocus.value.set(
        centerX / count, 
        window.innerHeight - (centerY / count) // 反转 Y
      );
    }
  }
};

const animate = () => {
  frameId = requestAnimationFrame(animate);
  
  if (renderer.value && scene.value && camera.value) {
    const time = clock.value.getElapsedTime();
    
    // 1. 每一帧都强制同步坐标 (解决拖动地图没动画的问题)
    syncThreeWithMap();
    
    // 2. 同步聚类边界坐标
    syncClusterBoundaries();

    // 3. 更新遮罩动画
    if (maskMesh.value) {
      maskMesh.value.material.uniforms.uOpacity.value = 0.6 + 0.1 * Math.sin(time * 0.8);
    }
    
    renderer.value.render(scene.value, camera.value);
  }
};

/**
 * 初始化边界线几何体 (仅分配内存)
 */
const updateBoundaryLine = () => {
  if (!boundaryData.value || !scene.value) return;

  if (boundaryMesh.value) {
    scene.value.remove(boundaryMesh.value);
    boundaryMesh.value.geometry.dispose();
  }

  // 初始构建 Geometry
  const ring = boundaryData.value.coordinates[0];
  const points = ring.map(() => new THREE.Vector3(0, 0, 0)); // 只有占位符
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  
  // 确保材质存在 (复用之前的 Shader 逻辑)
  if (!boundaryMaterial.value) {
     boundaryMaterial.value = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color('#00f2ff') }
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec3 vPos;
        void main() {
          // 极光流动颜色变换
          float flow = sin(vPos.x * 0.005 + vPos.y * 0.005 + uTime * 2.0);
          float intensity = 0.5 + 0.5 * flow;
          vec3 finalColor = mix(uColor, vec3(0.5, 0.0, 1.0), 0.3 * flow);
          gl_FragColor = vec4(finalColor, 0.8 * intensity);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false
    });
  }

  const mesh = new THREE.LineLoop(geometry, boundaryMaterial.value);
  // 不再 frustumCulled，避免因为点在屏幕外被剔除导致的闪烁
  mesh.frustumCulled = false; 
  boundaryMesh.value = mesh;
  scene.value.add(mesh);
  
  // 立即同步一次坐标
  syncThreeWithMap();
};

/**
 * ==========================================
 * 4. 业务逻辑
 * ==========================================
 */
const onMapReady = (olMap) => {
  mapInstance.value = olMap;
  initThree();
  window.addEventListener('resize', handleResize);
};

const onMapMove = () => {
  // 坐标同步现在由 animate 循环中的 syncThreeWithMap 自动处理，无需重新创建几何体
};

const handleGenerate = () => {
  // 使用新的三阶段区域解说生成
  generateRegionNarrative();
};

const generateNarrative = async () => {
  if (isGenerating.value) return;
  if (!mapInstance.value) return;
  
  isGenerating.value = true;
  narrativeSteps.value = [];
  aiResponse.value = ''; 
  boundaryData.value = null;
  poiFeatures.value = [];
  
  const view = mapInstance.value.getView();
  const extent = view.calculateExtent(mapInstance.value.getSize());
  const { toLonLat } = await import('ol/proj');
  const bl = toLonLat([extent[0], extent[1]]);
  const tr = toLonLat([extent[2], extent[3]]);
  const viewport = [bl[0], bl[1], tr[0], tr[1]];
  
  try {
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{
          role: 'user', 
          content: "请深度分析当前这片区域。请务必在回答末尾提供 narrative_flow JSON 漫游脚本。"
        }],
        options: {
          spatialContext: { mode: 'global', viewport: viewport }
        }
      })
    });

    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let currentEventType = null;
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue; // 忽略心跳
        
        if (trimmed.startsWith('event: ')) {
          currentEventType = trimmed.slice(7).trim();
        } else if (trimmed.startsWith('data: ')) {
          const content = trimmed.slice(6);
          if (content === '[DONE]') continue;
          
          try {
            if (currentEventType === 'pois') {
              const poisData = JSON.parse(content);
              poiFeatures.value = poisData.map(p => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
                properties: { ...p }
              }));
              console.log('[Narrative] 已同步 POI 数据:', poiFeatures.value.length);
            } else if (currentEventType === 'boundary') {
              boundaryData.value = JSON.parse(content);
              console.log('[Narrative] 已同步边界数据');
              nextTick(updateBoundaryLine);
            } else if (currentEventType === 'spatial_clusters') {
              // 接收空间聚类数据
              const clusterData = JSON.parse(content);
              spatialClusters.value = clusterData.hotspots || [];
              console.log('[Narrative] 已同步空间聚类数据:', spatialClusters.value.length);
              // 自动绘制聚类边界
              nextTick(() => drawClusterBoundaries(spatialClusters.value));
            } else if (currentEventType === 'vernacular_regions') {
              // 接收语义模糊区域数据
              const regionData = JSON.parse(content);
              vernacularRegions.value = regionData || [];
              console.log('[Narrative] 已同步语义区域数据:', vernacularRegions.value.length);
            } else if (currentEventType === 'fuzzy_regions') {
              // 接收模糊区域数据（三层边界模型）
              const fuzzyData = JSON.parse(content);
              fuzzyRegions.value = fuzzyData || [];
              console.log('[Narrative] 已同步模糊区域数据:', fuzzyRegions.value.length);
              // 自动绘制模糊区域
              nextTick(() => drawFuzzyRegions(fuzzyRegions.value));
            } else {
              const data = JSON.parse(content);
              if (data.content) aiResponse.value += data.content;
            }
          } catch (e) {
            // 解析错误可能由不完整的 JSON 块引起
          }
          if (line.endsWith('\n\n')) currentEventType = null; // 重置
        }
      }
    }
    
    console.log('[Narrative] AI 文本生成完成');
    
    // 弹性 JSON 提取：支持多种包裹格式
    const text = aiResponse.value;
    const jsonMatch = text.match(/```json\s*(\{[\s\S]*?\})\s*```/) || text.match(/\{[\s\S]*"narrative_flow"[\s\S]*\}/);
    
    if (jsonMatch) {
      try {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const script = JSON.parse(jsonStr);
        narrativeSteps.value = script.narrative_flow || [];
        console.log('[Narrative] 已成功提取叙事脚本，步数:', narrativeSteps.value.length);
      } catch (e) {
        console.error('[Narrative] JSON 脚本解析失败:', e);
      }
    } else {
      console.warn('[Narrative] 回复中未发现有效的 narrative_flow JSON');
    }
    
  } catch (err) {
    console.error('[Narrative] 网络或执行错误:', err);
  } finally {
    isGenerating.value = false;
  }
};

// 注意：clusterBoundaries 和 isDrawingCluster 已在上方声明，此处不再重复声明

/**
 * 绘制模糊区域（三层边界模型）
 * 核心区 + 过渡带 + 外圈，每层有不同的视觉效果
 */
const drawFuzzyRegions = async (regions) => {
  if (!regions || regions.length === 0 || !scene.value) return;
  
  console.log(`[Narrative] 绘制模糊区域: ${regions.length} 个区域`);
  
  // 清除旧的模糊区域
  clearFuzzyRegions();
  
  // 为每个模糊区域创建三层边界
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    if (!region.layers) continue;
    
    const regionMeshGroup = {
      id: region.id,
      name: region.name,
      core: null,
      transition: null,
      outer: null
    };
    
    // 1. 外圈（最底层，大范围，低透明度）
    if (region.layers.outer?.boundary) {
      regionMeshGroup.outer = createAuroraBoundary(
        region.layers.outer.boundary,
        i,
        'outer',
        { r: 0.0, g: 0.8, b: 1.0 }, // 青色
        0.15 // 低透明度
      );
      if (regionMeshGroup.outer) {
        scene.value.add(regionMeshGroup.outer);
      }
    }
    
    // 2. 过渡带（中层，中等范围，中等透明度）
    if (region.layers.transition?.boundary) {
      regionMeshGroup.transition = createAuroraBoundary(
        region.layers.transition.boundary,
        i,
        'transition',
        { r: 0.5, g: 0.3, b: 1.0 }, // 紫色
        0.35 // 中等透明度
      );
      if (regionMeshGroup.transition) {
        scene.value.add(regionMeshGroup.transition);
      }
    }
    
    // 3. 核心区（最上层，小范围，高透明度，高亮）
    if (region.layers.core?.boundary) {
      regionMeshGroup.core = createAuroraBoundary(
        region.layers.core.boundary,
        i,
        'core',
        { r: 0.0, g: 0.95, b: 1.0 }, // 亮青色
        0.85 // 高透明度
      );
      if (regionMeshGroup.core) {
        scene.value.add(regionMeshGroup.core);
      }
    }
    
    fuzzyRegionMeshes.value.push(regionMeshGroup);
  }
  
  // 启动流光动画
  startAuroraAnimation();
};

/**
 * 创建极光效果边界
 * @param {Array} boundary - 边界坐标数组
 * @param {number} regionIndex - 区域索引
 * @param {string} layerType - 层级类型（core/transition/outer）
 * @param {Object} color - 颜色对象 {r, g, b}
 * @param {number} baseAlpha - 基础透明度
 */
const createAuroraBoundary = (boundary, regionIndex, layerType, color, baseAlpha) => {
  if (!boundary || boundary.length < 3) return null;
  
  // 创建闭合边界点
  const points = boundary.map(() => new THREE.Vector3(0, 0, 0));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  
  // 极光Shader材质
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBaseColor: { value: new THREE.Color(color.r, color.g, color.b) },
      uColorStart: { value: new THREE.Color(0.0, 0.95, 1.0) }, // 青色
      uColorEnd: { value: new THREE.Color(0.6, 0.3, 1.0) },    // 紫色
      uProgress: { value: 0 },
      uRegionIndex: { value: regionIndex },
      uLayerType: { value: layerType === 'core' ? 0 : layerType === 'transition' ? 1 : 2 },
      uBaseAlpha: { value: baseAlpha },
      uIsActive: { value: 0 } // 是否被激活高亮
    },
    vertexShader: `
      attribute float vertexProgress;
      varying vec2 vUv;
      varying float vProgress;
      
      void main() {
        vUv = uv;
        vProgress = vertexProgress;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uBaseColor;
      uniform vec3 uColorStart;
      uniform vec3 uColorEnd;
      uniform float uProgress;
      uniform float uRegionIndex;
      uniform int uLayerType;
      uniform float uBaseAlpha;
      uniform float uIsActive;
      
      varying vec2 vUv;
      varying float vProgress;
      
      void main() {
        // 流光流动速度根据层级不同
        float speed = uLayerType == 0 ? 3.0 : uLayerType == 1 ? 2.0 : 1.0;
        float flow = fract(vUv.x * 4.0 - uTime * speed + uRegionIndex * 0.3);
        
        // 动态渐变色：在 BaseColor 和 EndColor 之间变化
        // uLayerType: 0=Core(Cyan), 1=Transition(Purple), 2=Outer(Blue)
        vec3 gradientColor = mix(uColorStart, uColorEnd, 0.5 + 0.5 * sin(flow * 3.14 + vUv.x));
        
        // 混合基础色 (保持层级特征) 和 渐变色
        vec3 finalColor = mix(uBaseColor, gradientColor, 0.6);
        
        // 激活时增强亮度 (金色高亮)
        if (uIsActive > 0.5) {
          finalColor = mix(finalColor, vec3(1.0, 0.9, 0.3), 0.6); 
        }
        
        // 流光高亮带
        float beam = smoothstep(0.0, 0.2, sin(flow * 3.14159)); 
        finalColor += vec3(1.0) * beam * 0.5;

        // 透明度渐变效果
        float alpha = uBaseAlpha;
        
        // 绘制进度效果
        if (vUv.x > uProgress) {
          alpha *= 0.1; // 未绘制部分几乎透明
        } else {
          // 已绘制部分有脉动效果
          float pulse = 0.8 + 0.2 * sin(uTime * 4.0 + vUv.x * 10.0);
          alpha *= pulse;
        }
        
        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    side: THREE.DoubleSide
  });
  
  // 添加进度属性用于动画
  const count = points.length;
  const progressArray = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    progressArray[i] = i / (count - 1);
  }
  geometry.setAttribute('vertexProgress', new THREE.BufferAttribute(progressArray, 1));
  
  const mesh = new THREE.LineLoop(geometry, material);
  mesh.frustumCulled = false;
  mesh.userData = { 
    boundary, 
    regionIndex, 
    layerType,
    isFuzzyRegion: true 
  };
  
  return mesh;
};

/**
 * 启动极光动画 + 描边绘制效果
 */
let auroraAnimationId = null;
let drawStartTime = null; // 描边动画开始时间
const DRAW_DURATION = 2500; // 描边持续时间（毫秒）

const startAuroraAnimation = () => {
  if (auroraAnimationId) cancelAnimationFrame(auroraAnimationId);
  
  drawStartTime = performance.now(); // 记录开始时间
  
  const animate = () => {
    auroraAnimationId = requestAnimationFrame(animate);
    
    const time = clock.value.getElapsedTime();
    const elapsed = performance.now() - drawStartTime;
    const drawProgress = Math.min(elapsed / DRAW_DURATION, 1); // 0 -> 1
    
    // 更新所有模糊区域的uniform
    fuzzyRegionMeshes.value.forEach((regionGroup, regionIdx) => {
      // 每个区域错开绘制时间，形成依次描边效果
      const regionDelay = regionIdx * 400; // 每个区域延迟 400ms
      const localElapsed = Math.max(0, elapsed - regionDelay);
      const localProgress = Math.min(localElapsed / DRAW_DURATION, 1);
      
      ['outer', 'transition', 'core'].forEach((layerType, layerIdx) => {
        const mesh = regionGroup[layerType];
        if (mesh && mesh.material.uniforms) {
          mesh.material.uniforms.uTime.value = time;
          
          // 每层也错开绘制，外层先画，核心层后画
          const layerDelay = layerIdx * 200; // 层级延迟
          const layerLocalElapsed = Math.max(0, localElapsed - layerDelay);
          const layerProgress = Math.min(layerLocalElapsed / (DRAW_DURATION * 0.8), 1);
          
          mesh.material.uniforms.uProgress.value = layerProgress;
        }
      });
    });
  };
  
  animate();
};


/**
 * 清除模糊区域
 */
const clearFuzzyRegions = () => {
  fuzzyRegionMeshes.value.forEach(regionGroup => {
    ['outer', 'transition', 'core'].forEach(layerType => {
      const mesh = regionGroup[layerType];
      if (mesh && scene.value) {
        scene.value.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    });
  });
  fuzzyRegionMeshes.value = [];
  
  if (auroraAnimationId) {
    cancelAnimationFrame(auroraAnimationId);
    auroraAnimationId = null;
  }
};

/**
 * 高亮指定模糊区域
 */
const highlightFuzzyRegion = (regionIndex) => {
  activeRegionIndex.value = regionIndex;
  
  fuzzyRegionMeshes.value.forEach((regionGroup, idx) => {
    const isActive = idx === regionIndex;
    
    ['outer', 'transition', 'core'].forEach(layerType => {
      const mesh = regionGroup[layerType];
      if (mesh && mesh.material.uniforms) {
        mesh.material.uniforms.uIsActive.value = isActive ? 1 : 0;
      }
    });
  });
};

/**
 * 绘制模糊区域聚类边界（旧函数，保留兼容）
 * 使用流光笔描动画效果
 */
const drawClusterBoundaries = async (clusters) => {
  if (!clusters || clusters.length === 0 || !scene.value) return;
  
  isDrawingCluster.value = true;
  clusterBoundaries.value = [];
  
  // 清除旧的聚类边界
  clusterBoundaries.value.forEach(mesh => {
    if (mesh && scene.value) {
      scene.value.remove(mesh);
      mesh.geometry.dispose();
    }
  });
  
  // 为每个热点区域创建流光边界
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    if (!cluster.boundary || cluster.boundary.length < 3) continue;
    
    const boundaryMesh = await createFlowingBoundary(cluster.boundary, i);
    if (boundaryMesh) {
      clusterBoundaries.value.push(boundaryMesh);
      scene.value.add(boundaryMesh);
    }
  }
  
  isDrawingCluster.value = false;
};

/**
 * 创建流光边界线
 * 渐变色彩（蓝-紫流动光效）
 */
const createFlowingBoundary = (boundary, index) => {
  if (!boundary || boundary.length < 3) return null;
  
  // 创建几何体
  const points = boundary.map(() => new THREE.Vector3(0, 0, 0));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  
  // 流光材质 - 渐变色彩
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorStart: { value: new THREE.Color('#00f2ff') }, // 青色起点
      uColorEnd: { value: new THREE.Color('#a855f7') },   // 紫色终点
      uProgress: { value: 0 }, // 绘制进度
      uIndex: { value: index } // 边界索引，用于错开动画
    },
    vertexShader: `
      attribute float progress;
      varying vec2 vUv;
      varying float vProgress;
      
      void main() {
        vUv = uv;
        vProgress = progress;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColorStart;
      uniform vec3 uColorEnd;
      uniform float uProgress;
      uniform float uIndex;
      
      varying vec2 vUv;
      varying float vProgress;
      
      void main() {
        // 流光流动效果
        float flow = fract(vUv.x * 3.0 - uTime * 2.0 + uIndex * 0.5);
        
        // 渐变色彩混合
        vec3 color = mix(uColorStart, uColorEnd, flow);
        
        // 透明度随进度变化（笔描效果）
        float alpha = 0.0;
        if (vUv.x <= uProgress) {
          // 已绘制部分
          alpha = 0.8 + 0.2 * sin(flow * 3.14159 * 2.0);
        } else if (vUv.x <= uProgress + 0.05) {
          // 笔尖部分（渐变消失）
          alpha = 0.8 * (1.0 - (vUv.x - uProgress) / 0.05);
        }
        
        // 添加发光效果
        float glow = 0.5 + 0.5 * sin(uTime * 3.0 + vUv.x * 10.0);
        color = mix(color, vec3(1.0), glow * 0.2);
        
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    side: THREE.DoubleSide
  });
  
  // 添加进度属性
  const count = points.length;
  const progressArray = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    progressArray[i] = i / (count - 1);
  }
  geometry.setAttribute('progress', new THREE.BufferAttribute(progressArray, 1));
  
  const mesh = new THREE.LineLoop(geometry, material);
  mesh.frustumCulled = false;
  mesh.userData = { boundary, isClusterBoundary: true };
  
  return mesh;
};

/**
 * 更新聚类边界坐标（与地图同步）
 */
const syncClusterBoundaries = () => {
  if (!mapInstance.value || !scene.value) return;
  
  clusterBoundaries.value.forEach(mesh => {
    if (!mesh || !mesh.userData.boundary) return;
    
    const boundary = mesh.userData.boundary;
    const positions = mesh.geometry.attributes.position;
    const array = positions.array;
    
    boundary.forEach((coord, i) => {
      const pixel = mapInstance.value.getPixelFromCoordinate(fromLonLat(coord));
      if (pixel) {
        array[i * 3] = pixel[0];
        array[i * 3 + 1] = window.innerHeight - pixel[1];
        array[i * 3 + 2] = 0;
      }
    });
    
    positions.needsUpdate = true;
    
    // 更新材质时间
    if (mesh.material.uniforms) {
      mesh.material.uniforms.uTime.value = clock.value.getElapsedTime();
    }
  });
};

/**
 * 播放聚类动画
 * 逐笔绘制流光边界
 */
const playClusterAnimation = async (clusters) => {
  if (!clusters || clusters.length === 0) return;
  
  // 先创建所有边界
  await drawClusterBoundaries(clusters);
  
  // 逐笔绘制动画
  const duration = 2000; // 2秒绘制一个边界
  const startTime = Date.now();
  
  return new Promise((resolve) => {
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // 更新每个边界的绘制进度
      clusterBoundaries.value.forEach((mesh, index) => {
        if (mesh && mesh.material.uniforms) {
          // 错开动画开始时间
          const delay = index * 300;
          const localProgress = Math.max(0, Math.min((elapsed - delay) / duration, 1));
          mesh.material.uniforms.uProgress.value = localProgress;
        }
      });
      
      if (progress < 1 || clusterBoundaries.value.some(m => m.material.uniforms.uProgress.value < 1)) {
        requestAnimationFrame(animate);
      } else {
        resolve();
      }
    };
    animate();
  });
};

/**
 * 清除聚类边界
 */
const clearClusterBoundaries = () => {
  clusterBoundaries.value.forEach(mesh => {
    if (mesh && scene.value) {
      scene.value.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  });
  clusterBoundaries.value = [];
};

const playNarrative = async () => {
  if (narrativeSteps.value.length === 0 || isPlaying.value) return;
  
  isPlaying.value = true;
  
  // 如果有模糊区域，重新触发描边动画
  if (fuzzyRegionMeshes.value.length > 0) {
    startAuroraAnimation(); // 重新开始描边
  }
  
  for (let i = 0; i < narrativeSteps.value.length; i++) {
    currentStepIndex.value = i;
    const step = narrativeSteps.value[i];
    currentVoiceText.value = step.voice_text;
    
    // 优先使用 region_index（由 generateRegionBasedSteps 生成）
    if (step.region_index !== undefined && step.region_index >= 0) {
      highlightFuzzyRegion(step.region_index);
    }
    
    if (step.focus !== 'overview') {
      let targetCoords = null;
      
      // 1. 优先使用步骤中直接携带的坐标（由 generateRegionBasedSteps 生成）
      if (step.center && step.center.lon && step.center.lat) {
        targetCoords = [step.center.lon, step.center.lat];
      }
      
      // 2. 如果没有，尝试从模糊区域查找
      if (!targetCoords && fuzzyRegions.value && fuzzyRegions.value.length > 0) {
        const targetRegion = fuzzyRegions.value.find(r => 
          r.id === step.region_id || 
          r.name === step.focus || 
          (r.candidates?.bestGuess === step.focus)
        );
        
        if (targetRegion && targetRegion.center) {
          targetCoords = [targetRegion.center.lon, targetRegion.center.lat];
          const idx = fuzzyRegions.value.indexOf(targetRegion);
          if (idx >= 0) highlightFuzzyRegion(idx);
        }
      }
      
      // 3. 兜底：从 POI 中查找
      if (!targetCoords) {
        const targetPoi = poiFeatures.value.find(p => p.properties.name === step.focus);
        if (targetPoi) {
          targetCoords = targetPoi.geometry.coordinates;
        }
      }
      
      if (targetCoords && mapInstance.value) {
        mapInstance.value.getView().animate({
          center: fromLonLat(targetCoords),
          zoom: 16,
          duration: 1500
        });
      }
    } else {
      // 全景模式
      if (mapInstance.value) {
        mapInstance.value.getView().animate({ zoom: 14, duration: 1500 });
      }
      // 取消所有高亮
      highlightFuzzyRegion(-1);
    }

    await new Promise(resolve => setTimeout(resolve, step.duration || 5000));
  }
  
  isPlaying.value = false;
  currentStepIndex.value = -1;
  currentVoiceText.value = '';
  highlightFuzzyRegion(-1); // 清除高亮
};


const goBack = () => router.push('/');

// ==========================================
// 语义区域识别与AI解说路由
// ==========================================

/**
 * 语义区域识别（RAG检索增强）
 * 从用户提问中提取空间意图，检索知识库中的区域语义描述
 */
const identifySemanticRegions = async (userQuery) => {
  // 调用后端API进行语义区域识别
  try {
    const response = await fetch('/api/ai/identify-regions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: userQuery,
        viewport: mapInstance.value ? 
          mapInstance.value.getView().calculateExtent(mapInstance.value.getSize()) : null
      })
    });
    
    if (!response.ok) throw new Error('语义区域识别失败');
    
    const result = await response.json();
    return result.regions || [];
  } catch (err) {
    console.error('[Narrative] 语义区域识别失败:', err);
    return [];
  }
};

/**
 * 模糊边界生成（GIS拓扑构造）
 * 基于POI点集生成连续密度表面，提取矢量轮廓线
 */
const generateFuzzyBoundaries = async (regionCandidates) => {
  if (!regionCandidates || regionCandidates.length === 0) return;
  
  // 使用已有的聚类数据生成模糊边界
  const boundaries = [];
  
  for (const region of regionCandidates) {
    // 查找匹配的聚类
    const matchingCluster = spatialClusters.value.find(c => 
      c.dominantCategories.some(cat => 
        region.keywords.some(kw => cat.category.includes(kw))
      )
    );
    
    if (matchingCluster && matchingCluster.boundary) {
      boundaries.push({
        name: region.name,
        type: region.type,
        boundary: matchingCluster.boundary,
        confidence: matchingCluster.confidence,
        center: matchingCluster.center
      });
    }
  }
  
  return boundaries;
};

/**
 * AI解说路由渲染（二维动画合成）
 * 流光笔描动画 + 字幕时序绑定
 */
const renderAINarrative = async (script, boundaries) => {
  if (!script || script.length === 0) return;
  
  isPlaying.value = true;
  
  // 1. 预加载所有边界线
  if (boundaries && boundaries.length > 0) {
    await drawClusterBoundaries(boundaries.map(b => ({
      boundary: b.boundary,
      center: b.center,
      dominantCategories: [{ category: b.name }]
    })));
  }
  
  // 2. 逐句播放解说
  for (let i = 0; i < script.length; i++) {
    const step = script[i];
    currentStepIndex.value = i;
    currentVoiceText.value = step.voice_text;
    
    // 高亮当前区域
    if (step.region_index !== undefined && clusterBoundaries.value[step.region_index]) {
      const mesh = clusterBoundaries.value[step.region_index];
      if (mesh.material.uniforms) {
        mesh.material.uniforms.uColorStart.value = new THREE.Color('#ffeb3b');
        mesh.material.uniforms.uColorEnd.value = new THREE.Color('#ff9800');
      }
    }
    
    // 镜头移动
    if (step.center && mapInstance.value) {
      mapInstance.value.getView().animate({
        center: fromLonLat([step.center.lon, step.center.lat]),
        zoom: step.zoom || 16,
        duration: 1500
      });
    }
    
    // 等待解说时长
    await new Promise(resolve => setTimeout(resolve, step.duration || 5000));
    
    // 恢复区域颜色
    if (step.region_index !== undefined && clusterBoundaries.value[step.region_index]) {
      const mesh = clusterBoundaries.value[step.region_index];
      if (mesh.material.uniforms) {
        mesh.material.uniforms.uColorStart.value = new THREE.Color('#00f2ff');
        mesh.material.uniforms.uColorEnd.value = new THREE.Color('#a855f7');
      }
    }
  }
  
  isPlaying.value = false;
  currentStepIndex.value = -1;
  currentVoiceText.value = '';
};

/**
 * 生成区域解说（新入口）
 * 三阶段通道：语义识别 -> 边界生成 -> 动画渲染
 * 优化：添加超时处理和错误恢复
 */
const generateRegionNarrative = async () => {
  if (isGenerating.value) return;
  if (!mapInstance.value) return;
  
  isGenerating.value = true;
  narrativeSteps.value = [];
  aiResponse.value = '';
  boundaryData.value = null;
  poiFeatures.value = [];
  spatialClusters.value = [];
  vernacularRegions.value = [];
  fuzzyRegions.value = [];
  regionNarrativeSteps.value = [];
  clearClusterBoundaries();
  clearFuzzyRegions();
  
  const view = mapInstance.value.getView();
  const extent = view.calculateExtent(mapInstance.value.getSize());
  const { toLonLat } = await import('ol/proj');
  const bl = toLonLat([extent[0], extent[1]]);
  const tr = toLonLat([extent[2], extent[3]]);
  const viewport = [bl[0], bl[1], tr[0], tr[1]];
  
  // 创建AbortController用于超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
    console.log('[Narrative] 请求超时，已中止');
  }, 60000); // 60秒超时
  
  try {
    console.log('[Narrative] 开始生成区域解说...');
    
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: '请深度分析当前这片区域，识别主要功能区（如商业区、文教区、居住区等），并生成区域解说脚本。'
        }],
        options: {
          spatialContext: { mode: 'global', viewport: viewport },
          strictBbox: true, // 严格限制在 bbox 范围内
          quickMode: true
        }
      })
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
    
    // 处理流式响应
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let currentEventType = null;
    let buffer = '';
    let lastActivityTime = Date.now();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      // 检查是否长时间没有数据（延长至60秒，因为大数据集处理需要时间）
      if (Date.now() - lastActivityTime > 60000) {
        console.warn('[Narrative] 响应流超时');
        break;
      }
      lastActivityTime = Date.now();
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        
        if (trimmed.startsWith('event: ')) {
          currentEventType = trimmed.slice(7).trim();
        } else if (trimmed.startsWith('data: ')) {
          const content = trimmed.slice(6);
          if (content === '[DONE]') continue;
          
          try {
            if (currentEventType === 'pois') {
              const poisData = JSON.parse(content);
              poiFeatures.value = poisData.map(p => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
                properties: { ...p }
              }));
            } else if (currentEventType === 'boundary') {
              boundaryData.value = JSON.parse(content);
              nextTick(updateBoundaryLine);
            } else if (currentEventType === 'spatial_clusters') {
              const clusterData = JSON.parse(content);
              spatialClusters.value = clusterData.hotspots || [];
              nextTick(() => drawClusterBoundaries(spatialClusters.value));
            } else if (currentEventType === 'vernacular_regions') {
              const regionData = JSON.parse(content);
              vernacularRegions.value = regionData || [];
            } else if (currentEventType === 'fuzzy_regions') {
              // 接收模糊区域数据（三层边界模型）
              const fuzzyData = JSON.parse(content);
              fuzzyRegions.value = fuzzyData || [];
              console.log('[Narrative] 已同步模糊区域数据:', fuzzyRegions.value.length);
              // 自动绘制模糊区域
              nextTick(() => drawFuzzyRegions(fuzzyRegions.value));
              // 基于模糊区域自动生成漫游步骤
              if (fuzzyRegions.value.length > 0) {
                narrativeSteps.value = generateRegionBasedSteps(fuzzyRegions.value);
                console.log('[Narrative] 基于模糊区域生成漫游步骤:', narrativeSteps.value.length);
              }
            } else {
              const data = JSON.parse(content);
              if (data.content) aiResponse.value += data.content;
            }
          } catch (e) {
            // 解析错误
          }
        }
      }
    }
    
    // 提取叙事脚本
    const text = aiResponse.value;
    const jsonMatch = text.match(/```json\s*(\{[\s\S]*?\})\s*```/) || text.match(/\{[\s\S]*"narrative_flow"[\s\S]*\}/);
    
    if (jsonMatch) {
      try {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const script = JSON.parse(jsonStr);
        narrativeSteps.value = script.narrative_flow || [];
        console.log('[Narrative] 已提取叙事脚本，步数:', narrativeSteps.value.length);
      } catch (e) {
        console.error('[Narrative] JSON脚本解析失败:', e);
      }
    }
    
  } catch (err) {
    console.error('[Narrative] 生成解说失败:', err);
  } finally {
    isGenerating.value = false;
  }
};

/**
 * 基于模糊区域生成漫游步骤
 * 将每个模糊区域作为一个"面"步骤，而不是单个 POI 点
 */
const generateRegionBasedSteps = (regions) => {
  if (!regions || regions.length === 0) return [];
  
  const steps = [];
  
  // Step 1: 全景概览
  steps.push({
    focus: 'overview',
    voice_text: `当前区域共识别出 ${regions.length} 个主要功能分区，让我们依次了解。`,
    duration: 4000,
    region_id: null
  });
  
  // Step 2~N: 每个模糊区域作为一个步骤
  regions.forEach((region, index) => {
    const name = region.name || region.candidates?.bestGuess || `区域 ${index + 1}`;
    const theme = region.theme || '综合';
    const categories = region.dominantCategories?.map(c => c.category).join('、') || '综合业态';
    
    steps.push({
      focus: name,
      voice_text: `这里是「${name}」，主要功能为${theme}，包含 ${region.pointCount || 0} 个 POI，核心业态包括 ${categories}。`,
      duration: 5000,
      region_id: region.id,
      center: region.center,
      region_index: index
    });
  });
  
  // 最后一步: 回到全景
  steps.push({
    focus: 'overview',
    voice_text: '以上就是本区域的主要功能分区概览。',
    duration: 3000,
    region_id: null
  });
  
  return steps;
};

onMounted(() => {
  window.addEventListener('resize', handleResize);
});
onBeforeUnmount(() => {
  cleanupThree();
  clearClusterBoundaries();
  clearFuzzyRegions();
});

</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Sans+SC:wght@300;400;500;700&display=swap');

.narrative-mode-container {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: #0a0a12;
    font-family: 'Inter', 'Noto Sans SC', sans-serif;
    color: rgba(255, 255, 255, 0.95);
}

/* 动态背景 (来自 Demo) */
.bg-gradient {
    position: fixed;
    inset: 0;
    background: 
        radial-gradient(ellipse 80% 50% at 20% 40%, rgba(0, 212, 255, 0.08) 0%, transparent 50%),
        radial-gradient(ellipse 60% 40% at 80% 60%, rgba(123, 44, 191, 0.06) 0%, transparent 50%),
        radial-gradient(ellipse 50% 30% at 50% 100%, rgba(0, 212, 255, 0.04) 0%, transparent 50%);
    animation: bgPulse 20s ease-in-out infinite;
    pointer-events: none;
    z-index: 1;
}

@keyframes bgPulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.05); }
}

.grid-overlay {
    position: fixed;
    inset: 0;
    background-image: 
        linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
    background-size: 60px 60px;
    mask-image: radial-gradient(ellipse 80% 80% at 50% 50%, black 0%, transparent 70%);
    pointer-events: none;
    z-index: 2;
}

.floating-orb {
    position: fixed;
    width: 300px;
    height: 300px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(0,212,255,0.1) 0%, transparent 70%);
    pointer-events: none;
    animation: float 15s ease-in-out infinite;
    z-index: 3;
}

.floating-orb.orb-1 { top: 10%; left: 10%; animation-delay: 0s; }
.floating-orb.orb-2 { bottom: 20%; right: 10%; animation-delay: -5s; }

@keyframes float {
    0%, 100% { transform: translate(0, 0) scale(1); }
    25% { transform: translate(30px, -30px) scale(1.1); }
    50% { transform: translate(-20px, 20px) scale(0.9); }
    75% { transform: translate(20px, 30px) scale(1.05); }
}

/* 地图与特效画布 */
.background-map {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    filter: brightness(0.6) grayscale(0.2) contrast(1.1);
}

.effect-canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 5;
    pointer-events: none;
}

/* UI 控制层 */
.narrative-ui {
    position: absolute;
    inset: 0;
    z-index: 10;
    pointer-events: none;
}

.narrative-ui > * { pointer-events: auto; }

/* 进度指示器 (来自 Demo) */
.progress-ring-container {
    position: fixed;
    bottom: 32px;
    left: 40px;
    width: 56px;
    height: 56px;
    z-index: 100;
    background: rgba(0,0,0,0.3);
    backdrop-filter: blur(10px);
    border-radius: 50%;
    padding: 4px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.4);
}

.progress-ring-svg { transform: rotate(-90deg); }
.progress-ring-svg circle { fill: none; stroke-width: 3; }
.progress-ring-svg .ring-bg { stroke: rgba(255,255,255,0.1); }
.progress-ring-svg .ring-progress {
    stroke: #00d4ff;
    stroke-dasharray: 125.6;
    stroke-linecap: round;
    transition: stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1);
    filter: drop-shadow(0 0 5px #00d4ff);
}

.progress-text {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: #00d4ff;
    letter-spacing: -0.5px;
}

/* 脚本面板升级 */
.script-panel {
    position: absolute;
    left: 24px;
    top: 24px;
    width: 380px;
    max-height: calc(100vh - 48px);
    background: rgba(10, 10, 18, 0.75);
    backdrop-filter: blur(30px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 24px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    z-index: 20;
    transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    overflow: hidden;
}

.script-panel.generating {
    border-color: rgba(0, 212, 255, 0.4);
    box-shadow: 0 0 40px rgba(0, 212, 255, 0.15);
}

.panel-header {
    padding: 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: linear-gradient(180deg, rgba(255,255,255,0.05) 0%, transparent 100%);
}

.brand-mini { display: flex; align-items: center; gap: 12px; }
.brand-icon-mini {
    width: 36px;
    height: 36px;
    background: linear-gradient(135deg, #00d4ff, #7b2cbf);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    box-shadow: 0 4px 12px rgba(0, 212, 255, 0.3);
}

.brand-text-mini h1 { font-size: 15px; font-weight: 700; color: #fff; margin: 0; letter-spacing: 0.5px; }
.brand-text-mini span { font-size: 9px; color: rgba(255, 255, 255, 0.5); text-transform: uppercase; letter-spacing: 1.5px; }

.script-content {
    flex: 1;
    padding: 0 24px 24px;
    overflow-y: auto;
    scrollbar-width: none;
}

.script-content::-webkit-scrollbar { display: none; }

.response-title {
    font-size: 11px;
    color: #00d4ff;
    font-weight: 700;
    letter-spacing: 2px;
    margin: 24px 0 16px;
    opacity: 0.8;
}

.ai-text-response {
    color: rgba(255,255,255,0.8);
    font-size: 14px;
    line-height: 1.8;
}

/* 现代步骤条 (取代 Element Steps) */
.modern-steps { display: flex; flex-direction: column; gap: 4px; }
.modern-step-item {
    position: relative;
    padding: 12px 0 12px 32px;
    transition: all 0.3s ease;
}

.step-line {
    position: absolute;
    left: 7px;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(255,255,255,0.1);
}

.modern-step-item:first-child .step-line { top: 20px; }
.modern-step-item:last-child .step-line { bottom: auto; height: 20px; }

.step-dot {
    position: absolute;
    left: 4px;
    top: 20px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: rgba(255,255,255,0.3);
    border: 2px solid #0a0a12;
    z-index: 2;
    transition: all 0.4s ease;
}

.modern-step-item.active .step-dot {
    background: #00d4ff;
    box-shadow: 0 0 10px #00d4ff;
    transform: scale(1.4);
}

.modern-step-item.finished .step-dot { background: #7b2cbf; }

.step-label { font-size: 9px; color: rgba(255, 255, 255, 0.5); font-weight: 700; letter-spacing: 1px; margin-bottom: 2px; }
.step-title { font-size: 14px; color: rgba(255,255,255,0.5); font-weight: 500; transition: all 0.3s ease; }
.modern-step-item.active .step-title { color: #fff; font-weight: 600; }

/* 底部按钮区 */
.panel-footer {
    padding: 24px;
    background: rgba(0,0,0,0.2);
    border-top: 1px solid rgba(255,255,255,0.05);
}

.action-row { display: flex; flex-direction: column; gap: 12px; }

.btn-modern {
    width: 100%;
    padding: 14px;
    border: none;
    border-radius: 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    letter-spacing: 0.5px;
}

.btn-generate {
    background: rgba(255,255,255,0.05);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.1);
}

.btn-generate:hover { background: rgba(255,255,255,0.1); transform: translateY(-2px); }

.btn-play-narrative {
    background: linear-gradient(135deg, #00d4ff 0%, #7b2cbf 100%);
    color: #fff;
    box-shadow: 0 4px 15px rgba(0, 212, 255, 0.3);
}

.btn-play-narrative:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0, 212, 255, 0.4); }
.btn-play-narrative:active { transform: translateY(0); }
.btn-play-narrative.playing { background: rgba(255,255,255,0.1); box-shadow: none; color: rgba(255, 255, 255, 0.5); cursor: not-allowed; }

/* 字幕卡片升级 (来自 Demo) */
.subtitle-card {
    position: fixed;
    bottom: 40px;
    left: 50%;
    transform: translateX(-50%);
    width: 800px;
    max-width: 90vw;
    background: rgba(10, 10, 18, 0.6);
    backdrop-filter: blur(40px) saturate(150%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 24px;
    padding: 24px 32px;
    text-align: center;
    z-index: 100;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255,255,255,0.1);
    overflow: hidden;
}

.card-glow {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 60%;
    height: 1px;
    background: linear-gradient(90deg, transparent, #00d4ff, transparent);
    opacity: 0.6;
}

.district-prefix {
    font-size: 10px;
    font-weight: 700;
    color: #00d4ff;
    text-transform: uppercase;
    letter-spacing: 4px;
    margin-bottom: 8px;
    display: block;
    opacity: 0.7;
}

.district-name-text {
    font-size: 18px;
    font-weight: 700;
    margin: 0 0 12px;
    letter-spacing: 3px;
    background: linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.6) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.narrative-text {
    font-size: 13px;
    line-height: 1.7;
    color: rgba(255,255,255,0.85);
    font-weight: 400;
    letter-spacing: 0.3px;
    min-height: 40px;
}

.typing-cursor {
    display: inline-block;
    width: 3px;
    height: 20px;
    background: #00d4ff;
    margin-left: 6px;
    vertical-align: middle;
    animation: blink 0.8s infinite;
    box-shadow: 0 0 10px #00d4ff;
}

@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

/* 配音可视化 */
.card-controls { margin-top: 24px; display: flex; justify-content: center; }
.voice-visualizer { display: flex; align-items: flex-end; gap: 4px; height: 30px; }
.audio-bar {
    width: 3px;
    height: 8px;
    background: #00d4ff;
    border-radius: 2px;
    animation: bar-dance 0.6s ease-in-out infinite alternate;
}

@keyframes bar-dance { from { height: 6px; opacity: 0.4; } to { height: 24px; opacity: 1; } }

/* 右下角工具按钮 */
.action-buttons {
    position: absolute;
    right: 32px;
    bottom: 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.round-tool-btn {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(10, 10, 18, 0.6);
    backdrop-filter: blur(20px);
    color: #fff;
    font-size: 20px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s ease;
    box-shadow: 0 8px 20px rgba(0,0,0,0.3);
}

.round-tool-btn:hover { background: #00d4ff; color: #fff; transform: scale(1.1) rotate(5deg); }
.round-tool-btn.danger:hover { background: #ff6b6b; }

/* 加载动画 */
.loader-spinner-mini {
    width: 24px;
    height: 24px;
    border: 2px solid rgba(255,255,255,0.1);
    border-top-color: #00d4ff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 40px 0;
    color: rgba(255, 255, 255, 0.5);
    font-size: 13px;
}

/* 动画过渡 */
.up-enter-active, .up-leave-active { transition: all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1); }
.up-enter-from, .up-leave-to { opacity: 0; transform: translate(-50%, 100px); }

.fade-slide-enter-active, .fade-slide-leave-active { transition: all 0.6s ease; }
.fade-slide-enter-from, .fade-slide-leave-to { opacity: 0; transform: translateX(-50px); filter: blur(10px); }

/* 隐藏地图组件的原有控制面板 */
:deep(.map-filter-control) {
  display: none !important;
}

.response-body :deep(h3) {
  color: #00f2ff;
  font-size: 1.1rem;
  margin: 16px 0 8px 0;
}
.response-body :deep(p) { margin-bottom: 12px; }
.response-body :deep(ul) { padding-left: 20px; margin-bottom: 12px; }

/* 滚动条隐藏适配 */
.script-content {
    -ms-overflow-style: none; /* IE and Edge */
}
</style>
