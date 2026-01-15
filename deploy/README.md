# GeoLoom-RAG 服务器部署指南

## 📦 部署包内容

```
deploy/
├── docker-compose.yml      # Docker 编排配置
├── .env.example            # 环境变量模板
├── backend/                # 后端代码
│   ├── Dockerfile
│   ├── server.js
│   ├── routes/
│   ├── services/
│   └── package.json
├── docker-init/            # 数据库初始化脚本
│   ├── 00-install-pgvector.sh
│   └── 01-init-schema.sql
└── data/                   # 数据导出目录
    └── geoloom_backup.sql  # 本地导出的数据
```

---

## 🚀 部署步骤

### 第一步：本地准备（在你的 Windows 电脑上）

#### 1.1 导出数据库（包含 POI 和向量数据）

```bash
# 进入 deploy 目录
cd d:\AAA_Edu\TagCloud\vite-project\deploy

# 导出完整数据库
pg_dump -h localhost -U postgres -d geoloom --data-only -t pois -t poi_embeddings > data/geoloom_backup.sql
```

#### 1.2 复制后端代码到 deploy/backend

```bash
# 复制后端代码（不含 node_modules）
xcopy ..\fastify-backend\*.* backend\ /E /EXCLUDE:exclude.txt
```

或者手动复制以下文件/文件夹到 `deploy/backend/`：

- `server.js`
- `package.json`
- `package-lock.json`
- `routes/` 文件夹
- `services/` 文件夹

#### 1.3 配置环境变量

```bash
# 复制模板
copy .env.example .env

# 编辑 .env，修改密码和 API Key
```

---

### 第二步：上传到服务器

```bash
# 使用 scp 或 SFTP 工具上传整个 deploy 文件夹
scp -r deploy/ root@你的服务器IP:/home/geoloom/
```

---

### 第三步：服务器上部署

#### 3.1 安装 Docker（如果没有）

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 安装 docker-compose
sudo apt install docker-compose
```

#### 3.2 启动服务

```bash
cd /home/geoloom/deploy

# 首次启动（构建镜像 + 启动容器）
docker-compose up -d --build

# 查看日志
docker-compose logs -f
```

**⚠️ 首次启动需要等待 2-3 分钟**（编译 pgvector 扩展）

#### 3.3 导入数据

```bash
# 等数据库完全启动后（约2-3分钟）
docker exec -i geoloom-db psql -U postgres geoloom < data/geoloom_backup.sql

# 验证数据
docker exec -it geoloom-db psql -U postgres geoloom -c "SELECT COUNT(*) FROM pois;"
docker exec -it geoloom-db psql -U postgres geoloom -c "SELECT COUNT(*) FROM poi_embeddings;"
```

---

## 🔧 常用命令

```bash
# 查看运行状态
docker-compose ps

# 查看日志
docker-compose logs -f api    # 后端日志
docker-compose logs -f db     # 数据库日志

# 重启服务
docker-compose restart

# 停止服务
docker-compose down

# 完全清理（包括数据）
docker-compose down -v
```

---

## 🌐 配置 Nginx 反向代理

在服务器上安装 Nginx 后，添加以下配置：

```nginx
# /etc/nginx/sites-available/geoloom
server {
    listen 80;
    server_name your-domain.com;  # 或者用 IP

    # API 代理
    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 120s;  # AI 请求可能较慢
    }

    # 健康检查
    location /health {
        proxy_pass http://127.0.0.1:3000/health;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/geoloom /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 📝 Vercel 前端配置

在 Vercel 项目设置中，添加环境变量：

```
VITE_API_BASE_URL=http://你的服务器IP:3000
```

或者如果配置了 Nginx：

```
VITE_API_BASE_URL=http://your-domain.com
```

---

## ❓ 常见问题

### Q: pgvector 编译失败？

A: 确保服务器能访问 GitHub。如果不能，可以先在本地构建好镜像再上传。

### Q: 数据库连接失败？

A: 检查 `.env` 中的 `DB_PASSWORD` 是否与 docker-compose.yml 中一致。

### Q: 后端 API 无响应？

A: 查看日志 `docker-compose logs api`，检查是否有错误。

### Q: 向量搜索不工作？

A: 确认 poi_embeddings 表有数据：

```bash
docker exec -it geoloom-db psql -U postgres geoloom -c "SELECT COUNT(*) FROM poi_embeddings;"
```
