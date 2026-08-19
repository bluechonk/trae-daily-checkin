# scripts/relaunch-with-debug.ps1
# 强制关闭当前 Trae 并以调试端口重新启动（适合 Trae 已经在运行但没有开放 9222 端口的情况）
param(
  [int]$Port = 9222,
  [string]$ExePath = 'D:\Software\TRAE SOLO CN\TRAE SOLO CN.exe'
)

Write-Host '正在关闭 Trae 及其子进程...'
Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -like '*TRAE SOLO CN*' -or $_.ExecutablePath -like '*agent-tool-host*'
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "  killed PID $($_.ProcessId)"
}

Start-Sleep -Seconds 3
Write-Host "正在启动 Trae 并开放调试端口 $Port ..."
Start-Process -FilePath $ExePath -ArgumentList "--remote-debugging-port=$Port"
Write-Host '完成。脚本可立即使用 node src/auto-checkin.mjs 连接。'
