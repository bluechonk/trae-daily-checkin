---
name: trae-checkin
description: 使用 agent-browser 完成 Trae（Trae CN / TRAE SOLO CN，Electron + VS Code 内核）的每日签到自动化。适用场景包括"自动签到 Trae"、"连接 Trae 的调试端口"、"操作 Trae 界面"、"Trae 每日领积分"、"Electron 应用 CDP 自动化"。核心流程：带调试端口启动 Trae，agent-browser 通过 CDP 连接，定位主工作台页面，用 DOM 合成点击打开账户菜单并点击签到按钮。
---

# Trae 每日签到（agent-browser 实操手册）

目标：每天自动完成 Trae 左下角头像菜单里的"签到"点击，无需人工操作。

实测环境：TraeCN 1.107.1（Chrome 142 / Electron 39.2.7），Windows 11。本手册同时提供 agent-browser 手动操作流程与配套零依赖脚本 `src/auto-checkin.mjs`（项目根目录）两种方式。

agent-browser CLI 的安装、通用命令与实测坑见同目录 [agent-browser 技能](../agent-browser/SKILL.md)；第三方组件的出处与许可证说明见 [docs/third-party.md](../../docs/third-party.md)。

## 前置条件

1. Node.js >= 18（运行配套脚本）与 agent-browser CLI（`npm i -g agent-browser && agent-browser install`）。
2. Trae 必须在启动时带上调试端口参数（运行中再加无效）：

```powershell
Start-Process -FilePath "$env:LOCALAPPDATA\Programs\Trae CN\Trae CN.exe" -ArgumentList '--remote-debugging-port=9222'
```

3. 确认端口就绪：`curl http://127.0.0.1:9222/json/version` 返回 JSON 即可。注意用 `127.0.0.1` 而不是 `localhost`，避免 IPv6 解析连到其它应用。

## 核心流程（agent-browser）

```bash
# 1. 连接调试端口
agent-browser connect 9222

# 2. 列出所有 target，选主工作台（见"关键坑 1"）
agent-browser tab
# 期望看到类似：
#   [t1] Agent - vscode-file://vscode-app/.../solo/solo-lite.html
#   [t2] floatingButton.html - file:///.../iCubeFloatingChat/...

# 用 tab 编号切换（实测当前 CLI 版本不支持 tab --url <pattern>，按编号最稳）
agent-browser tab t1

# 3. 打开账户菜单：只能用 DOM 合成点击（见"关键坑 2"）
agent-browser eval "(() => { const e = document.querySelector('[class*=\"accountTrigger\"]'); if (e) { e.click(); return 'clicked'; } return 'no-trigger'; })()"

# 4. 等待弹窗出现后读取签到按钮状态
agent-browser eval "(() => { const b = document.querySelector('[class*=\"accountCheckinButton\"]'); const l = document.querySelector('[class*=\"accountCheckinButtonLabel\"]'); return b ? { text: (l || b).textContent.trim(), disabled: b.disabled } : 'NO_BUTTON'; })()"

# 5. 未签到时点击签到按钮，同样用 eval 合成点击
agent-browser eval "(() => { const b = document.querySelector('[class*=\"accountCheckinButton\"]'); if (!b || b.disabled) return false; b.click(); return true; })()"

# 6. 等 2 秒后复读按钮文本验证，text 含"已签"或 disabled=true 即成功
agent-browser eval "(() => { const b = document.querySelector('[class*=\"accountCheckinButton\"]'); return b ? { text: b.textContent.trim(), disabled: b.disabled } : 'button_gone'; })()"
```

## DOM 结构速查（2026-10-23 实测，TraeCN 1.107.1）

Trae CN 启动后有两种模式，**签到入口不同**，脚本按"solo-lite 优先、workbench 其次"逐页探测：

| 模式 | 主窗口 target | 签到入口 | 选择器（前缀匹配） |
|------|--------------|----------|--------------------|
| Agent 模式（Build With TRAE） | `solo/solo-lite.html` | 左下角头像 → 账户菜单 | `[class*="accountTrigger"]` → `[class*="accountPopover"]` → `[class*="accountCheckinButton"]` |
| IDEA 模式（SOLO 编辑器） | `workbench/workbench.html` | 右上角自动弹的签到横幅 | `[class*="commercialBannerPopupPrimaryAction"]`（无 label 子元素，直接读按钮文本） |

