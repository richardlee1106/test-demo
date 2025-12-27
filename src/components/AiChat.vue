<template>
  <div class="ai-chat-container">
    <!-- 头部状态栏 -->
    <div class="chat-header">
      <div class="header-left">
        <div class="ai-avatar">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
          </svg>
        </div>
        <div class="header-info">
          <span class="ai-name">标签云智能助手</span>
          <span class="ai-status" :class="{ online: isOnline, offline: !isOnline }">
            {{ isOnline ? `在线 (${providerName})` : '离线' }}
          </span>
        </div>
      </div>
      <div class="header-right">
        <div class="poi-badge" v-if="poiCount > 0">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
          </svg>
          <span>{{ poiCount }} 个标签</span>
        </div>
        <button class="action-btn clear-btn" @click="clearChat">清空对话</button>
        <button class="action-btn save-btn" @click="saveChatHistory">保存对话</button>
        <button class="action-btn close-btn" @click="emit('close')">收起面板</button>
      </div>
    </div>

    <!-- 消息列表 -->
    <div class="chat-messages" ref="messagesContainer">
      <!-- 欢迎消息 -->
      <div v-if="messages.length === 0" class="welcome-message">
        <div class="welcome-icon">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
          </svg>
        </div>
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
          <div class="message-text" v-html="renderMarkdown(msg.content)"></div>
          <div class="message-time">{{ formatTime(msg.timestamp) }}</div>
        </div>
      </div>

      <!-- 正在输入指示器 -->
      <div v-if="isTyping" class="message assistant typing">
        <div class="message-avatar">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
          </svg>
        </div>
        <div class="message-content">
          <div class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
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
        <span v-if="!isOnline" class="offline-hint">⚠️ AI 服务未连接，请确保 LM Studio 正在运行</span>
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
  formatPOIContext,
  buildSystemPrompt,
  isLocationRelatedQuery,
  getCurrentProviderInfo
} from '../utils/aiService.js';

const props = defineProps({
  // 当前选中的 POI 数据
  poiFeatures: {
    type: Array,
    default: () => []
  }
});

// 定义事件
const emit = defineEmits(['close']);

// 响应式状态
const messages = ref([]);
const inputText = ref('');
const isTyping = ref(false);
const isOnline = ref(false);
const messagesContainer = ref(null);
const inputRef = ref(null);

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

