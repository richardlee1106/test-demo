#!/bin/bash
# 安装 pgvector 扩展
# 该脚本在数据库容器首次启动时自动执行

set -e

echo "=== 安装 pgvector 扩展 ==="

# 安装编译依赖
apt-get update
apt-get install -y --no-install-recommends \
    build-essential \
    git \
    postgresql-server-dev-16

# 克隆并编译 pgvector
cd /tmp
git clone --branch v0.8.0 https://github.com/pgvector/pgvector.git
cd pgvector
make
make install

# 清理
apt-get remove -y build-essential git postgresql-server-dev-16
apt-get autoremove -y
rm -rf /tmp/pgvector
apt-get clean

echo "=== pgvector 安装完成 ==="
