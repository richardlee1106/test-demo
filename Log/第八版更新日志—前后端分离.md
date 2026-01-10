# 开发日志：前后端分离架构与 AI 服务重构

本文档汇总了第八版开发过程中关于架构重构、安全性增强、AI 服务集成以及云端部署适配的详细技术实现。

## 1. 新增需求汇总

为了解决 AI API Key 暴露风险、提升系统安全性并支持更灵活的部署模式，本次更新主要包含：

1.  **前后端分离架构 (Frontend-Backend Separation)**：
    - 将原有的单体 Vite 应用拆分为 Vite 前端 + Nuxt.js 后端。
    - 实现 API 流量转发与统一网关管理。
2.  **AI 服务安全性增强 (Security Enhancement)**：
    - 移除前端所有敏感 API Key 配置。
    - 在后端通过环境变量安全管理凭证。
3.  **多模态 AI 服务接入 (Multi-provider AI)**：
    - 支持**本地模式**：无缝对接本地 LM Studio (Qwen, Llama 等开源模型)。
    - 支持**云端模式**：集成商业大模型 API (如 Xiaomi MiMo)。
    - 实现服务状态自动检测与故障自动降级 (Fallback)。
4.  **云原适配 (Cloud Native Adaptation)**：
    - 适配 Vercel Serverless Functions (Edge Runtime)。
    - 解决 Serverless 环境下的 SSE (Server-Sent Events) 流式响应问题。
5.  **AI 助手身份体系 (AI Identity System)**：
    - 建立统一的 "标签云 AI 助手" 身份认知。
    - 通过 System Prompt 强制注入身份设定，屏蔽底层模型差异。

---

## 2. 功能实现详解

### 2.1 前后端分离架构

**技术栈**：Vue 3, Nuxt 3 (Nitro), Nginx

**实现逻辑**：

1.  **服务拆分**：
    - **Frontend**: 专注于地图渲染 (Deck.gl)、UI 交互与状态管理。
    - **Backend**: 专注于业务逻辑、API 代理、敏感数据处理。
2.  **统一网关 (Nginx)**：
    - 配置 Nginx 作为反向代理服务器，监听 8080 端口。
    - `/` 路由转发至 Vite 开发服务器 (5173)。
    - `/api/` 路由转发至 Nuxt 后端服务器 (3000)。
    - 统一 CORS 策略与安全头部 (Headers)。

### 2.2 AI 语义搜索与流式对话

**技术栈**：Fetch API (Streams), Server-Sent Events (SSE)

**实现逻辑**：

1.  **流式响应封装**：
    - 后端使用 `h3` 的 `sendStream` 或原生 `Response` 对象通过 Pipeline 转发大模型的 SSE 数据流。
    - 确保 `Content-Type: text/event-stream` 和 `Connection: keep-alive` 正确设置。
2.  **上下文增强**：
    - **POI Context**: 自动收集当前地图视野内的 POI 数据 (名称、类别、坐标)。
    - **Prompt Engineering**: 动态构建系统提示词，将 POI 数据格式化为 AI 可读的上下文信息。
3.  **语义搜索**：
    - 前端发送自然语言查询 (如"找个喝咖啡的地方")。
    - 后端利用大模型进行语义分析，在大规模 POI 数据中进行意图匹配与筛选。

### 2.3 身份设定与隐私保护

**技术栈**：System Prompt Engineering

**实现逻辑**：

1.  **强制身份注入**：
    - 无论用户提问内容为何，系统始终在对话历史的最顶层注入 `System Message`。
    - 设定内容包括："你叫标签云 AI 助手"、"禁止透露底层模型信息"、"专注于地理信息分析"。
2.  **无数据兜底**：
    - 即使当前未选中任何 POI 数据，系统也会构建基础的身份 Prompt，防止 AI 在空上下文时 "恢复出厂设置" (暴露出 Qwen/GPT 等原始身份)。

### 2.4 Vercel Serverless 适配

**技术栈**：Vercel Edge Functions

**实现逻辑**：

1.  **Edge Runtime 兼容**：
    - 重构 API 接口，放弃 Node.js 特有的 `res.write` API。
    - 改用 Web Standard `UnreadableStream` / `ReadableStream` 进行流式输出。
2.  **配置隔离**：
    - 本地开发环境使用 `nuxt-backend` (支持本地模型调用)。
    - Vercel 部署环境使用 `/api` 目录下的 Serverless Functions (仅支持云端模型)。
    - 通过 `vercel.json` 路由规则实现环境自动切换。

---

## 3. 遇到的问题与解决办法

### 问题 1：Vercel 部署 Node 版本不兼容

- **现象**：部署失败，提示 Node.js 版本错误 (Found invalid Node.js Version: "24.x")。
- **原因**：本地使用了最新的 Node 24，但 Vercel 稳定版支持仅限于 18/20/22。
- **解决**：在 `package.json` 中显式锁定 `"engines": { "node": "20.x" }`，强制 Vercel 使用兼容的运行环境。

### 问题 2：AI 身份设定偶发失效

- **现象**：当用户在没有选中任何 POI 时提问 "你是谁"，AI 会回答 "我是 Qwen"。
- **原因**：代码逻辑中仅在 `poiFeatures.length > 0` 时才构建 System Prompt。
- **解决**：修改 Prompt 构建逻辑，确保无论是否有 POI 数据，身份设定的 System Prompt 始终被发送。

### 问题 3：Nginx Upstream 连接失败

- **现象**：Nginx 报错 502 Bad Gateway，无法连接后端。
- **原因**：Windows 环境下 `localhost` 解析与 IPv6 的兼容性问题，Nuxt 监听在 `[::1]:3000` 而 Nginx 尝试连接 `127.0.0.1:3000`。
- **解决**：统一将 Nginx upstream 配置修改为 `localhost`，利用系统自身的 hosts 解析机制。
