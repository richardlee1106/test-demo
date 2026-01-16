-- 1. 确保 PostGIS 和 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. 为 pois 表创建空间索引 (GIST)
-- 如果导入数据时没有索引，查询 80w+ 条数据会非常慢
CREATE INDEX IF NOT EXISTS pois_geom_idx ON pois USING GIST (geom);

-- 3. 为类别字段创建索引，加速分类查询
CREATE INDEX IF NOT EXISTS pois_category_mid_idx ON pois (category_mid);
CREATE INDEX IF NOT EXISTS pois_category_small_idx ON pois (category_small);
CREATE INDEX IF NOT EXISTS pois_type_idx ON pois (type);

-- 4. 为名称创建索引，加速快速搜索
-- 使用 gin + trgm 可以支持模糊匹配加速，但需要 pg_trgm 扩展
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS pois_name_trgm_idx ON pois USING gin (name gin_trgm_ops);

-- 5. 确保向量表索引也存在 (虽然 initVectorDB 会做，但在 SQL 里放一份更稳)
CREATE INDEX IF NOT EXISTS poi_embeddings_vector_idx ON poi_embeddings USING hnsw (embedding vector_cosine_ops);

-- 6. 分析表以更新统计信息，让查询优化器更聪明
ANALYZE pois;
ANALYZE landmarks;
