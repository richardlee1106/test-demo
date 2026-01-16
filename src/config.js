// API Base URL 配置
// 在开发环境 (localhost) 下，我们使用空字符串，让 Vite 代理去转发 (利用 vite.config.js)
// 在生产环境 (Vercel) 下，我们直接指向您的公网服务器

export const API_BASE_URL = import.meta.env.DEV 
  ? '' 
  : 'https://api.lzgis.xyz:8443'; // 您的服务器公网地址

export default API_BASE_URL;
