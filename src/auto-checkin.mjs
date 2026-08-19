// src/auto-checkin.mjs
// 通过 Chrome DevTools Protocol (CDP) 自动完成 Trae SOLO CN 每日签到。
// 零第三方依赖：Node >= 18 自带的 fetch / WebSocket。

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';

// -------------------------------------------------------------
// 0. 解析命令行参数（优先）与环境变量（回退）
//    用法：
//      node src/auto-checkin.mjs
//      node src/auto-checkin.mjs --port 9223 --force
//      node src/auto-checkin.mjs --dir "D:\Tools\TRAE SOLO CN\TRAE SOLO CN.exe" --port 9223 --profile "D:\temp\trae-test-profile"
//    参数：
//      --exe / --dir <path>   Trae 可执行文件路径（不传则自动扫描定位）
//      --port <n>             CDP 调试端口（默认 9222）
//      --force                已运行但无调试端口时强制重启 Trae（也可 --force 1）
//      --profile <path>       使用独立 user-data-dir（profile）启动，隔离测试用
//      --close                签到完成后关闭 Trae 进程
//      -h, --help             显示帮助
// -------------------------------------------------------------
function parseOptions() {
  const argv = process.argv.slice(2);
  const argValue = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    exe: argValue('exe') || argValue('dir') || process.env.TRAECHECKIN_EXE?.trim() || '',
    port: Number(argValue('port') || process.env.TRAECHECKIN_PORT || 9222),
    force: argv.includes('--force') || argValue('force') === '1' || process.env.TRAECHECKIN_FORCE_RELAUNCH === '1',
    profile: argValue('profile') || argValue('user-data-dir') || process.env.TRAECHECKIN_USER_DATA_DIR?.trim() || '',
    close: argv.includes('--close') || argValue('close') === '1' || process.env.TRAECHECKIN_CLOSE === '1',
  };
}

const OPTS = parseOptions();

if (OPTS.help) {
  console.log(`用法：
  node src/auto-checkin.mjs [选项]

选项：
  --exe / --dir <path>   Trae 可执行文件路径（不传则自动扫描定位）
  --port <n>             CDP 调试端口（默认 9222）
  --force                已运行但无调试端口时强制重启 Trae（也可 --force 1）
  --profile <path>       使用独立 user-data-dir（profile）启动，隔离测试用
  --close                签到完成后关闭 Trae 进程
  -h, --help             显示帮助

示例：
  node src/auto-checkin.mjs
  node src/auto-checkin.mjs --port 9223 --force
  node src/auto-checkin.mjs --dir "D:\\Tools\\TRAE SOLO CN\\TRAE SOLO CN.exe" --port 9223 --profile "D:\\temp\\trae-test-profile"
  node src/auto-checkin.mjs --port 9223 --force --close

优先级说明：命令行参数 > 环境变量 > 自动扫描定位。
`);
  process.exit(0);
}

const DEBUG_PORT = OPTS.port;
const FORCE_RELAUNCH = OPTS.force;
const USER_DATA_DIR = OPTS.profile;
const CLI_EXE = OPTS.exe;
const CLOSE_AFTER_CHECKIN = OPTS.close;

// 启动调试端口时追加的参数（独立 profile 用）
function debugLaunchArgs() {
  const args = [`--remote-debugging-port=${DEBUG_PORT}`];
  if (USER_DATA_DIR) args.push(`--user-data-dir="${USER_DATA_DIR}"`);
  return args.join(' ');
}

// -------------------------------------------------------------
// 0. 解析 Trae 可执行文件路径
//    优先级：环境变量 TRAECHECKIN_EXE > 正在运行的进程 > 注册表 > 常见安装位置
// -------------------------------------------------------------
const COMMON_INSTALL_DIRS = [
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'D:\\Program Files',
  'D:\\Software',
  'E:\\Software',
  'D:\\',
  'C:\\Users\\',
];

