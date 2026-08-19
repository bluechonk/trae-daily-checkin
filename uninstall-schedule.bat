@echo off
chcp 65001 >nul
rem ============================================================
rem 删除"每日自动签到"Windows 任务计划
rem ============================================================

set "TASK_NAME=TraeDailyCheckin"

schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>nul
if errorlevel 1 (
  echo [ERROR] 任务删除失败（可能不存在）。
  pause >nul
  exit /b 1
)

echo [OK] 已删除任务：%TASK_NAME%
pause >nul
