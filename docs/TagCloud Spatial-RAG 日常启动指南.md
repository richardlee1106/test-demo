# 🚀 TagCloud Spatial-RAG 日常启动指南

> 首次配置完成后，每次开机需要执行的步骤

---

## 快速启动（推荐）

### 一键启动

双击运行：
```
start-all.bat
```

这个脚本会自动：
1. 启动 Docker（Milvus 向量数据库）
2. 启动后端服务（端口 3456）
3. 启动前端开发服务器（端口 5173）

---

## 手动启动（分步骤）

如果一键启动不工作，按以下顺序手动启动：

### 1️⃣ 确保 PostgreSQL 正在运行

PostgreSQL 通常作为 Windows 服务自动启动。检查方法：
- 打开 "服务"（`services.msc`）
- 找到 "postgresql-x64-xx" 服务
- 确保状态是 "正在运行"

### 2️⃣ 启动 Milvus（可选，用于语义搜索）

```bash
cd d:\AAA_Edu\TagCloud\vite-project
docker-compose up -d
```

检查状态：
- 访问 http://localhost:8000 打开 Milvus Attu 管理界面

### 3️⃣ 启动 LM Studio（可选，用于 AI 功能）

1. 打开 LM Studio
2. 加载你的 LLM 模型（如 Qwen3）
3. 如果需要语义搜索，还需加载 Embedding 模型

### 4️⃣ 启动后端服务

```bash
cd d:\AAA_Edu\TagCloud\vite-project\fastify-backend
npm run dev
```

成功标志：
```
🔌 正在连接数据库...
✅ PostgreSQL + PostGIS 连接成功
🔌 正在连接 Milvus...
✅ Milvus 连接成功 (healthy)
🚀 TagCloud Backend 运行在 http://localhost:3456
📍 空间查询 API: http://localhost:3456/api/spatial/query
```

### 5️⃣ 启动前端

```bash
cd d:\AAA_Edu\TagCloud\vite-project
npm run dev
```

成功标志：
```
VITE v5.x.x ready in xxx ms
➜ Local: http://localhost:5173/
```

---

## 服务状态检查

| 服务 | 检查方法 | 状态 |
|------|---------|------|
| PostgreSQL | `services.msc` 查看服务状态 | 应为"正在运行" |
| Milvus | 访问 http://localhost:8000 | 应能打开 Attu 界面 |
| 后端 | 访问 http://localhost:3456/health | 应返回 `{"status":"ok"}` |
| 前端 | 访问 http://localhost:5173 | 应能打开网页 |
| LM Studio | 查看 LM Studio 窗口 | 模型应已加载 |

---

## 常见问题

### 问题：后端启动失败，提示端口被占用

**解决**：检查是否有之前的进程未关闭
```bash
netstat -ano | findstr :3456
taskkill /PID <进程ID> /F
```

### 问题：Milvus 连接失败

**可能原因**：
1. Docker Desktop 未启动
2. Milvus 容器未启动

**解决**：
```bash
docker-compose up -d
```

### 问题：数据库连接失败

**可能原因**：PostgreSQL 服务未启动

**解决**：
1. 打开 `services.msc`
2. 找到 PostgreSQL 服务
3. 右键 → 启动

### 问题：前端 API 请求失败

**可能原因**：后端未启动或端口不匹配

**检查**：
1. 后端是否运行在 3456 端口
2. `vite.config.js` 中的 proxy 配置是否正确

---

## 服务依赖关系

```
PostgreSQL ─────────────────────────────────┐
                                            │
Docker ─── Milvus ──────────────────────────┼──→ 后端 (Fastify) ──→ 前端 (Vue)
                                            │
LM Studio (可选) ───────────────────────────┘
```

**必需**：PostgreSQL
**可选**：Milvus（语义搜索）、LM Studio（AI 功能）

---

## 关机顺序

1. 关闭前端窗口 (Ctrl+C)
2. 关闭后端窗口 (Ctrl+C)
3. 停止 Docker 服务：
   ```bash
   docker-compose down
   ```
4. 或直接运行 `stop-all.bat`

---

> 📅 更新时间：2026-01-12