function looksLikeTraeExe(p) {
  if (!p || typeof p !== 'string') return false;
  const name = path.basename(p).toLowerCase();
  const dir = p.toLowerCase();
  return /trae.*\.exe$/.test(name) && !dir.includes('agent-tool-host');
}

async function runPs(script) {
  return new Promise((resolve) => {
    // 不加 shell：直接以参数数组启动 powershell.exe，避免 cmd 解析特殊字符 & DEP0190 警告
    const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
    let out = '';
    p.stdout.on('data', d => out += d.toString());
    p.on('close', () => resolve(out.trim()));
    p.on('error', () => resolve(''));
  });
}

// 1) 正在运行的 Trae 进程，拿它的真实可执行路径
async function scanRunningProcess() {
  const out = await runPs(
    `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | Select-Object -ExpandProperty ExecutablePath -Unique`
  );
  for (const line of out.split(/\r?\n/)) {
    const p = line.trim();
    if (looksLikeTraeExe(p) && fs.existsSync(p)) {
      console.log(`[INFO] 从正在运行的进程定位到 Trae: ${p}`);
      return p;
    }
  }
  return null;
}

// 2) 从注册表卸载项里找 Trae 的 InstallLocation
async function scanRegistry() {
  const out = await runPs(`
    $roots = @(
      'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
    )
    $hits = foreach ($r in $roots) {
      if (Test-Path $r) {
        Get-ChildItem $r | ForEach-Object {
          $v = (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue)
          if ($v.DisplayName -like '*Trae*') { $v.InstallLocation }
        }
      }
    }
    $hits | Where-Object { $_ } | Sort-Object -Unique
  `);
  for (const line of out.split(/\r?\n/)) {
    const dir = line.trim();
    if (!dir) continue;
    for (const name of ['TRAE SOLO CN.exe', 'Trae.exe', 'TRAE.exe']) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        console.log(`[INFO] 从注册表定位到 Trae: ${candidate}`);
        return candidate;
      }
    }
  }
  return null;
}

// 3) 常见安装目录下做有限深度的文件扫描（避免全盘遍历太慢）
function scanCommonDirs(maxDepth = 3) {
  const hit = [];
  const walk = (dir, depth) => {
    if (hit.length || depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.toLowerCase().includes('trae')) {
          // 命中 Trae 安装目录，直接找 exe
          for (const n of ['TRAE SOLO CN.exe', 'Trae.exe', 'TRAE.exe']) {
            const exe = path.join(full, n);
            if (fs.existsSync(exe)) { hit.push(exe); return; }
          }
        }
        walk(full, depth + 1);
      } else if (e.name.toLowerCase().endsWith('.exe') && looksLikeTraeExe(full)) {
        hit.push(full); return;
      }
    }
  };
  for (const base of COMMON_INSTALL_DIRS) {
    const root = base.replace('C:\\Users\\', process.env.USERPROFILE + '\\');
    if (!fs.existsSync(root)) continue;
    walk(root, 0);
    if (hit.length) break;
  }
  if (hit.length) {
    console.log(`[INFO] 自动扫描到 Trae: ${hit[0]}`);
    return hit[0];
  }
  return null;
}

async function resolveTraePath() {
  if (CLI_EXE) {
    if (!fs.existsSync(CLI_EXE)) {
      throw new Error(`--exe/--dir 指定的路径不存在：${CLI_EXE}`);
    }
    console.log(`[INFO] 使用命令行指定的 Trae 路径: ${CLI_EXE}`);
    return CLI_EXE;
  }

  const found =
    (await scanRunningProcess()) ||
    (await scanRegistry()) ||
    scanCommonDirs();

  if (found) return found;

  throw new Error(
    '未找到 Trae SOLO CN 可执行文件。\n' +
    '请通过命令行参数指定：\n' +
    '  node src/auto-checkin.mjs --dir "你的\\TRAE SOLO CN\\TRAE SOLO CN.exe"\n' +
    '脚本会依次尝试：正在运行的进程 -> 注册表卸载项 -> 常见安装目录。'
  );
}

