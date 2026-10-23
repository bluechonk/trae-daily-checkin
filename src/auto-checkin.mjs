// src/auto-checkin.mjs
// 通过 Chrome DevTools Protocol (CDP) 自动完成 Trae 每日签到。
// 零第三方依赖：Node >= 18 自带的 fetch / WebSocket。
//
// 2026-10-23 重写，修复实测发现的 bug：
//   1) CDP target 误选：Electron 存在多个 page（floatingButton.html 浮窗），
//      必须优先选择主工作台（solo-lite.html / workbench），否则永远找不到签到按钮。
//   2) 进程名硬编码 *TRAE SOLO CN*：实际安装名是 Trae CN.exe（还有 Trae.exe），
//      导致"是否在运行"永远判否、--close 关不掉进程。
//   3) 自动定位误把 Downloads 里的安装包 TRAE_CN-Setup-x64.exe 当主程序启动。
//   4) 未登录误判：账户菜单里固定有"退出登录"，用 /登录/ 匹配必然误报。

import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';

// -------------------------------------------------------------
// 0. 参数解析（命令行 > 环境变量 > 自动定位）
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

if (!Number.isInteger(OPTS.port) || OPTS.port < 1 || OPTS.port > 65535) {
  console.error(`[ERROR] --port 必须是 1-65535 的整数，当前值: ${OPTS.port}`);
  process.exit(1);
}

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

// 强制走 127.0.0.1（IPv4），避免 localhost 解析到 IPv6 后连上其它监听同端口的应用
const DEBUG_URL = `http://127.0.0.1:${DEBUG_PORT}`;

function debugLaunchArgs() {
  const args = [`--remote-debugging-port=${DEBUG_PORT}`];
  if (USER_DATA_DIR) args.push(`--user-data-dir=${USER_DATA_DIR}`);
  return args;
}

// -------------------------------------------------------------
// 1. PowerShell 选择：优先 pwsh 7，回退系统自带 powershell
// -------------------------------------------------------------
function resolvePs() {
  try {
    const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8', timeout: 10_000 });
    if (r.status === 0 && Number.parseInt(r.stdout, 10) >= 6) return 'pwsh';
  } catch { /* 继续回退 */ }
  return 'powershell';
}
const PS = resolvePs();

function runPs(script) {
  return new Promise((resolve) => {
    const p = spawn(PS, ['-NoProfile', '-NonInteractive', '-Command', script]);
    let out = '';
    p.stdout.on('data', d => out += d.toString());
    p.on('close', () => resolve(out));
    p.on('error', () => resolve(''));
  });
}

// -------------------------------------------------------------
// 2. Trae 可执行文件定位
//    优先级：命令行参数 > 运行中进程 > 注册表 > 常见安装目录
//    匹配规则：文件名 ^Trae.*\.exe$，排除安装包/卸载器/辅助进程
// -------------------------------------------------------------
const COMMON_INSTALL_DIRS = [
  () => path.join(process.env.LOCALAPPDATA || '', 'Programs'),
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'D:\\Program Files',
  'D:\\Software',
  'E:\\Software',
  'D:\\',
  () => process.env.USERPROFILE || 'C:\\Users',
];

// 安装包/卸载器/辅助进程一律不算主程序（曾把 TRAE_CN-Setup-x64.exe 误当主程序）
const EXE_NAME_BLACKLIST = /(setup|unins|update|installer|crashpad|agent-tool-host|doctor|task_host)/i;

function looksLikeTraeExe(p) {
  if (!p || typeof p !== 'string') return false;
  const name = path.basename(p);
  if (!/^Trae.*\.exe$/i.test(name)) return false;
  return !EXE_NAME_BLACKLIST.test(name);
}

const EXE_CANDIDATE_NAMES = ['Trae CN.exe', 'TRAE SOLO CN.exe', 'Trae.exe', 'TRAE.exe'];

