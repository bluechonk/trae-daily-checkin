@echo off
rem Remove the daily auto check-in scheduled task.
rem Note: keep this file ASCII-only. UTF-8 Chinese here breaks cmd parsing.

set "TASK_NAME=TraeDailyCheckin"

schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Failed to delete task - it may not exist.
  pause >nul
  exit /b 1
)

echo [OK] Task removed: %TASK_NAME%
pause >nul
