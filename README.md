# Trae SOLO CN 每日签到自动化

> 从"这是个套壳 Web 吗？"到"自动点击签到"的完整实现记录。

## 一、需求与想法

Trae SOLO CN（字节跳动面向中文用户的 AI IDE）每天点击左下角头像会弹出一个账户菜单，其中有一项：

> **每日签到领 200 积分**

右侧有一个按钮，未签到时显示为可点击的"签到"类文字；已签到时显示为灰色的"今日已签"。

目标：让电脑每天自动完成这个点击，无需手动打开 Trae、点头像、点签到按钮。

## 二、关键判断：它是不是"套壳 Web"？

打开安装目录 `D:\Software\TRAE SOLO CN` 检查：

| 发现 | 含义 |
|------|------|
| `chrome_100_percent.pak`、`v8_context_snapshot.bin`、`icudtl.dat` | Chromium 内核 |
| `libEGL.dll`、`libGLESv2.dll` | GPU 渲染 |
| `resources/app/` 下有 3615 个文件，**没有 `app.asar`** | Electron 应用，代码未打包，可直接读取 |
| `main.js` 里出现 `out-build/vs/platform/...`、`webContentExtractorService` | 基于 **VS Code 内核 fork**（和 Cursor 同源） |
| 没有 `WebView2Loader.dll` | 排除 Tauri / Wails / CEF-WebView2 |

**结论**：`TRAE SOLO CN.exe` 是 **Electron（Chromium 142）+ VS Code 架构** 的套壳 Web 应用。左下角头像、签到菜单、设置页全是 DOM，因此可以用 Web 自动化技术操控。

## 三、技术路线：Chrome DevTools Protocol (CDP)

Electron 应用本质上就是 Chromium。Chromium 提供 **远程调试协议（CDP）**，允许外部程序通过 WebSocket 访问页面 DOM、执行 JS。

### 3.1 开启调试端口

启动时加上 Chromium 参数：

```bat
"D:\Software\TRAE SOLO CN\TRAE SOLO CN.exe" --remote-debugging-port=9222
```

启动后访问：

```text
http://localhost:9222/json
```

可以看到类似：

```json
{
  "description": "",
  "devtoolsFrontendUrl": "...",
  "id": "B8FD94AF...",
  "title": "vscode-file://.../solo-lite.html",
  "type": "page",
  "url": "vscode-file://.../solo-lite.html",
  "webSocketDebuggerUrl": "ws://localhost:9222/devtools/page/B8FD94AF..."
}
```

这就是 Trae 主界面的 WebSocket 调试端点。

### 3.2 为什么不用 F1 命令

应用内 `F1` 命令可能被改或隐藏，但 **CDP 是 Chromium 底层能力**，只要应用是用 Chromium 渲染的，这个通道就绕不开。

## 四、定位关键元素

连接 CDP 后，在页面里执行 JS 来查找元素。实际探查到的关键选择器：

| 元素 | 选择器/特征 |
|------|-------------|
| 左下角头像入口 | 类名前缀 `accountTrigger`，文本包含 `用户` 的 `<button>` |
| 账户弹窗容器 | 类名前缀 `accountPopover`、`accountCard` |
| 每日签到标题 | 类名前缀 `accountCheckinTitle`（文本 `每日签到领 200 积分`） |
| 签到按钮 | 类名前缀 `accountCheckinButton` |
| 签到按钮文字 | 类名前缀 `accountCheckinButtonLabel` |

由于 CSS 类名是工具生成的哈希后缀（如 `accountCheckinButton-hoMtQt`），脚本里使用 `*[class*="accountCheckinButton"]` 这种前缀匹配，比完全固定类名更抗更新。

## 五、核心脚本设计

项目使用 **Node.js >= 18**，零第三方依赖（自带 `fetch` 与 `WebSocket`）。

流程：