const TRAE_EXE = await resolveTraePath();

// 强制使用 127.0.0.1（IPv4）：避免 localhost 优先解析到 IPv6，导致连到其它也监听 9222 的应用（如豆包）
const DEBUG_URL = `http://127.0.0.1:${DEBUG_PORT}`;
const WS_URL = `${DEBUG_URL}/json`;

// -------------------------------------------------------------
// 1. 确保 Trae 已启动且调试端口可用
// -------------------------------------------------------------
async function ensureDebugPort() {
  // 1.1 端口已开，直接返回
  if (await isPortOpen()) {
    console.log('[OK] 调试端口已开放');
    return;
  }

  const running = await isTraeRunning();

  // 1.2 没有运行，直接启动并带调试端口
  if (!running) {
    console.log('[INFO] Trae 未运行，正在启动并开放调试端口...');
    launchTraeWithDebug();
    await waitForPort(30_000);
    return;
  }

  // 1.3 正在运行但没有调试端口：默认安全退出，可选强制重启
  if (running) {
    if (FORCE_RELAUNCH) {
      console.log('[WARN] 强制重启 Trae 以开放调试端口（可能丢失未保存内容）...');
      await closeTrae();
      launchTraeWithDebug();
      await waitForPort(30_000);
      return;
    }
    throw new Error(
      `Trae 正在运行，但未开启调试端口。\n` +
      `请先关闭 Trae，然后运行：\n` +
      `  "${TRAE_EXE}" ${debugLaunchArgs()}\n` +
      `或加 --force 参数让脚本自动重启：node src/auto-checkin.mjs --force`
    );
  }
}

async function isPortOpen() {
  try {
    const res = await fetch(`${DEBUG_URL}/json/version`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function isTraeRunning() {
  const cmd = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*TRAE SOLO CN*' } | Select-Object ProcessId`;
  return new Promise((resolve, reject) => {
    const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd]);
    let out = '';
    p.stdout.on('data', d => out += d.toString());
    p.on('close', () => resolve(/ProcessId/.test(out) && out.trim().split('\n').length > 1));
    p.on('error', reject);
  });
}

function launchTraeWithDebug() {
  // 用 start 命令脱离当前进程，避免 Node 持有子进程句柄导致关闭时 UV 断言崩溃
  const cmd = `start "" "${TRAE_EXE}" ${debugLaunchArgs()}`;
  spawn('cmd', ['/c', cmd], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

async function closeTrae() {
  const cmd = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*TRAE SOLO CN*' -or $_.Name -eq 'agent-tool-host.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  return new Promise((resolve, reject) => {
    const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd]);
    p.on('close', () => resolve());
    p.on('error', reject);
  });
}

async function waitForPort(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen()) return;
    await sleep(500);
  }
  throw new Error('等待调试端口超时');
}

// -------------------------------------------------------------
// 2. CDP 连接工具
// -------------------------------------------------------------
async function connectCDP() {
  const res = await fetch(WS_URL);
  const targets = await res.json();
  const pageTarget = targets.find(t => t.type === 'page');
  if (!pageTarget) {
    throw new Error('未找到 page 类型的 CDP target');
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });

  const send = (method, params) => new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });

  await send('Runtime.enable');
  return { ws, send, evaluate: expr => send('Runtime.evaluate', { expression: expr, returnByValue: true }) };
}

