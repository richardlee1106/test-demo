@echo off
REM ============================================
REM TagCloud 服务启动脚本
REM ============================================
REM 使用方法：
REM 1. 双击运行启动所有服务
REM 2. 或添加到 Windows 计划任务实现开机自启
REM ============================================

echo [TagCloud] 正在启动服务...

REM 获取脚本所在目录
set SCRIPT_DIR=%~dp0

REM 启动 Nginx
echo [1/2] 启动 Nginx...
cd /d "%SCRIPT_DIR%nginx-1.28.1"
start "" nginx.exe

REM 启动 Nuxt 后端
echo [2/2] 启动 Nuxt 后端...
cd /d "%SCRIPT_DIR%nuxt-backend"
start "" cmd /c "npm run dev"

echo.
echo ============================================
echo 所有服务已启动！
echo - Nginx (8080) - 统一入口
echo - Nuxt Backend (3000) - API 服务
echo - 前端请单独运行: npm run dev
echo ============================================
echo 访问: http://localhost:8080
pause