```
1. 确保 Trae 已开启调试端口
   ├─ 端口已开：直接连接
   ├─ 未运行：自动启动 Trae（带调试端口）
   └─ 已运行但无端口：安全报错，或设置 FORCE_RELAUNCH=1 强制重启

2. 连接 CDP，定位 workbench page

3. 点击左下角头像打开账户菜单（状态感知，避免重复点击关闭菜单）

4. 在菜单中查找"每日签到"行，读取右侧按钮文本
   ├─ 文本包含"已签" → 今日已签，退出码 2
   └─ 否则 → 点击按钮，等待 1.5 秒后验证文本是否变为"今日已签"

5. 输出结果并关闭连接
```

脚本入口：`src/auto-checkin.mjs`。

## 六、使用方式

### 6.1 首次/手动运行

```bat
:: 方法 A：双击 launch-with-debug.bat 启动 Trae（已带调试端口）
:: 方法 B：如果 Trae 已经在运行但无端口，用 PowerShell 强制重启
powershell -ExecutionPolicy Bypass -File scripts\relaunch-with-debug.ps1

:: 运行签到脚本
node src/auto-checkin.mjs
```

### 6.2 环境变量

| 变量 | 作用 | 默认值 |
|------|------|--------|
| `TRAECHECKIN_EXE` | Trae 可执行文件路径 | `D:\Software\TRAE SOLO CN\TRAE SOLO CN.exe` |
| `TRAECHECKIN_PORT` | CDP 调试端口 | `9222` |
| `TRAECHECKIN_FORCE_RELAUNCH` | 已运行时强制重启 | `0` |

示例：

```bat
set TRAECHECKIN_FORCE_RELAUNCH=1
node src/auto-checkin.mjs
```

### 6.3 加入 Windows 任务计划程序（每天自动执行）

1. 创建基本任务，每天固定时间触发。
2. 操作选择"启动程序"：
   - 程序：`D:\Projects\trae-daily-checkin\launch-with-debug.bat`
   - 或先启动 Trae，再运行 `node src/auto-checkin.mjs`
3. 建议签到时间设为开机后或午休时间，并勾选"无论用户是否登录都要运行"（需要保存密码）。

> 注意：任务计划里使用 `TRAECHECKIN_FORCE_RELAUNCH=1` 更省心，因为 Trae 可能已经在前台运行。

## 七、退出码说明

| 退出码 | 含义 |
|--------|------|
| `0` | 签到成功 |
| `1` | 失败/异常 |
| `2` | 今日已签（无需重复操作） |

## 八、验证结果

在某次测试中：

- 调试端口成功打开：
  ```
  VERSION: Chrome/142.0.7444.235
  [page] vscode-file://.../solo-lite.html
  ```
- 脚本正确识别到"今日已签"状态，输出：
  ```json
  {
    "status": "already_signed",
    "detail": "今日已签"
  }
  ```

说明自动化链路完全跑通；当按钮可点击时，脚本会真实点击并完成签到。

## 九、已知限制与注意事项

1. **CSS 类名可能随更新变化**：脚本使用 `class*="前缀"` 匹配，但仍需在 Trae 更新后抽查一次。
2. **调试端口的安全风险**：`--remote-debugging-port=9222` 只监听 `127.0.0.1`，本机安全；但任何本机进程都能连接，公用电脑不建议长期开启。
3. **单实例限制**：Electron 单实例机制导致"带端口启动"在已有实例运行时不会生效，因此脚本在冲突时默认安全退出，并提供强制重启选项。
4. **UI 弹窗/网络失败**：如果签到接口失败，按钮文本不会变成"今日已签"，脚本会返回 `unknown`，此时需要人工查看。

## 十、项目文件说明

```text
trae-daily-checkin/
├── package.json                  # 项目元数据
├── README.md                     # 本文件
├── launch-with-debug.bat         # 双击启动 Trae（带调试端口）
├── scripts/
│   └── relaunch-with-debug.ps1   # 强制重启 Trae 并开放端口
└── src/
    └── auto-checkin.mjs          # 自动签到主脚本
```

## 十一、后续可扩展

- 增加截图/日志落盘，方便排查失败原因。
- 在 Windows 任务计划里直接触发，实现完全无人值守。
- 如果 Trae 未来封禁 CDP，可以改用 **无障碍 API（MSAA/UIA）** 或 **Playwright 的 Electron 支持** 作为备用方案。

---

实现日期：2026-08-19
