# scripts/locate-trae.ps1
# 定位 Trae 可执行文件路径（仅供其它脚本调用，不执行任何启动/关闭操作）
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\locate-trae.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\locate-trae.ps1 -ExePath "D:\My\TRAE SOLO CN\TRAE SOLO CN.exe"
# 优先级：参数 -ExePath > 环境变量 TRAECHECKIN_EXE > 正在运行的进程 > 注册表 > 常见安装目录
param(
  [string]$ExePath = ''
)

if ($ExePath) {
  if (Test-Path -LiteralPath $ExePath) { Write-Output (Resolve-Path -LiteralPath $ExePath).Path; exit 0 }
  Write-Error "指定路径不存在：$ExePath"; exit 1
}
if ($env:TRAECHECKIN_EXE) {
  if (Test-Path -LiteralPath $env:TRAECHECKIN_EXE) { Write-Output (Resolve-Path -LiteralPath $env:TRAECHECKIN_EXE).Path; exit 0 }
  Write-Error "环境变量 TRAECHECKIN_EXE 指定的路径不存在：$($env:TRAECHECKIN_EXE)"; exit 1
}

# 1) 正在运行的 Trae 主进程（只匹配文件名以 TRAE 开头的 exe，避免误匹配 browser-bridge 等）
$proc = Get-CimInstance Win32_Process |
  Where-Object {
    $_.ExecutablePath -and
    ((Split-Path $_.ExecutablePath -Leaf) -match '^TRAE.*\.exe$') -and
    ($_.ExecutablePath -notmatch 'agent-tool-host')
  } |
  Select-Object -First 1 -ExpandProperty ExecutablePath
if ($proc) {
  Write-Output $proc
  Write-Verbose "[INFO] 从正在运行的进程定位到 Trae: $proc"
  exit 0
}

# 2) 注册表卸载项里的 InstallLocation
$roots = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
)
foreach ($r in $roots) {
  if (Test-Path $r) {
    foreach ($child in Get-ChildItem $r) {
      try {
        $v = Get-ItemProperty $child.PSPath -ErrorAction SilentlyContinue
        if ($v.DisplayName -like '*Trae*' -and $v.InstallLocation) {
          foreach ($n in @('TRAE SOLO CN.exe', 'Trae.exe', 'TRAE.exe')) {
            $candidate = Join-Path $v.InstallLocation $n
            if (Test-Path -LiteralPath $candidate) {
              Write-Output $candidate
              Write-Verbose "[INFO] 从注册表定位到 Trae: $candidate"
              exit 0
            }
          }
        }
      } catch { }
    }
  }
}

# 3) 常见安装目录（有限深度扫描）
$bases = @(
  'C:\Program Files', 'C:\Program Files (x86)',
  "$env:LOCALAPPDATA\Programs",
  "$env:USERPROFILE"
)
foreach ($base in $bases) {
  if (-not (Test-Path -LiteralPath $base)) { continue }
  $found = Get-ChildItem -LiteralPath $base -Recurse -Depth 3 -Filter '*.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^TRAE( SOLO CN)?\.exe$' } |
    Select-Object -First 1
  if ($found) {
    Write-Output $found.FullName
    Write-Verbose "[INFO] 自动扫描到 Trae: $($found.FullName)"
    exit 0
  }
}

Write-Error "未找到 Trae 可执行文件。请通过 -ExePath 或环境变量 TRAECHECKIN_EXE 指定。"
exit 1
