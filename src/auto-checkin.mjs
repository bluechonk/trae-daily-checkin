// src/auto-checkin.mjs
// 通过 Chrome DevTools Protocol (CDP) 自动完成 Trae SOLO CN 每日签到。
// 零第三方依赖：Node >= 18 自带的 fetch / WebSocket。

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const TRAE_EXE = process.env.TRAECHECKIN_EXE || 'D:\\Software\\TRAE SOLO CN\\TRAE SOLO CN.exe';
const DEBUG_PORT = Number(process.env.TRAECHECKIN_PORT || 9222);
const FORCE_RELAUNCH = process.env.TRAECHECKIN_FORCE_RELAUNCH === '1' || process.argv.includes('--force');

const DEBUG_URL = `http://localhost:${DEBUG_PORT}`;
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
      `  "${TRAE_EXE}" --remote-debugging-port=${DEBUG_PORT}\n` +
      `或设置环境变量 TRAECHECKIN_FORCE_RELAUNCH=1 让脚本自动重启。`
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
    const p = spawn('powershell', ['-NoProfile', '-Command', cmd], { shell: true });
    let out = '';
    p.stdout.on('data', d => out += d.toString());
    p.on('close', () => resolve(/ProcessId/.test(out) && out.trim().split('\n').length > 1));
    p.on('error', reject);
  });
}

function launchTraeWithDebug() {
  // 用 start 命令脱离当前进程，避免 Node 持有子进程句柄导致关闭时 UV 断言崩溃
  const cmd = `start "" "${TRAE_EXE}" --remote-debugging-port=${DEBUG_PORT}`;
  spawn('cmd', ['/c', cmd], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

async function closeTrae() {
  const cmd = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*TRAE SOLO CN*' -or $_.Name -eq 'agent-tool-host.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  return new Promise((resolve, reject) => {
    const p = spawn('powershell', ['-NoProfile', '-Command', cmd], { shell: true });
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
    await sleep(1000);
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
