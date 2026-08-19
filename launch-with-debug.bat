@echo off
chcp 65001 >nul
:: 启动 Trae SOLO CN 并开放远程调试端口
:: 用法：双击本文件后再运行 node src/auto-checkin.mjs

start "" "D:\Software\TRAE SOLO CN\TRAE SOLO CN.exe" --remote-debugging-port=9222
echo Trae 已启动，调试端口 9222 已开放。
echo 可按 Enter 关闭本窗口。
pause >nul
