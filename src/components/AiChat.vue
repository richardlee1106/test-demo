<template>
  <div class="ai-chat-container">
    <!-- 头部状态栏 -->
    <div class="chat-header">
      <div class="header-main-row">
        <!-- 左侧：头像 + 信息 -->
        <div class="header-left">
          <div class="ai-avatar">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
          </div>
          <div class="header-info">
            <span class="ai-name">GeoAI 助手</span>
            <span class="ai-status" :class="{ online: isOnline, offline: !isOnline }">
              {{ statusText }}
            </span>
          </div>
        </div>
        
        <!-- 右侧：按钮组 -->
        <div class="header-actions">
           <!-- POI 徽章 (在按钮组左侧，空间不足时可隐藏) -->
           <div class="poi-badge" v-if="poiCount > 0">
             <span class="poi-icon">📍</span>
             <span>{{ poiCount }}</span>
           </div>
           
           <button class="action-btn clear-btn" @click="clearChat" title="清空">
             <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
               <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
             </svg>
           </button>
           <button class="action-btn save-btn" @click="saveChatHistory" title="保存">
             <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
               <path d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
             </svg>
           </button>
           <button class="action-btn close-btn" @click="emit('close')" title="收起">
             <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
               <path d="M18 6L6 18M6 6l12 12" />
             </svg>
           </button>
        </div>
      </div>
    </div>

    <!-- 消息列表 -->
    <div class="chat-messages" ref="messagesContainer">
      <!-- 欢迎消息 -->
      <div v-if="messages.length === 0" class="welcome-message">
        <h3>欢迎使用 标签云 智能分析助手 </h3>
        <p>我拥有地理感知的能力，可以帮您分析选中区域内的POI数据，提供地理分析和洞察参考。</p>
        <div class="quick-actions">
          <button v-for="action in quickActions" :key="action.text" 
                  @click="sendQuickAction(action.prompt)"
                  class="quick-action-btn">
            {{ action.text }}
          </button>
        </div>
      </div>

      <!-- 消息列表 -->
      <div v-for="(msg, index) in messages" :key="index" 
           class="message" :class="msg.role">
        <div class="message-avatar">
          <template v-if="msg.role === 'user'">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
          </template>
          <template v-else>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
          </template>
        </div>
        <div class="message-content">
          <!-- 嵌入式 Pipeline 追踪器 (当有阶段信息时显示) -->
          <div v-if="msg.role === 'assistant' && msg.stage" class="thinking-process-embed">
            <div class="pipeline-trace">
              <div class="trace-step" :class="{ 
                active: isTyping && msg.stage === 'planner' && index === messages.length - 1, 
                completed: msg.stage !== 'planner' || (index < messages.length - 1 || !isTyping)
              }">
                <div class="step-dot"></div>
                <div class="step-label">意图规划</div>
              </div>
              <div class="trace-line" :class="{ completed: msg.stage !== 'planner' || (index < messages.length - 1 || !isTyping) }"></div>
              <div class="trace-step" :class="{ 
                active: isTyping && msg.stage === 'executor' && index === messages.length - 1, 
                completed: ['writer'].includes(msg.stage) || (index < messages.length - 1 || !isTyping)
              }">
                <div class="step-dot"></div>
                <div class="step-label">空间计算</div>
              </div>
              <div class="trace-line" :class="{ completed: ['writer'].includes(msg.stage) || (index < messages.length - 1 || !isTyping) }"></div>
              <div class="trace-step" :class="{ 
                active: isTyping && msg.stage === 'writer' && index === messages.length - 1,
                completed: (index < messages.length - 1 || !isTyping)
              }">
                <div class="step-dot"></div>
                <div class="step-label">结果生成</div>
              </div>
            </div>
            <div class="thinking-subtitle-embed">
              {{ (index < messages.length - 1 || !isTyping) ? '查询已完成' :
                 msg.stage === 'planner' ? '正在解析您的地理查询意图...' : 
                 msg.stage === 'executor' ? '正在调动 PostGIS 进行全量空间检索...' : 
                 msg.stage === 'writer' ? '正在基于统计特征生成专业解读...' : 'GeoLoom-RAG 正在运行...' }}
            </div>
          </div>

          <!-- 仅在有内容时显示消息气泡内容 -->
          <div v-if="msg.content && msg.content.trim()" class="message-text" v-html="renderMarkdown(msg.content)"></div>
          <div v-if="msg.content && msg.content.trim()" class="message-time">{{ formatTime(msg.timestamp) }}</div>
        </div>
      </div>

    </div>



    <!-- 输入区域 -->
    <div class="chat-input-area">
      <div class="input-wrapper">
        <textarea 
          ref="inputRef"
          v-model="inputText"
          @keydown.enter.exact.prevent="sendMessage"
          @keydown.shift.enter="insertNewline"
          placeholder="询问关于选中区域 POI 的问题..."
          :disabled="isTyping || !isOnline"
          rows="1"
        ></textarea>
        <button 
          class="send-btn" 
          @click="sendMessage"
          :disabled="!inputText.trim() || isTyping || !isOnline"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
      <div class="input-hint">
        <span v-if="!isOnline" class="offline-hint">AI 服务未连接</span>
        <span v-else>按 Enter 发送，Shift+Enter 换行</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, nextTick, computed } from 'vue';
