---
name: agent-browser
description: 项目内使用 agent-browser CLI（vercel-labs 出品，Apache-2.0）做浏览器与 Electron 应用自动化的实操手册。适用场景包括"用 agent-browser 操作 Trae/VS Code/Slack 等 Electron 应用"、"连接 CDP 调试端口"、"浏览器自动化测试"、"快照定位元素"、"eval 执行页面脚本"。记录的是本仓库实测验证过的命令与坑，通用细节以官方 `agent-browser skills get core` / `skills get electron` 为准。
---

# agent-browser 项目实操手册

agent-browser 是 vercel-labs 开源的浏览器自动化 CLI（Rust 原生，通过 CDP 驱动 Chromium，不依赖 Playwright/Puppeteer）。本仓库用它完成 Trae（Electron 应用）的签到自动化探索与验证，配套流程见同目录 `trae-checkin` 技能。

第三方出处与许可证义务见 [docs/third-party.md](../../docs/third-party.md)。

## 安装

```bash
npm i -g agent-browser && agent-browser install
```

本仓库实测版本：0.39.2。CLI 自带版本化技能手册，用前先读（内容随版本更新，比任何静态文档可靠）：

```bash
agent-browser skills get core        # 通用工作流
agent-browser skills get electron    # Electron 应用场景
agent-browser skills list            # 其余场景（slack/dogfood 等）
```

## 连接 Electron 应用（Trae 实测）

Electron 应用必须在**启动时**带上 Chromium 调试参数（运行中补加无效）：

```powershell
Start-Process -FilePath "$env:LOCALAPPDATA\Programs\Trae CN\Trae CN.exe" -ArgumentList '--remote-debugging-port=9222'
```

```bash
agent-browser connect 9222     # 之后所有命令默认作用于该连接
agent-browser --cdp 9222 snapshot -i   # 或每条命令显式指定
```

端口归属要确认：`curl http://127.0.0.1:9222/json/version` 的 User-Agent 应含 `TraeCN`（本仓库主脚本有同样校验，见 `src/auto-checkin.mjs` 的 `probePort`）。

## 核心命令速查（本项目验证过的子集）

| 命令 | 作用 | 本仓库实测备注 |
|------|------|----------------|
| `agent-browser connect <port>` | 连接 CDP 端口 | Trae 用 9222 |
| `agent-browser tab` | 列出全部 target（page/webview） | Electron 多 target 时必看 |
| `agent-browser tab t1` | 按编号切换 target | **当前版本不支持 `tab --url <pattern>`**，实测报 `Invalid tab label` |
| `agent-browser snapshot -i` | 可交互元素快照（带 `@eN` 引用） | 定位元素首选 |
| `agent-browser click @e9` | 真实鼠标点击 | 见下方"关键坑 2"，Trae 头像会失败 |
| `agent-browser eval "<js>"` | 页面内执行 JS | 自动化 Electron 最可靠的一招 |
| `agent-browser press Escape` | 发按键 | 关弹窗 |
| `agent-browser screenshot out.png` | 截图 | 留证 |

## 关键坑（实测结论）

1. **多 target 必须选主工作台**。Trae 暴露悬浮球（`floatingButton.html`）和主窗口（`solo-lite.html`）等多个 page，`tab` 列表里认准 URL，别默认取第一个。
2. **真实鼠标点击会被遮挡层拦截**。对 Trae 头像按钮执行 `click @eN` 报 `Element '@eN' is covered by <div>`，Input 事件命中检测过不去；改用 `eval` 执行 DOM 合成点击 `el.click()`，绕过命中检测，实测可靠。
3. **eval 里查属性用 `[class*="前缀"]`**。Trae 的 CSS 类名带哈希后缀（如 `accountCheckinButton-hoMtQt`），精确类名跨版本必挂。
4. **eval 的引号转义**。bash 双引号内写 `document.querySelector('[class*=\"accountTrigger\"]')`，内层引号要 `\"`。
5. **冷启动时序**。Electron 刚启动时 UI 事件未挂载，点击可能无效——轮询等待 + 重试 2-3 轮（本仓库 `performCheckIn` 的实现可参考）。

## 在本仓库中的位置

- 自动化 Trae 签到的完整流程：`.agents/skills/trae-checkin/SKILL.md`
- 固化后的零依赖脚本：`src/auto-checkin.mjs`（不依赖 agent-browser，直接用 Node 内置 WebSocket 说 CDP）
- 第三方出处与许可证：`docs/third-party.md`

## 排错

- 连接失败：应用没带调试参数启动，重启应用；或端口被其它应用占用（本仓库脚本会校验 UA 并提示换端口）。
- 找不到元素：先 `tab` 确认在正确 target，再 `snapshot -i` 看真实 DOM，最后核对类名前缀是否随版本漂移。
- 命令行为与文档不符：以 `agent-browser skills get core` 输出为准（版本差异，如 `tab --url`）。
