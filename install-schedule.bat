@echo off
chcp 65001 >nul
rem ============================================================
rem 安装"每日自动签到"Windows 任务计划
rem 用法：
rem   install-schedule.bat             默认每天 12:00 签到
rem   install-schedule.bat 09:30       自定义时间（24 小时制）
rem ============================================================

set "TASK_NAME=TraeDailyCheckin"
set "TIME=12:00"
if not "%1"=="" set "TIME=%1"

rem 定位项目目录（本 bat 所在目录）
set "PROJECT_DIR=%~dp0"
set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] 未找到 node，请先安装 Node.js 并加入 PATH。
  pause >nul
  exit /b 1
)

rem 若任务已存在，先删除（避免重复注册报错）
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>nul

rem 注册任务：每天指定时间运行签到脚本
schtasks /Create /TN "%TASK_NAME%" /TR "\"%NODE_EXE%\" \"%PROJECT_DIR%src\auto-checkin.mjs\" --force --close" /SC DAILY /ST "%TIME%" /F

if errorlevel 1 (
  echo [ERROR] 任务注册失败。
  pause >nul
  exit /b 1
)

echo [OK] 已创建每日自动签到任务：
echo   任务名: %TASK_NAME%
echo   时间  : 每天 %TIME%
echo   命令  : node src\auto-checkin.mjs --force --close
echo.
echo 可用 schtasks /Query /TN "%TASK_NAME%" /V 查看详情。
echo 删除任务请运行 uninstall-schedule.bat
pause >nul