import { 
  sendChatMessageStream, 
  checkAIService, 
  getCurrentProviderInfo
} from '../utils/aiService.js';

const props = defineProps({
  // 当前选中的 POI 数据
  poiFeatures: {
    type: Array,
    default: () => []
  },
  // 是否开启全域感知模式
  globalAnalysisEnabled: {
    type: Boolean,
    default: false
  },
  // 空间边界几何数据
  boundaryPolygon: {
    type: Array,
    default: null
  },
  drawMode: {
    type: String,
    default: ''
  },
  circleCenter: {
    type: Object,
    default: null
  },
  // 地图视野边界 [minLon, minLat, maxLon, maxLat]
  mapBounds: {
    type: Array,
    default: null
  },
  selectedCategories: {
    type: Array,
    default: () => []
  }
});

// 定义事件
const emit = defineEmits(['close', 'render-to-tagcloud']);

// 响应式状态
const messages = ref([]);
const inputText = ref('');
const isTyping = ref(false);
const currentStage = ref(''); // 'planner', 'executor', 'writer'
const isOnline = ref(false);
const messagesContainer = ref(null);
const inputRef = ref(null);
const extractedPOIs = ref([]); // AI 提取的 POI 名称列表

// 计算 POI 数量
const poiCount = computed(() => props.poiFeatures?.length || 0);

// 快捷操作按钮
const quickActions = [
  { text: '📊 分析 POI 分布', prompt: '请分析当前选中区域的 POI 分布特征和规律' },
  { text: '🏪 商业建议', prompt: '基于当前 POI 数据，给出商业选址建议' },
  { text: '📈 热点分析', prompt: '识别当前区域的商业热点和冷区' },
  { text: '🔍 数据概览', prompt: '请简要概述当前选中的 POI 数据' },
  { text: '🏘️ 周边配套', prompt: '分析当前区域的生活配套设施完善程度' },
  { text: '📍 类别对比', prompt: '对比分析当前区域各类别POI的数量差异' },
  { text: '🚗 交通便利度', prompt: '评估当前区域的交通便利程度' },
  { text: '💡 发展建议', prompt: '基于POI数据给出区域发展建议' }
];

const providerName = ref('');
const isLocalProvider = ref(false);

// 计算状态文本
const statusText = computed(() => {
  if (!isOnline.value) return '离线';
  // 本地显示 "Local LM"，云端统一显示 "在线"
  return isLocalProvider.value ? 'Local LM' : '在线';
});

// 检查 AI 服务状态
async function checkOnlineStatus() {
  isOnline.value = await checkAIService();
  if (isOnline.value) {
    const config = getCurrentProviderInfo();
    providerName.value = config.name;
    isLocalProvider.value = config.id === 'local';
  }
}