// -------------------------------------------------------------
// 3. DOM 操作：打开头像菜单、检测并点击签到
// -------------------------------------------------------------
async function performCheckIn(cdp) {
  const { evaluate } = cdp;

  // 3.1 打开账户菜单（状态感知：如果已经打开就不再点）
  const menuAlreadyOpen = await evaluate(`!!document.querySelector('[class*="accountPopover"]')`);
  if (!menuAlreadyOpen.result.result.value) {
    console.log('[INFO] 点击左下角头像...');
    await evaluate(`
      (() => {
        const el = document.querySelector('[class*="accountTrigger"]');
        if (el) { el.click(); return true; }
        return false;
      })()
    `);
    // 菜单渲染可能需要时间，轮询等待最多 5 秒
    for (let i = 0; i < 10; i++) {
      await sleep(500);
      const open = await evaluate(`!!document.querySelector('[class*="accountPopover"]')`);
      if (open.result.result.value) break;
    }
  } else {
    console.log('[INFO] 账户菜单已经打开');
  }

  // 3.2 读取签到按钮当前状态
  const inspect = await evaluate(`
    (() => {
      const btn = document.querySelector('[class*="accountCheckinButton"]');
      const label = document.querySelector('[class*="accountCheckinButtonLabel"]');
      if (!btn) return { error: 'checkin_button_not_found' };
      return {
        buttonText: label ? (label.textContent || '').trim() : (btn.textContent || '').trim(),
        title: (document.querySelector('[class*="accountCheckinTitle"]')?.textContent || '').trim()
      };
    })()
  `);
  const state = inspect.result.result.value;
  console.log(`[INFO] 签到按钮状态: ${JSON.stringify(state)}`);

  if (state.error) {
    // 区分"未登录"与"类名已变化"：检查账户菜单里是否出现登录入口
    const loginHint = await evaluate(`
      (() => {
        const menu = document.querySelector('[class*="accountPopover"]');
        if (!menu) return { menuOpen: false };
        const t = (menu.textContent || '');
        return {
          menuOpen: true,
          hasLogin: /登录|扫码|立即登录|手机号/.test(t),
          sample: t.replace(/\\s+/g, ' ').slice(0, 80)
        };
      })()
    `);
    const hint = loginHint.result.result.value;
    if (hint.menuOpen && hint.hasLogin) {
      return { status: 'not_logged_in', detail: hint.sample };
    }
    throw new Error('未找到每日签到按钮，可能类名已变化');
  }

  if (/已签/.test(state.buttonText)) {
    return { status: 'already_signed', detail: state.buttonText };
  }

  // 3.3 点击签到按钮
  console.log('[INFO] 尝试点击签到按钮...');
  const clicked = await evaluate(`
    (() => {
      const btn = document.querySelector('[class*="accountCheckinButton"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `);

  if (!clicked.result.result.value) {
    return { status: 'click_failed' };
  }

  await sleep(2000);

  // 3.4 验证：按钮文字是否变成"今日已签"
  const verify = await evaluate(`
    (() => {
      const label = document.querySelector('[class*="accountCheckinButtonLabel"]');
      const btn = document.querySelector('[class*="accountCheckinButton"]');
      return label ? (label.textContent || '').trim() : (btn ? (btn.textContent || '').trim() : 'button_gone');
    })()
  `);

  const afterText = verify.result.result.value;
  if (/已签/.test(afterText)) {
    return { status: 'success', detail: afterText };
  }
  return { status: 'unknown', detail: afterText };
}

// -------------------------------------------------------------
// 4. 主流程
// -------------------------------------------------------------
async function main() {
  try {
    await ensureDebugPort();
    console.log('[INFO] 连接 CDP...');
    const cdp = await connectCDP();
    const result = await performCheckIn(cdp);
    cdp.ws.close();
    await sleep(300); // 等 WebSocket 句柄释放后再退出

    console.log('[RESULT]', JSON.stringify(result, null, 2));

    // 签到完成（无论成功/已签/失败）后，可选关闭 Trae 进程
    if (CLOSE_AFTER_CHECKIN) {
      console.log('[INFO] --close 已指定，正在关闭 Trae...');
      await closeTrae();
      console.log('[INFO] Trae 已关闭');
    }

    if (result.status === 'success') {
      process.exit(0);
    } else if (result.status === 'already_signed') {
      process.exit(2); // 已签也是一种"成功"，但用不同退出码方便调度
    } else {
      process.exit(1);
    }
  } catch (err) {
    console.error('[ERROR]', err.message);
    process.exit(1);
  }
}

main();
