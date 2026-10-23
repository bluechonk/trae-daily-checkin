@echo off
rem Install a daily Windows scheduled task for auto check-in.
rem Usage:   install-schedule.bat            (default 12:00)
rem          install-schedule.bat 09:30     (custom time, 24h)
rem Note: keep this file ASCII-only. UTF-8 Chinese here breaks cmd parsing.

set "TASK_NAME=TraeDailyCheckin"
set "TIME=12:00"
if not "%1"=="" set "TIME=%1"

rem Project dir is the folder containing this bat (with trailing backslash).
set "PROJECT_DIR=%~dp0"
set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found in PATH. Install Node.js first.
  pause >nul
  exit /b 1
)

rem Delete existing task first to avoid duplicate-registration errors.
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>nul

schtasks /Create /TN "%TASK_NAME%" /TR "\"%NODE_EXE%\" \"%PROJECT_DIR%src\auto-checkin.mjs\" --force --close" /SC DAILY /ST "%TIME%" /F

if errorlevel 1 (
  echo [ERROR] Failed to create scheduled task.
  pause >nul
  exit /b 1
)

echo [OK] Task created: %TASK_NAME% (daily at %TIME%)
echo Query: schtasks /Query /TN "%TASK_NAME%" /V
echo Remove: uninstall-schedule.bat
pause >nul