// 发送消息
async function sendMessage() {
  const text = inputText.value.trim();
  if (!text || isTyping.value || !isOnline.value) return;

  // 添加用户消息
  messages.value.push({
    role: 'user',
    content: text,
    timestamp: Date.now()
  });
  inputText.value = '';
  
  await nextTick();
  scrollToBottom();

  // 准备 AI 请求
  isTyping.value = true;

  try {
    // 调试：输出 POI 数据状态
    console.log('[AiChat] 发送消息时 POI 数量:', props.poiFeatures?.length || 0);
    
    // 构建用户消息（不再在前端构建 system prompt，由后端处理）
    const apiMessages = messages.value.map(m => ({
      role: m.role,
      content: m.content
    }));

    // 添加 AI 消息占位
    const aiMessageIndex = messages.value.length;
    messages.value.push({
      role: 'assistant',
      content: '',
      timestamp: Date.now()
    });

    // 流式接收响应 - POI 数据和选项发送到后端处理
    // 收集对话上下文及空间约束
    const options = {
      globalAnalysis: props.globalAnalysisEnabled,
      selectedCategories: props.selectedCategories,
      // 传递具体的边界原始数据，让后端 Executor 做硬过滤
      spatialContext: {
        boundary: props.boundaryPolygon,
        mode: props.drawMode,
        center: props.circleCenter,
        viewport: props.mapBounds
      }
    };

    // 发送请求给后端 AI Pipeline
    await sendChatMessageStream(
      apiMessages, 
      (chunk) => {
        messages.value[aiMessageIndex].content += chunk;
        scrollToBottom();
      },
      options, // 传递全域感知开关状态和空间上下文
      props.poiFeatures, // POI 数据发送到后端
      // 接收元数据回调
      (type, data) => {
        if (type === 'stage') {
          currentStage.value = data;
          // 将当前阶段记录在消息对象中，以便持久化显示
          if (messages.value[aiMessageIndex]) {
            messages.value[aiMessageIndex].stage = data;
          }
        }
        if (type === 'pois' && Array.isArray(data)) {
           console.log('[AiChat] 收到后端结构化 POI 数据:', data.length);
           extractedPOIs.value = data;
        }
      }
    );

  } catch (error) {
    console.error('[AiChat] 发送消息失败:', error);
    messages.value.push({
      role: 'assistant',
      content: `❌ 抱歉，请求失败：${error.message}`,
      timestamp: Date.now()
    });
  } finally {
    isTyping.value = false;
    currentStage.value = '';
    await nextTick();
    scrollToBottom();
  }
}

// 发送快捷操作
function sendQuickAction(prompt) {
  inputText.value = prompt;
  sendMessage();
}

// 清空对话
function clearChat() {
  messages.value = [];
  extractedPOIs.value = [];
}

