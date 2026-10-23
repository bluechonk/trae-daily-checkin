# scripts/locate-trae.ps1
# 定位 Trae 可执行文件路径（仅供其它脚本调用，不执行任何启动/关闭操作）
# 用法：
#   pwsh -ExecutionPolicy Bypass -File scripts\locate-trae.ps1
#   pwsh -ExecutionPolicy Bypass -File scripts\locate-trae.ps1 -ExePath "D:\My\Trae CN\Trae CN.exe"
# 优先级：参数 -ExePath > 环境变量 TRAECHECKIN_EXE > 正在运行的进程 > 注册表 > 常见安装目录
# 注意：本文件含中文，必须保持 UTF-8 with BOM，否则 PowerShell 5.1 按 GBK 读取会解析崩溃。
param(
  [string]$ExePath = ''
)

# 安装包/卸载器/辅助进程不算主程序（曾把 TRAE_CN-Setup-x64.exe 误当主程序）
$exeBlacklist = '(?i)setup|unins|update|installer|agent-tool-host'

if ($ExePath) {
  if (Test-Path -LiteralPath $ExePath) { Write-Output (Resolve-Path -LiteralPath $ExePath).Path; exit 0 }
  Write-Error "指定路径不存在：$ExePath"; exit 1
}
if ($env:TRAECHECKIN_EXE) {
  if (Test-Path -LiteralPath $env:TRAECHECKIN_EXE) { Write-Output (Resolve-Path -LiteralPath $env:TRAECHECKIN_EXE).Path; exit 0 }
  Write-Error "环境变量 TRAECHECKIN_EXE 指定的路径不存在：$($env:TRAECHECKIN_EXE)"; exit 1
}

# 1) 正在运行的 Trae 主进程（Trae CN.exe / TRAE SOLO CN.exe / Trae.exe 均覆盖）
$proc = Get-CimInstance Win32_Process |
  Where-Object {
    $_.ExecutablePath -and
    ((Split-Path $_.ExecutablePath -Leaf) -match '^Trae.*\.exe$') -and
    ($_.ExecutablePath -notmatch $exeBlacklist)
  } |
  Select-Object -First 1 -ExpandProperty ExecutablePath
if ($proc) {
  Write-Output $proc
  exit 0
}

# 2) 注册表卸载项里的 InstallLocation
$candidateNames = @('Trae CN.exe', 'TRAE SOLO CN.exe', 'Trae.exe', 'TRAE.exe')
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
        if ($v.DisplayName -match 'Trae' -and $v.InstallLocation) {
          foreach ($n in $candidateNames) {
            $candidate = Join-Path $v.InstallLocation $n
            if (Test-Path -LiteralPath $candidate) {
              Write-Output $candidate
              exit 0
            }
          }
          # InstallLocation 下按文件名规则兜底（应对未来版本改名）
          foreach ($f in Get-ChildItem -LiteralPath $v.InstallLocation -Filter '*.exe' -ErrorAction SilentlyContinue) {
            if ($f.Name -match '^Trae.*\.exe$' -and $f.Name -notmatch $exeBlacklist) {
              Write-Output $f.FullName
              exit 0
            }
          }
        }
      } catch { }
    }
  }
}

# 3) 常见安装目录（有限深度扫描，含用户级安装位置 LOCALAPPDATA）
$bases = @(
  "$env:LOCALAPPDATA\Programs",
  'C:\Program Files', 'C:\Program Files (x86)',
  "$env:USERPROFILE"
)
foreach ($base in $bases) {
  if (-not (Test-Path -LiteralPath $base)) { continue }
  $found = Get-ChildItem -LiteralPath $base -Recurse -Depth 3 -Filter '*.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^Trae.*\.exe$' -and $_.Name -notmatch $exeBlacklist } |
    Select-Object -First 1
  if ($found) {
    Write-Output $found.FullName
    exit 0
  }
}

Write-Error "未找到 Trae 可执行文件。请通过 -ExePath 或环境变量 TRAECHECKIN_EXE 指定。"
exit 1
