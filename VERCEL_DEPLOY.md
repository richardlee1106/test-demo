# Vercel 部署指南

## 📋 概述

本项目支持在 Vercel 上部署前端和后端（Serverless Functions）。
API Key 等敏感信息通过 Vercel 环境变量管理，不会暴露在代码中。

---

## 🚀 部署步骤

### 1. 推送代码到 GitHub

```bash
git add .
git commit -m "Add Vercel Serverless Functions for AI backend"
git push
```

### 2. 在 Vercel 中设置环境变量

1. 登录 [Vercel Dashboard](https://vercel.com/dashboard)
2. 选择你的项目
3. 点击 **Settings** → **Environment Variables**
4. 添加以下环境变量：

| 变量名         | 值           | 说明               |
| -------------- | ------------ | ------------------ |
| `MIMO_API_KEY` | `sk-xxxx...` | 小米 MiMo API 密钥 |

5. 点击 **Save**

### 3. 重新部署

设置环境变量后，需要重新部署才能生效：

1. 在 Vercel Dashboard 中点击 **Deployments**
2. 点击最新部署的 **...** 菜单
3. 选择 **Redeploy**

---

## 📁 文件结构

```
vite-project/
├── api/                        # Vercel Serverless Functions
│   └── ai/
│       ├── chat.js             # POST /api/ai/chat - 流式聊天
│       ├── search.js           # POST /api/ai/search - 语义搜索
│       └── status.js           # GET /api/ai/status - 服务状态
├── src/                        # 前端源码
├── vercel.json                 # Vercel 配置
└── ...
```

---

## 🔌 API 接口

### POST /api/ai/chat

流式 AI 聊天（SSE 格式）

**请求体：**

```json
{
  "messages": [{ "role": "user", "content": "分析 POI 分布" }],
  "poiFeatures": [...],
  "options": { "temperature": 0.7 }
}
```

### POST /api/ai/search

语义搜索 POI

**请求体：**

```json
{
  "keyword": "奶茶",
  "poiNames": ["蜜雪冰城", "海底捞", ...],
  "batchIndex": 0
}
```

### GET /api/ai/status

检查 AI 服务状态

---

## ⚠️ 注意事项

1. **本地开发 vs 线上部署**

   - 本地开发：使用 `nuxt-backend`（支持本地 LM Studio）
   - 线上部署：使用 `api/` 目录（只支持 MiMo 云服务）

2. **环境变量安全**

   - `MIMO_API_KEY` 只在 Vercel 服务器端可用
   - 前端代码无法访问此变量

3. **冷启动延迟**
   - Serverless 函数首次调用可能有 1-2 秒延迟
   - 后续调用会更快

---

## 🔧 本地测试 Vercel Functions

```bash
# 安装 Vercel CLI
npm i -g vercel

# 本地开发
vercel dev
```

这会在本地启动一个模拟 Vercel 环境的服务器。
