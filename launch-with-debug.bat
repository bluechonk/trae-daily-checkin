@echo off
rem Launch Trae with a remote debugging port.
rem Usage: double-click, or set TRAECHECKIN_EXE first to skip auto-locate.
rem Custom port: set TRAECHECKIN_PORT=9223 before running.
rem Note: keep this file ASCII-only. UTF-8 Chinese here breaks cmd parsing
rem       when chcp 65001 re-encodes line offsets mid-file.

if "%TRAECHECKIN_PORT%"=="" set TRAECHECKIN_PORT=9222

rem Skip auto-locate when a path is provided (avoids %VAR% parse-time
rem expansion inside parenthesized blocks).
if not "%TRAECHECKIN_EXE%"=="" goto run

echo [INFO] Locating Trae ...
set "PS_CMD=powershell"
where pwsh >nul 2>nul && set "PS_CMD=pwsh"
for /f "delims=" %%i in ('%PS_CMD% -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\locate-trae.ps1" 2^>nul') do set "TRAECHECKIN_EXE=%%i"

if "%TRAECHECKIN_EXE%"=="" (
  echo [ERROR] Trae not found. Set TRAECHECKIN_EXE and retry.
  pause >nul
  exit /b 1
)

:run
echo [INFO] Trae path: "%TRAECHECKIN_EXE%"
echo [INFO] Debug port: %TRAECHECKIN_PORT%
start "" "%TRAECHECKIN_EXE%" --remote-debugging-port=%TRAECHECKIN_PORT%
echo [OK] Trae launched with debug port %TRAECHECKIN_PORT%
pause >nul
