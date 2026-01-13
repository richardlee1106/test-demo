@echo off
chcp 65001 >nul
title TagCloud 服务停止器

echo ============================================
echo  TagCloud 服务停止器
echo ============================================
echo.

echo [1/2] 停止 Docker 服务（Milvus）...
cd /d "%~dp0"
docker-compose down
echo.

echo [2/2] 提示：请手动关闭后端和前端窗口
echo.

echo ============================================
echo  服务已停止
echo ============================================
pause