// 保存对话记录
function saveChatHistory() {
  if (messages.value.length === 0) return;
  
  let content = "===== 标签云智能助手对话记录 =====\n\n";
  content += `导出时间: ${new Date().toLocaleString()}\n`;
  content += `选中POI数量: ${props.poiFeatures.length}\n\n`;
  content += "-----------------------------------\n\n";
  
  messages.value.forEach(msg => {
    const role = msg.role === 'user' ? '用户' : '智能助手';
    const time = new Date(msg.timestamp).toLocaleTimeString();
    content += `[${role}] ${time}:\n${msg.content}\n\n`;
    content += "-----------------------------------\n\n";
  });
  
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `TagCloud_Chat_${new Date().getTime()}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

// 滚动到底部
function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

// 插入换行
function insertNewline(e) {
  const textarea = e.target;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  inputText.value = inputText.value.substring(0, start) + '\n' + inputText.value.substring(end);
  nextTick(() => {
    textarea.selectionStart = textarea.selectionEnd = start + 1;
  });
}

// 格式化时间
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

// 增强的 Markdown 渲染（支持表格）
function renderMarkdown(text) {
  if (!text) return '';
  
  // 先处理表格（在其他转换之前）
  text = renderTables(text);
  
  return text
    // 代码块
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    // 行内代码
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // 粗体
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // 斜体
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // 标题 (处理 # 到 ####)
    .replace(/^#### (.+)$/gm, '<h5>$1</h5>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    // 列表 (简单的正则处理，不够完美但可用)
    .replace(/^- (.+)$/gm, '<li>• $1</li>')
    // 有序列表
    .replace(/^(\d+)\. (.+)$/gm, '<li><span class="list-num">$1.</span> $2</li>')
    // 水平分割线
    .replace(/^---$/gm, '<hr>')
    // 段落换行
    .replace(/\n\n/g, '<div class="spacer"></div>')
    .replace(/\n/g, '<br>');
}

// 渲染 Markdown 表格
function renderTables(text) {
  const lines = text.split('\n');
  let result = [];
  let tableLines = [];
  let inTable = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // 检测表格行（以 | 开头和结尾）
    if (line.startsWith('|') && line.endsWith('|')) {
      // 检查是否是分隔行（如 |---|---|）
      const isSeparator = /^\|[\s\-:|]+\|$/.test(line);
      
      if (!inTable) {
        inTable = true;
        tableLines = [];
      }
      
      if (!isSeparator) {
        tableLines.push(line);
      }
    } else {
      // 不是表格行
      if (inTable && tableLines.length > 0) {
        // 结束表格，生成 HTML
        result.push(generateTableHTML(tableLines));
        tableLines = [];
        inTable = false;
      }
      result.push(line);
    }
  }
  
  // 处理文本末尾的表格
  if (inTable && tableLines.length > 0) {
    result.push(generateTableHTML(tableLines));
  }
  
  return result.join('\n');
}

// 生成表格 HTML
function generateTableHTML(tableLines) {
  if (tableLines.length === 0) return '';
  
  let html = '<table class="md-table">';
  
  tableLines.forEach((line, index) => {
    // 解析单元格
    const cells = line
      .split('|')
      .filter((cell, i, arr) => i !== 0 && i !== arr.length - 1) // 移除首尾空元素
      .map(cell => cell.trim());
    
    if (index === 0) {
      // 表头
      html += '<thead><tr>';
      cells.forEach(cell => {
        html += `<th>${cell}</th>`;
      });
      html += '</tr></thead><tbody>';
    } else {
      // 表体
      html += '<tr>';
      cells.forEach(cell => {
        html += `<td>${cell}</td>`;
      });
      html += '</tr>';
    }
  });
  
  html += '</tbody></table>';
  return html;
}

/**
 * 从 AI 回复中提取 POI 名称（解析 Markdown 表格）
 * @param {string} content - AI 回复内容
 * @returns {Array} POI 列表 [{name, distance}, ...]
 */
function extractPOIsFromResponse(content) {
  const pois = [];
  if (!content) return pois;
  
  const lines = content.split('\n');
  let inTable = false;
  let nameColIndex = -1;
  let distanceColIndex = -1;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // 检测表格行
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.split('|').filter((c, i, arr) => i !== 0 && i !== arr.length - 1).map(c => c.trim());
      
      // 检查是否是分隔行
      if (/^[\s\-:|]+$/.test(cells.join(''))) {
        continue;
      }
      
      // 检查是否是表头（寻找"名称"列）
      if (!inTable) {
        nameColIndex = cells.findIndex(c => c.includes('名称') || c.includes('店名') || c.includes('POI'));
        distanceColIndex = cells.findIndex(c => c.includes('距离'));
        if (nameColIndex >= 0) {
          inTable = true;
        }
        continue;
      }
      
      // 表格数据行
      if (inTable && nameColIndex >= 0 && cells[nameColIndex]) {
        const name = cells[nameColIndex].replace(/\*\*/g, '').trim();
        const distance = distanceColIndex >= 0 ? cells[distanceColIndex]?.trim() : null;
        if (name && !name.includes('---')) {
          pois.push({ name, distance });
        }
      }
    } else {
      // 非表格行，重置状态
      if (inTable && pois.length > 0) {
        // 表格已结束
      }
    }
  }
  
  return pois;
}

/**
 * 将 AI 提取的 POI 渲染到标签云
 */
function renderToTagCloud() {
  // 如果提取的数据里包含坐标信息，说明是后端下发的结构化数据，直接作为 Feature 数组传出去
  if (extractedPOIs.value.length > 0 && extractedPOIs.value[0].lon) {
     const features = extractedPOIs.value.map(p => ({
        type: 'Feature',
        properties: {
           id: p.id || `temp_${Math.random()}`,
           '名称': p.name,
           '小类': p.category,
           '地址': p.address,
           '_is_temp': true // 标记为临时数据
        },
        geometry: {
           type: 'Point',
           coordinates: [p.lon, p.lat]
        }
     }));
     console.log('[AiChat] 渲染结构化 POI 到标签云:', features.length);
     emit('render-to-tagcloud', features);
     return;
  }

  const poiNames = extractedPOIs.value.map(p => p.name);
  console.log('[AiChat] 渲染到标签云:', poiNames);
  emit('render-to-tagcloud', poiNames);
}

/**
 * 清除提取的 POI
 */
function clearExtractedPOIs() {
  extractedPOIs.value = [];
}

// 监听消息变化，自动提取 POI
watch(messages, (newMessages) => {
  if (newMessages.length > 0) {
    const lastMsg = newMessages[newMessages.length - 1];
    if (lastMsg.role === 'assistant' && lastMsg.content) {
      const pois = extractPOIsFromResponse(lastMsg.content);
      if (pois.length > 0) {
        extractedPOIs.value = pois;
        console.log('[AiChat] 提取到 POI:', pois);
      }
    }
  }
}, { deep: true });

// 监听 POI 数据变化，提示用户
watch(() => props.poiFeatures, (newVal, oldVal) => {
  if (newVal?.length > 0 && newVal.length !== oldVal?.length) {
    // 可以在这里添加提示消息
    console.log(`[AiChat] POI 数据已更新: ${newVal.length} 个`);
  }
}, { deep: false });

onMounted(() => {
  checkOnlineStatus();
  // 定期检查服务状态
  setInterval(checkOnlineStatus, 30000);
});

/**
 * 自动发送消息（供父组件调用）
 * 用于复杂查询时，自动打开AI面板并发送用户输入
 * @param {string} message - 要发送的消息内容
 */
async function autoSendMessage(message) {
  if (!message || !message.trim()) return;
  
  // 填充输入框
  inputText.value = message.trim();
  
  // 等待 DOM 更新
  await nextTick();
  
  // 自动发送
  await sendMessage();
}

// 暴露方法给父组件
defineExpose({
  clearChat,
  checkOnlineStatus,
  autoSendMessage
});
</script>

<style scoped>
.ai-chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: linear-gradient(180deg, #0a0f1a 0%, #111827 100%);
  color: #e5e7eb;
  font-family: 'Inter', 'Segoe UI', sans-serif;
}

/* 头部 */
.chat-header {
  padding: 12px 16px;
  background: rgba(15, 23, 42, 0.95);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
  z-index: 10;
}

.header-main-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1; /* 占据剩余空间 */
  overflow: hidden; /* 防止文字过长挤压按钮 */
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.ai-avatar {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: linear-gradient(135deg, #6366f1, #a855f7);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);
}

.header-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ai-name {
  font-weight: 700;
  font-size: 16px;
  color: #f8fafc;
  letter-spacing: 0.5px;
}

.ai-status {
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  width: fit-content;
}

.ai-status::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.ai-status.online {
  color: #10b981;
  font-weight: 500;
}
.ai-status.online::before {
  background: #10b981;
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.8), 0 0 4px rgba(16, 185, 129, 0.4);
}

.ai-status.offline {
  color: #fb7185;
}
.ai-status.offline::before {
  background: #fb7185;
}

.poi-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  color: #a5b4fc;
  margin-right: 4px;
}

.poi-icon {
  font-size: 10px;
}

/* 操作按钮通用样式重构 - 迷你图标版 */
.action-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  background: rgba(255, 255, 255, 0.05);
  color: #94a3b8;
}

.clear-btn {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.2);
  color: #f87171;
}
.clear-btn:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: rgba(239, 68, 68, 0.4);
  color: #ff8a8a;
}

.save-btn {
  background: rgba(16, 185, 129, 0.15);
  border-color: rgba(16, 185, 129, 0.2);
  color: #34d399;
}
.save-btn:hover {
  background: rgba(16, 185, 129, 0.25);
  border-color: rgba(16, 185, 129, 0.4);
  color: #5ffcc3;
}

.close-btn {
  background: rgba(99, 102, 241, 0.15);
  border-color: rgba(99, 102, 241, 0.2);
  color: #a5b4fc;
}
.close-btn:hover {
  background: rgba(99, 102, 241, 0.25);
  border-color: rgba(99, 102, 241, 0.4);
  color: #c7d2ff;
}

/* 消息区域 */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  scroll-behavior: smooth;
}

.chat-messages::-webkit-scrollbar {
  width: 6px;
}
.chat-messages::-webkit-scrollbar-track {
  background: transparent;
}
.chat-messages::-webkit-scrollbar-thumb {
  background: rgba(107, 114, 128, 0.4);
  border-radius: 3px;
}

/* 欢迎消息 */
.welcome-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  padding: 20px;
  color: #9ca3af;
}

.welcome-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.2));
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  color: #818cf8;
}

.welcome-message h3 {
  margin: 0 0 8px;
  color: #f9fafb;
  font-size: 18px;
}

.welcome-message p {
  margin: 0 0 20px;
  font-size: 14px;
  max-width: 300px;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  width: 100%;
  margin-top: 15px;
}

.quick-action-btn {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  color: #e2e8f0;
  font-size: 13px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  display: inline-flex;
  align-items: center;
  backdrop-filter: blur(4px);
}

.quick-action-btn:hover {
  background: rgba(99, 102, 241, 0.2);
  border-color: rgba(99, 102, 241, 0.4);
  transform: translateY(-2px);
  color: #fff;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.2);
}

/* 消息泡泡 */
.message {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  max-width: 95%;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.message.user {
  flex-direction: row-reverse;
  align-self: flex-end;
  margin-left: auto;
}

.message-avatar {
  width: 34px;
  height: 34px;
  min-width: 34px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.user .message-avatar {
  background: #4f46e5;
  color: white;
}

.assistant .message-avatar {
  background: linear-gradient(135deg, #6366f1, #a855f7);
  color: white;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.2);
}

.message-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: calc(100% - 46px);
}

.user .message-content {
  align-items: flex-end;
}

.message-text {
  padding: 12px 16px;
  border-radius: 16px;
  font-size: 14.5px;
  line-height: 1.6;
  word-break: break-word;
}

.user .message-text {
  background: #6366f1;
  color: white;
  border-bottom-right-radius: 4px;
}

.assistant .message-text {
  background: rgba(30, 41, 59, 0.8);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #f1f5f9;
  border-bottom-left-radius: 4px;
}

.message-text :deep(code) {
  background: rgba(0, 0, 0, 0.3);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Fira Code', monospace;
  font-size: 13px;
}

.message-text :deep(pre) {
  background: rgba(0, 0, 0, 0.4);
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
}

.message-text :deep(strong) {
  color: #a5b4fc;
}

.message-text :deep(h2),
.message-text :deep(h3),
.message-text :deep(h4),
.message-text :deep(h5) {
  margin: 16px 0 8px;
  color: #f9fafb;
  font-weight: 600;
  line-height: 1.4;
}

.message-text :deep(h4),
.message-text :deep(h5) {
  font-size: 1.1em;
  color: #e5e7eb;
}

.message-text :deep(li) {
  margin-bottom: 4px;
  line-height: 1.6;
}

.message-text :deep(.list-num) {
  font-weight: bold;
  color: #93c5fd;
  margin-right: 4px;
}

.message-text :deep(hr) {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  margin: 16px 0;
}

.message-text :deep(.spacer) {
  height: 8px;
}

/* Markdown 表格样式 */
.message-text :deep(.md-table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 13px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  overflow: hidden;
}

.message-text :deep(.md-table th),
.message-text :deep(.md-table td) {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid rgba(75, 85, 99, 0.4);
}

.message-text :deep(.md-table th) {
  background: rgba(99, 102, 241, 0.15);
  color: #a5b4fc;
  font-weight: 600;
  white-space: nowrap;
}

.message-text :deep(.md-table td) {
  color: #d1d5db;
}

.message-text :deep(.md-table tr:last-child td) {
  border-bottom: none;
}

.message-text :deep(.md-table tr:hover td) {
  background: rgba(99, 102, 241, 0.08);
}

.message-time {
  font-size: 11px;
  color: #6b7280;
  margin-top: 4px;
  padding: 0 4px;
}

.message.user .message-time {
  text-align: right;
}

/* 打字指示器 */
.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 12px 16px;
}

.typing-indicator span {
  width: 8px;
  height: 8px;
  background: #6366f1;
  border-radius: 50%;
  animation: typing 1.4s infinite ease-in-out both;
}

.typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
.typing-indicator span:nth-child(2) { animation-delay: -0.16s; }

@keyframes typing {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}

/* 新版 Pipeline 追踪器样式 (嵌入式) */
.thinking-process-embed {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 12px;
  margin-bottom: 8px;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.1);
  width: 500px; /* 固定宽度，确保从起始到结束的长度一致 */
  max-width: 100%; /* 适配移动端，不超出屏幕 */
}

.pipeline-trace {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  position: relative;
  padding: 0 4px; /* 减少内边距 */
}

.trace-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px; /* 进一步增加间距 */
  z-index: 2;
  position: relative;
  flex: 1;
}

.step-dot {
  width: 14px; /* 继续调大 */
  height: 14px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.3);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.step-dot::after {
  content: '';
  position: absolute;
  top: -4px;
  left: -4px;
  right: -4px;
  bottom: -4px;
  border-radius: 50%;
  border: 1.5px solid transparent; /* 边框稍微加粗 */
  transition: all 0.3s ease;
}

.trace-step.active .step-dot {
  background: #00BFFF;
  box-shadow: 0 0 12px rgba(0, 191, 255, 0.8);
  transform: scale(1.2);
}

.trace-step.active .step-dot::after {
  border-color: rgba(0, 191, 255, 0.4);
  animation: pulse-ring 1.5s infinite linear;
}

.trace-step.completed .step-dot {
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.4);
}

.step-label {
  font-size: 12px; /* 调大标签字体 */
  color: rgba(255, 255, 255, 0.5); 
  transition: all 0.3s ease;
  white-space: nowrap;
}

.trace-step.active .step-label {
  color: #00BFFF;
  font-weight: 600;
}

.trace-step.completed .step-label {
  color: #10b981;
}

.trace-line {
  height: 2px;
  flex: 1;
  background: rgba(255, 255, 255, 0.15);
  margin: 0 -15px; /* 适配更大的点 */
  transform: translateY(-16px); /* 向上偏移对齐 dot (12 + 10 + 7 / 2 = ~16px) */
  transition: all 0.5s ease;
  z-index: 1;
}

.trace-line.completed {
  background: #10b981;
}

.thinking-subtitle-embed {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  text-align: center;
  font-style: italic;
  min-height: 16px;
}

@keyframes pulse-ring {
  0% { transform: scale(0.9); opacity: 0.8; }
  100% { transform: scale(1.8); opacity: 0; }
}

/* 输入区域 */
.chat-input-area {
  padding: 12px 16px 16px;
  background: rgba(17, 24, 39, 0.95);
  border-top: 1px solid rgba(75, 85, 99, 0.4);
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: rgba(55, 65, 81, 0.4);
  border: 1px solid rgba(75, 85, 99, 0.5);
  border-radius: 16px;
  padding: 8px 12px;
  transition: border-color 0.2s;
}

.input-wrapper:focus-within {
  border-color: rgba(99, 102, 241, 0.6);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.input-wrapper textarea {
  flex: 1;
  background: transparent;
  border: none;
  color: #f9fafb;
  font-size: 14px;
  resize: none;
  outline: none;
  max-height: 120px;
  line-height: 1.5;
  font-family: inherit;
}

.input-wrapper textarea::placeholder {
  color: #6b7280;
}

.send-btn {
  width: 36px;
  height: 36px;
  border: none;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-radius: 12px;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-hint {
  font-size: 11px;
  color: #6b7280;
  margin-top: 6px;
  padding: 0 4px;
}

.offline-hint {
  color: #f87171;
}

/* AI 提取的 POI 区域 */
.extracted-pois-area {
  padding: 10px 16px;
  background: rgba(16, 185, 129, 0.08);
  border-top: 1px solid rgba(16, 185, 129, 0.2);
  border-bottom: 1px solid rgba(16, 185, 129, 0.2);
}

.extracted-pois-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 12px;
  color: #10b981;
}

.extracted-pois-icon {
  font-size: 14px;
}

.clear-extracted-btn {
  padding: 4px 10px;
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 4px;
  color: #f87171;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}

.clear-extracted-btn:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.5);
}

.render-tagcloud-btn, .clear-extracted-btn {
  margin-left: 8px;
  padding: 8px 16px;
  font-size: 13px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.render-tagcloud-btn {
  margin-left: auto; /* Keep it pushed to the right if flex container allows, or this might conflict with previous margin-left */
  background: linear-gradient(135deg, #10b981, #06b6d4);
  color: white;
  box-shadow: 0 2px 4px rgba(16, 185, 129, 0.3);
}

.render-tagcloud-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(16, 185, 129, 0.4);
}

.clear-extracted-btn {
  background: rgba(107, 114, 128, 0.2);
  color: #d1d5db;
}

.clear-extracted-btn:hover {
  background: rgba(107, 114, 128, 0.4);
  color: white;
}

.extracted-pois-preview {
  font-size: 12px;
  color: #6ee7b7;
  line-height: 1.4;
  word-break: break-all;
}

/* 移动端适配 */
@media (max-width: 768px) {
  .chat-header {
    padding: 10px 12px;
  }

  .message-content {
    max-width: 85%;
  }

  .quick-actions {
    gap: 8px;
    margin-top: 12px;
  }

  .quick-action-btn {
    padding: 6px 12px;
    font-size: 12px;
  }
}
</style>