// 运行中进程（含主程序名变体：Trae CN / TRAE SOLO CN / Trae）
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
          if ($v.DisplayName -match 'Trae' -and $v.InstallLocation) { $v.InstallLocation }
        }
      }
    }
    $hits | Where-Object { $_ } | Sort-Object -Unique
  `);
  for (const line of out.split(/\r?\n/)) {
    const dir = line.trim();
    if (!dir) continue;
    for (const name of EXE_CANDIDATE_NAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        console.log(`[INFO] 从注册表定位到 Trae: ${candidate}`);
        return candidate;
      }
    }
    // InstallLocation 下按文件名规则兜底扫描（应对未来版本改名）
    try {
      for (const e of fs.readdirSync(dir)) {
        const candidate = path.join(dir, e);
        if (looksLikeTraeExe(candidate)) {
          console.log(`[INFO] 从注册表定位到 Trae: ${candidate}`);
          return candidate;
        }
      }
    } catch { /* 目录不可读则跳过 */ }
  }
  return null;
}

function scanCommonDirs(maxDepth = 3) {
  const hit = [];
  const walk = (dir, depth) => {
    if (hit.length || depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (hit.length) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.toLowerCase().includes('trae')) {
          for (const n of EXE_CANDIDATE_NAMES) {
            const exe = path.join(full, n);
            if (fs.existsSync(exe)) { hit.push(exe); return; }
          }
          try {
            for (const e2 of fs.readdirSync(full)) {
              const exe = path.join(full, e2);
              if (looksLikeTraeExe(exe) && fs.existsSync(exe)) { hit.push(exe); return; }
            }
          } catch { /* 目录不可读则跳过 */ }
        }
        walk(full, depth + 1);
      } else if (looksLikeTraeExe(full)) {
        hit.push(full);
        return;
      }
    }
  };
  for (const base of COMMON_INSTALL_DIRS) {
    const root = typeof base === 'function' ? base() : base;
    if (!root || !fs.existsSync(root)) continue;
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
    if (!looksLikeTraeExe(CLI_EXE)) {
      throw new Error(`--exe/--dir 指定的路径不是 Trae 主程序（安装包/卸载器不可用）：${CLI_EXE}`);
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
    '未找到 Trae 可执行文件。\n' +
    '请通过命令行参数指定：\n' +
    '  node src/auto-checkin.mjs --dir "你的\\Trae CN\\Trae CN.exe"\n' +
    '脚本会依次尝试：正在运行的进程 -> 注册表卸载项 -> 常见安装目录。'
  );
}

const TRAE_EXE = await resolveTraePath();

// -------------------------------------------------------------
// 3. 进程与端口管理
//    进程过滤不再硬编码 TRAE SOLO CN，兼容 Trae CN / Trae / TRAE SOLO CN
// -------------------------------------------------------------
function traeProcFilterPs() {
  return `
    $_.ExecutablePath -and
    ((Split-Path $_.ExecutablePath -Leaf) -match '^(Trae|TRAE).*\\.exe$') -and
    $_.ExecutablePath -notmatch '(?i)setup|unins|update|installer|agent-tool-host'
  `;
}

// 探测端口状态并识别是否为 Trae 的 CDP（其它应用监听同端口时不能误连）
async function probePort() {
  try {
    const res = await fetch(`${DEBUG_URL}/json/version`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { open: false, isTrae: false };
    const info = await res.json();
    const ua = `${info.Browser || ''} ${info['User-Agent'] || ''}`;
    return { open: true, isTrae: /trae/i.test(ua) };
  } catch {
    return { open: false, isTrae: false };
  }
}

async function isPortOpen() {
  return (await probePort()).open;
}

async function isTraeRunning() {
  const cmd = `@($(Get-CimInstance Win32_Process | Where-Object { ${traeProcFilterPs()} }).Count)`;
  const out = (await runPs(cmd)).trim();
  return Number.parseInt(out, 10) > 0;
}

function launchTraeWithDebug() {
  // detached + stdio ignore + unref：子进程脱离父进程，Node 退出不影响 Trae
  const child = spawn(TRAE_EXE, debugLaunchArgs(), {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

async function closeTrae() {
  const cmd = `
    Get-CimInstance Win32_Process | Where-Object { ${traeProcFilterPs()} } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  `;
  return new Promise((resolve, reject) => {
    const p = spawn(PS, ['-NoProfile', '-NonInteractive', '-Command', cmd]);
    p.on('close', () => resolve());
    p.on('error', reject);
  });
}

async function waitForPort(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { open, isTrae } = await probePort();
    if (open && isTrae) return;
    await sleep(500);
  }
  throw new Error('等待 Trae 调试端口超时（若端口被其它应用占用，请用 --port 换端口重试）');
}

async function ensureDebugPort() {
  const { open, isTrae } = await probePort();

  if (open && isTrae) {
    console.log('[OK] 调试端口已开放');
    return;
  }
  if (open && !isTrae) {
    throw new Error(`端口 ${DEBUG_PORT} 被其它应用占用（不是 Trae 的调试端口）。请用 --port 换一个端口重试。`);
  }

  // 独立 profile 是独立 Electron 实例，可与正在运行的主实例并存，无需检测/强杀
  if (USER_DATA_DIR) {
    console.log('[INFO] 独立 profile 模式：直接启动新实例...');
    launchTraeWithDebug();
    await waitForPort(30_000);
    return;
  }

  const running = await isTraeRunning();

  if (!running) {
    console.log('[INFO] Trae 未运行，正在启动并开放调试端口...');
    launchTraeWithDebug();
    await waitForPort(30_000);
    return;
  }

  if (FORCE_RELAUNCH) {
    console.log('[WARN] 强制重启 Trae 以开放调试端口（可能丢失未保存内容）...');
    await closeTrae();
    await sleep(2000);
    launchTraeWithDebug();
    await waitForPort(30_000);
    return;
  }

  throw new Error(
    `Trae 正在运行，但未开启调试端口。\n` +
    `请先关闭 Trae，然后运行：\n` +
    `  "${TRAE_EXE}" ${debugLaunchArgs().join(' ')}\n` +
    `或加 --force 参数让脚本自动重启：node src/auto-checkin.mjs --force`
  );
}

// -------------------------------------------------------------
// 4. CDP 连接
//    关键修复：多 page target 下必须选主工作台。
//    实测 Electron 会有 floatingButton.html（悬浮球）等干扰 target，
//    旧版取第一个 page 导致"找不到签到按钮"。
// -------------------------------------------------------------
async function connectCDP() {
  const res = await fetch(`${DEBUG_URL}/json`);
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(`CDP /json 返回异常数据，端口 ${DEBUG_PORT} 可能被其它应用占用（请用 --port 换端口）`);
  }
  const targets = data;
  const pages = targets.filter(t => t.type === 'page');
  if (!pages.length) {
    throw new Error('未找到 page 类型的 CDP target');
  }
  const pageTarget =
    pages.find(t => /solo-lite\.html|workbench\.html/i.test(t.url)) ||
    pages.find(t => /vscode-file:/i.test(t.url)) ||
    pages[0];
  console.log(`[INFO] 连接主窗口: ${pageTarget.title || pageTarget.url}`);

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
// 5. DOM 操作：打开账户菜单、检测并点击签到
//    注意：必须用 DOM 合成点击 el.click()。
//    实测 agent-browser / CDP 的原生鼠标事件会被浮层遮挡拦截，
//    头像按钮永远点不中，合成点击不受影响。
// -------------------------------------------------------------
async function performCheckIn(cdp) {
  const { evaluate } = cdp;

  // 5.1 打开账户菜单（状态感知：已打开就不重复点；UI 刚启动时点击可能无效，重试 3 轮）
  const menuAlreadyOpen = await evaluate(`!!document.querySelector('[class*="accountPopover"]')`);
  if (!menuAlreadyOpen.result.result.value) {
    console.log('[INFO] 点击左下角头像...');
    for (let round = 0; round < 3; round++) {
      await evaluate(`
        (() => {
          const el = document.querySelector('[class*="accountTrigger"]');
          if (el) { el.click(); return true; }
          return false;
        })()
      `);
      let opened = false;
      for (let i = 0; i < 10; i++) {
        await sleep(500);
        const open = await evaluate(`!!document.querySelector('[class*="accountPopover"]')`);
        if (open.result.result.value) { opened = true; break; }
      }
      if (opened) break;
      console.log('[WARN] 账户菜单未弹出，重试...');
    }
  } else {
    console.log('[INFO] 账户菜单已经打开');
  }

  // 5.2 读取签到按钮状态
  const inspect = await evaluate(`
    (() => {
      const btn = document.querySelector('[class*="accountCheckinButton"]');
      const label = document.querySelector('[class*="accountCheckinButtonLabel"]');
      if (!btn) return { error: 'checkin_button_not_found' };
      return {
        buttonText: label ? (label.textContent || '').trim() : (btn.textContent || '').trim(),
        disabled: !!btn.disabled,
        title: (document.querySelector('[class*="accountCheckinTitle"]')?.textContent || '').trim()
      };
    })()
  `);
  const state = inspect.result.result.value;
  if (!state) {
    throw new Error('读取签到按钮状态失败（页面脚本执行异常）');
  }
  console.log(`[INFO] 签到按钮状态: ${JSON.stringify(state)}`);

  if (state.error) {
    // 区分"未登录"与"类名已变化"。
    // 注意：已登录菜单固定含"退出登录"，先剔除再匹配登录引导词，避免误判。
    const loginHint = await evaluate(`
      (() => {
        const menu = document.querySelector('[class*="accountPopover"]');
        if (!menu) return { menuOpen: false };
        const raw = (menu.textContent || '');
        const t = raw.replace(/退出登录/g, '');
        return {
          menuOpen: true,
          hasLoginHint: /立即登录|扫码|手机号|验证码/.test(t),
          sample: raw.replace(/\\s+/g, ' ').slice(0, 80)
        };
      })()
    `);
    const hint = loginHint.result.result.value;
    if (hint && hint.menuOpen && hint.hasLoginHint) {
      return { status: 'not_logged_in', detail: hint.sample };
    }
    throw new Error('未找到每日签到按钮，可能类名已变化');
  }

  // 已签判定：按钮 disabled 或文本含"已签"（当前版本为"已签到"）
  if (state.disabled || /已签/.test(state.buttonText)) {
    return { status: 'already_signed', detail: state.buttonText };
  }

  // 5.3 点击签到按钮
  console.log('[INFO] 尝试点击签到按钮...');
  const clicked = await evaluate(`
    (() => {
      const btn = document.querySelector('[class*="accountCheckinButton"]');
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    })()
  `);

  if (!clicked.result.result.value) {
    return { status: 'click_failed' };
  }

  await sleep(2000);

  // 5.4 验证：按钮文字变成"已签"或按钮变 disabled
  const verify = await evaluate(`
    (() => {
      const btn = document.querySelector('[class*="accountCheckinButton"]');
      if (!btn) return 'button_gone';
      const label = btn.querySelector('[class*="accountCheckinButtonLabel"]');
      return { text: ((label ? label.textContent : btn.textContent) || '').trim(), disabled: !!btn.disabled };
    })()
  `);
  const after = verify.result.result.value;
  const afterText = typeof after === 'string' ? after : after.text;
  const afterDisabled = typeof after === 'object' && after !== null ? after.disabled : false;
  if (/已签/.test(afterText) || afterDisabled) {
    return { status: 'success', detail: afterText };
  }
  return { status: 'unknown', detail: afterText };
}

// -------------------------------------------------------------
// 6. 主流程。退出码：0 成功 / 1 失败 / 2 今日已签
// -------------------------------------------------------------
async function main() {
  try {
    await ensureDebugPort();
    console.log('[INFO] 连接 CDP...');
    const cdp = await connectCDP();
    const result = await performCheckIn(cdp);
    cdp.ws.close();
    await sleep(300);

    console.log('[RESULT]', JSON.stringify(result, null, 2));

    if (CLOSE_AFTER_CHECKIN) {
      console.log('[INFO] --close 已指定，正在关闭 Trae...');
      await closeTrae();
      console.log('[INFO] Trae 已关闭');
    }

    if (result.status === 'success') {
      process.exit(0);
    } else if (result.status === 'already_signed') {
      process.exit(2);
    } else {
      process.exit(1);
    }
  } catch (err) {
    console.error('[ERROR]', err.message);
    if (CLOSE_AFTER_CHECKIN) {
      await closeTrae().catch(() => {});
    }
    process.exit(1);
  }
}

main();
