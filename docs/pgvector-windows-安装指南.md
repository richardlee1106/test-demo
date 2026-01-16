# 🔧 pgvector Windows 安装指南

> GeoLoom-RAG 使用 pgvector 进行向量语义搜索

---

## 📋 问题诊断

如果您看到以下错误：

```
extension "vector" is not available
Could not open extension control file "D:/Program Files/PostgreSQL/17/share/extension/vector.control"
```

说明 pgvector 扩展尚未安装到您的 PostgreSQL 中。

---

## 🚀 安装方法（Windows + PostgreSQL 17）

### 方法 1：使用预编译二进制文件（推荐）

1. **下载预编译包**
   - 访问 <https://github.com/pgvector/pgvector/releases>
   - 下载对应 PostgreSQL 17 的 Windows 版本
   - 或者使用 <https://github.com/pgvector/pgvector-windows/releases>

2. **解压并复制文件**

   ```powershell
   # 解压后，将以下文件复制到对应目录：
   # vector.dll     -> D:\Program Files\PostgreSQL\17\lib\
   # vector.control -> D:\Program Files\PostgreSQL\17\share\extension\
   # vector*.sql    -> D:\Program Files\PostgreSQL\17\share\extension\
   ```

3. **重启 PostgreSQL 服务**

   ```powershell
   # 以管理员身份运行
   net stop postgresql-x64-17
   net start postgresql-x64-17
   ```

4. **在数据库中启用扩展**

   ```sql
   CREATE EXTENSION vector;
   ```

### 方法 2：使用 Docker（最简单）

如果安装遇到困难，可以使用带 pgvector 的 Docker 镜像：

```yaml
# docker-compose.yml
version: '3.8'
services:
  postgres:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_PASSWORD: your_password
      POSTGRES_DB: geoloom
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

然后修改 `.env` 文件指向 Docker 容器。

### 方法 3：使用 vcpkg 编译（高级）

```powershell
# 需要 Visual Studio 和 CMake
git clone https://github.com/pgvector/pgvector
cd pgvector
# 按照 README 编译
```

---

## ✅ 验证安装

安装完成后，在 psql 或 pgAdmin 中执行：

```sql
-- 1. 检查扩展是否可用
SELECT * FROM pg_available_extensions WHERE name = 'vector';

-- 2. 创建扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 3. 验证版本
SELECT extversion FROM pg_extension WHERE extname = 'vector';

-- 4. 测试向量功能
SELECT '[1,2,3]'::vector;
```

---

## 🔄 迁移向量数据

安装 pgvector 后，运行迁移脚本：

```powershell
cd fastify-backend
npm run migrate:vectors
```

---

## 📊 验证迁移结果

运行后端服务后，可以用以下 SQL 检查：

```sql
-- 查看向量表记录数
SELECT COUNT(*) FROM poi_embeddings;

-- 查看示例数据
SELECT poi_id, name, vector_dims(embedding) as dims 
FROM poi_embeddings 
LIMIT 5;

-- 测试语义搜索（示例）
-- 假设你有一个查询向量
SELECT poi_id, name, embedding <=> '[0.1, 0.2, ...]'::vector as distance
FROM poi_embeddings
ORDER BY distance
LIMIT 10;
```

---

## 🛡️ 降级模式

如果暂时无法安装 pgvector，系统会自动降级运行：

- ✅ 快速搜索（关键词匹配）正常工作
- ✅ PostGIS 空间查询正常工作
- ❌ 语义搜索（向量相似度）不可用

后端日志会显示：

```
❌ pgvector 初始化失败: extension "vector" is not available
💡 提示: 请安装 pgvector 扩展
```

---

## 📞 需要帮助？

如果遇到问题，请提供以下信息：

- PostgreSQL 版本：`SELECT version();`
- Windows 版本
- 错误完整信息