// 检查 AI 服务状态
async function checkOnlineStatus() {
  isOnline.value = await checkAIService();
  if (isOnline.value) {
    const config = getCurrentProviderInfo();
    providerName.value = config.name;
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
    // 检测是否为位置相关问题
    const isLocationQuery = isLocationRelatedQuery(text);
    
    // 调试：输出 POI 数据状态
    console.log('[AiChat] 发送消息时 POI 数量:', props.poiFeatures?.length || 0);
    console.log('[AiChat] POI 数据示例:', props.poiFeatures?.slice(0, 2));
    
    // 智能构建 POI 上下文（位置问题传坐标，否则只传名称）
    const poiContext = formatPOIContext(props.poiFeatures, text);
    console.log('[AiChat] 生成的 POI 上下文:', poiContext?.substring(0, 200) + '...');
    const systemPrompt = buildSystemPrompt(poiContext, isLocationQuery);
    
    // 如果检测到位置问题，在控制台输出调试信息
    if (isLocationQuery) {
      console.log('[AiChat] 检测到位置相关问题，使用完整坐标数据');
    }
    
    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.value.map(m => ({
        role: m.role,
        content: m.content
      }))
    ];

    // 添加 AI 消息占位
    const aiMessageIndex = messages.value.length;
    messages.value.push({
      role: 'assistant',
      content: '',
      timestamp: Date.now()
    });

    // 流式接收响应
    await sendChatMessageStream(apiMessages, (chunk) => {
      messages.value[aiMessageIndex].content += chunk;
      scrollToBottom();
    });

  } catch (error) {
    console.error('[AiChat] 发送消息失败:', error);
    messages.value.push({
      role: 'assistant',
      content: `❌ 抱歉，请求失败：${error.message}`,
      timestamp: Date.now()
    });
  } finally {
    isTyping.value = false;
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

// 暴露方法给父组件
defineExpose({
  clearChat,
  checkOnlineStatus
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
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: rgba(17, 24, 39, 0.95);
  border-bottom: 1px solid rgba(75, 85, 99, 0.4);
  backdrop-filter: blur(10px);
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
  z-index: 10;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ai-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
}

.header-info {
  display: flex;
  flex-direction: column;
}

.ai-name {
  font-weight: 600;
  font-size: 14px;
  color: #f9fafb;
}

.ai-status {
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.ai-status::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}

.ai-status.online {
  color: #10b981;
}
.ai-status.online::before {
  background: #10b981;
  box-shadow: 0 0 6px #10b981;
}

.ai-status.offline {
  color: #ef4444;
}
.ai-status.offline::before {
  background: #ef4444;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.poi-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: rgba(59, 130, 246, 0.2);
  border: 1px solid rgba(59, 130, 246, 0.4);
  border-radius: 12px;
  font-size: 12px;
  color: #60a5fa;
}

/* 操作按钮通用样式 */
.action-btn {
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.clear-btn {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}
.clear-btn:hover {
  background: rgba(239, 68, 68, 0.3);
  color: #fca5a5;
}

.save-btn {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
}
.save-btn:hover {
  background: rgba(16, 185, 129, 0.3);
  color: #6ee7b7;
}

.close-btn {
  background: rgba(99, 102, 241, 0.15);
  color: #a5b4fc;
}
.close-btn:hover {
  background: rgba(99, 102, 241, 0.3);
  color: #fff;
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
  gap: 8px;
  justify-content: center;
}

.quick-action-btn {
  padding: 8px 14px;
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 20px;
  color: #a5b4fc;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.quick-action-btn:hover {
  background: rgba(99, 102, 241, 0.2);
  border-color: rgba(99, 102, 241, 0.5);
  transform: translateY(-1px);
}

/* 移动端快捷按钮优化 */
@media (max-width: 768px) {
  /* 头部布局调整 - 两行显示 */
  .chat-header {
    padding: 8px 10px;
    flex-wrap: wrap;
    gap: 6px;
  }
  
  .header-left {
    flex: 1;
    min-width: 0;
  }
  
  .ai-name {
    font-size: 14px;
  }
  
  .ai-status {
    font-size: 9px;
  }
  
  /* 按钮组占满一行 */
  .header-right {
    width: 100%;
    justify-content: flex-end;
    gap: 6px;
  }
  
  .poi-badge {
    display: none; /* 移动端隐藏 POI 徽章 */
  }
  
  .action-btn {
    padding: 5px 10px;
    font-size: 12px;
    flex: 1;
    text-align: center;
  }

  /* 快捷按钮 */
  .quick-actions {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
    padding: 0 8px;
  }
  
  .quick-action-btn {
    padding: 8px 10px;
    font-size: 12px;
    border-radius: 12px;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

/* 消息样式 */
.message {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.message.user {
  flex-direction: row-reverse;
}

.message-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.message.user .message-avatar {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: white;
}

.message.assistant .message-avatar {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: white;
}

.message-content {
  max-width: 75%;
  min-width: 60px;
}

.message-text {
  padding: 12px 16px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.6;
  word-wrap: break-word;
}

.message.user .message-text {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: white;
  border-bottom-right-radius: 4px;
}

.message.assistant .message-text {
  background: rgba(55, 65, 81, 0.6);
  color: #e5e7eb;
  border-bottom-left-radius: 4px;
  border: 1px solid rgba(75, 85, 99, 0.4);
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

/* 移动端适配 */
@media (max-width: 768px) {
  .chat-header {
    padding: 10px 12px;
  }

  .message-content {
    max-width: 85%;
  }

  .quick-actions {
    flex-direction: column;
  }

  .quick-action-btn {
    width: 100%;
  }
}
</style>
