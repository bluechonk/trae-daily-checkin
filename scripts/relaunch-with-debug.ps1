# scripts/relaunch-with-debug.ps1
# 强制关闭当前 Trae 并以调试端口重新启动（适合 Trae 已经在运行但没有开放调试端口的情况）
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\relaunch-with-debug.ps1          # 自动定位 Trae
#   powershell -ExecutionPolicy Bypass -File scripts\relaunch-with-debug.ps1 -ExePath "D:\My\TRAE SOLO CN\TRAE SOLO CN.exe" -Port 9223
param(
  [int]$Port = 9222,
  [string]$ExePath = ''
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# 复用 locate-trae.ps1 的定位逻辑（ExePath 为空时不要传 -ExePath 参数）
if ($ExePath) {
  $locateResult = & powershell -NoProfile -ExecutionPolicy Bypass -File "$ScriptDir\locate-trae.ps1" -ExePath $ExePath 2>$null
} else {
  $locateResult = & powershell -NoProfile -ExecutionPolicy Bypass -File "$ScriptDir\locate-trae.ps1" 2>$null
}
if ($LASTEXITCODE -ne 0 -or -not $locateResult) {
  throw "未找到 Trae 可执行文件。请通过 -ExePath 或环境变量 TRAECHECKIN_EXE 指定。"
}
$ExePath = $locateResult.Trim()
Write-Host "[INFO] 使用 Trae 路径: $ExePath"

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
