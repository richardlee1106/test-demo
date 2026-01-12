import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'

const app = createApp(App)

// 配置 Element Plus，设置消息提示默认显示时间为 2 秒
app.use(ElementPlus, {
  // ElMessage 默认配置
  message: {
    duration: 2000, // 2 秒
    grouping: true  // 相同消息合并
  }
})

app.mount('#app')
