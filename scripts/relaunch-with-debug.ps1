# scripts/relaunch-with-debug.ps1
# 强制关闭当前 Trae 并以调试端口重新启动（适合 Trae 已经在运行但没有开放调试端口的情况）
# 用法：
#   pwsh -ExecutionPolicy Bypass -File scripts\relaunch-with-debug.ps1          # 自动定位 Trae
#   pwsh -ExecutionPolicy Bypass -File scripts\relaunch-with-debug.ps1 -ExePath "D:\My\Trae CN\Trae CN.exe" -Port 9223
# 注意：本文件含中文，必须保持 UTF-8 with BOM。
param(
  [int]$Port = 9222,
  [string]$ExePath = ''
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# 复用 locate-trae.ps1 的定位逻辑（ExePath 为空时不要传 -ExePath 参数）
if ($ExePath) {
  $locateResult = & pwsh -NoProfile -ExecutionPolicy Bypass -File "$ScriptDir\locate-trae.ps1" -ExePath $ExePath 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $locateResult) {
    # 回退 powershell 5 再试一次（ locate-trae.ps1 带 BOM，PS5.1 可正常解析）
    $locateResult = & powershell -NoProfile -ExecutionPolicy Bypass -File "$ScriptDir\locate-trae.ps1" -ExePath $ExePath 2>$null
  }
} else {
  $locateResult = & pwsh -NoProfile -ExecutionPolicy Bypass -File "$ScriptDir\locate-trae.ps1" 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $locateResult) {
    $locateResult = & powershell -NoProfile -ExecutionPolicy Bypass -File "$ScriptDir\locate-trae.ps1" 2>$null
  }
}
if ($LASTEXITCODE -ne 0 -or -not $locateResult) {
  throw "未找到 Trae 可执行文件。请通过 -ExePath 或环境变量 TRAECHECKIN_EXE 指定。"
}
$ExePath = $locateResult.Trim()
Write-Host "[INFO] 使用 Trae 路径: $ExePath"

# 杀掉 Trae 安装目录下的所有进程（主程序 + Electron 子进程 + 辅助工具），
# 不再硬编码进程名——本机安装名可能是 Trae CN.exe 而不是 TRAE SOLO CN.exe
$exeDir = (Split-Path -Parent $ExePath).TrimEnd('\')
Write-Host '正在关闭 Trae 及其子进程...'
Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and ($_.ExecutablePath -like "$exeDir\*")
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "  killed PID $($_.ProcessId) [$($_.Name)]"
}

Start-Sleep -Seconds 3
Write-Host "正在启动 Trae 并开放调试端口 $Port ..."
Start-Process -FilePath $ExePath -ArgumentList "--remote-debugging-port=$Port"
Write-Host '完成。脚本可立即使用 node src/auto-checkin.mjs 连接。'