| 元素 | 选择器 | 说明 |
|------|--------|------|
| 账户弹窗 | `[class*="accountPopover"]` | 仅 Agent 模式；关闭时从 DOM 卸载，可当开合标志 |
| 签到按钮（菜单） | `[class*="accountCheckinButton"]` | 未签可点；已签文本"已签到"且 `disabled=true` |
| 签到横幅（IDEA） | `[class*="commercialBannerPopupPrimaryAction"]` | 判定同上；横幅是临时弹窗，被关闭后 DOM 里就没了 |

状态判定（两种入口一致）：按钮 `disabled=true` 或文本含"已签"即今日已签；点击后 2 秒复读文本或 `disabled` 验证成功。

IDEA 模式横幅消失后的兜底：点击 IDEA 窗口右上角的 `icube-open-solo-lite-window-button`（"Agent ↗"）打开 Agent 模式窗口，再走头像菜单流程。实测该按钮即使处于 `display:none`（`data-titlebar-presentation="hidden"`），DOM 合成点击依然生效。

## 关键坑（实测结论，绕不开）

1. **两种模式、多个 target**。Agent 模式窗口是 `solo-lite.html`，IDEA 模式是 `workbench.html`，另有悬浮球 `floatingButton.html`。不能取第一个 target：逐页探测有签到入口的页面。
2. **原生鼠标点击会被遮挡拦截**。对头像执行 `agent-browser click @eN` 会报 `Element is covered by <div>`——工作台有遮挡层，Input 事件的真实命中检测过不去。必须用 `agent-browser eval` 执行 DOM 合成点击 `el.click()`，它不经过命中检测（对 `display:none` 的元素同样有效，如 IDEA→Agent 的切换按钮）。
3. **进程名是 `Trae CN.exe`**。按 `TRAE SOLO CN` 匹配进程会全部落空（检测"是否在运行"恒为否、`--close` 杀不掉进程）。匹配规则用 `^(Trae|TRAE).*\.exe$` 并排除 `setup|unins|update`（否则会把 `Downloads\TRAE_CN-Setup-x64.exe` 安装包当主程序启动）。
4. **注册表定位的安装目录**。Trae CN 用户级安装落在 `%LOCALAPPDATA%\Programs\Trae CN\`，注册表 `HKCU\...\Uninstall` 的 `DisplayName` 为 `TRAE CN (User)`。候选文件名要包含 `Trae CN.exe`。
5. **PowerShell 5.1 编码**。含中文的 `.ps1` 必须带 UTF-8 BOM，否则 PS 5.1 按 GBK 读取直接解析报错；优先用 `pwsh` 7。
6. **冷启动时序**。Trae 刚启动时 UI 事件可能还没挂载，点击头像无效，弹窗不出。需要轮询检测 `accountPopover`，超时重试点击 2-3 轮。
7. **未登录误判**。已登录账户菜单固定含"退出登录"，用 `/登录/` 检测未登录状态必然误报。先剔除"退出登录"再匹配"立即登录|扫码|手机号|验证码"。
8. **模板字符串正则转义**。Node 模板字符串里的 `\/` 会变成 `/`，注入页面的正则字面量被截断报 `Invalid regular expression flags`。要么写 `\\/`，要么避免在正则里用 `/`。
9. **IDEA 模式横幅是一次性弹窗**。打开 IDEA 模式时自动弹一次，手动关闭或超时后 DOM 里就没有签到入口了。IDEA 模式探测不到入口时，走"Agent ↗"开 Agent 窗口兜底。

## 一键执行（配套脚本）

上述流程已固化为项目脚本，零第三方依赖：

```bash
node src/auto-checkin.mjs                # 自动定位 Trae，默认端口 9222
node src/auto-checkin.mjs --force        # 已运行但无端口时强制重启
node src/auto-checkin.mjs --force --close  # 签完关闭 Trae，适合任务计划
```

退出码：`0` 签到成功；`2` 今日已签；`1` 失败（含 `not_logged_in` 未登录、`click_failed`、`unknown` 点击后未验证通过）。

## 排错

- 连接失败：确认 Trae 是带 `--remote-debugging-port` 启动的（运行中补加无效，需重启）。
- 找不到签到按钮：先 `agent-browser tab` 确认当前在 `solo-lite.html`；再 `eval` 检查 `accountPopover` 是否打开；最后核对类名前缀是否随版本更新变化。
- 菜单打不开：见关键坑 6，等待后重试点击。
- 显示未登录：真未登录就手动登录一次（登录态保存在 user-data-dir 里）；已登录仍报未登录则检查关键坑 7 的正则剔除逻辑。
