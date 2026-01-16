import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'

const app = createApp(App)

// 配置 Element Plus
app.use(ElementPlus, {
  // ElMessage 默认配置
  message: {
    duration: 1500,    // 1.5 秒
    grouping: true,    // 相同消息合并
    offset: 100,       // 距离顶部 100px (确保在 68px header 下方)
    showClose: true    // 显示关闭按钮
  }
})

app.mount('#app')
