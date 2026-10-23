# 更新日志

本项目的全部重要变更记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；按日期分组。

## 2026-10-24

### 新增

- SOLO/IDEA 模式第三个签到入口：头像用户卡片（`icube-user-card` shadowRoot，移除 `.user-card-wrapper` 的 `hidden` 类显示菜单，按钮 `icube-user-card__checkin-button`），签到完成后恢复隐藏
- `clickAndVerify` 支持穿透 shadowRoot 的按钮定位与验证
- `LICENSE`（MIT）与 `docs/third-party.md`（第三方引用清单与许可证合规说明）
- `.agents/skills/agent-browser/`：GitHub 官方 agent-browser 技能完整快照（Apache-2.0，未修改，附 SOURCE-NOTES 来源声明）

### 修复

- SOLO 模式签到兜底链路：`performCheckIn` 返回 `no_entry` 对象后 `!result` 恒为假，导致第二轮兜底永不触发

### 文档

- `trae-checkin` 技能同步三入口结构与"头像入口被 titlebar 拖拽区拦截"的实测结论
- README 文件树与"许可证与第三方组件"章节

## 2026-10-23

### 新增

- 双模式支持：Trae CN 的 Agent 模式（`solo-lite.html`，头像菜单 `accountCheckinButton`）与 IDEA 模式（`workbench.html`，签到横幅 `commercialBannerPopupPrimaryAction`）逐页探测；IDEA 横幅关闭后经"Agent ↗"（`icube-open-solo-lite-window-button`）打开 Agent 窗口兜底
- CDP 端口归属校验（`/json/version` UA 含 `TraeCN`）、`/json` 非数组防护、`--port` 参数校验（1-65535）
- `--profile` 模式与主实例并存（不再误杀主账号实例）

### 修复

- CDP target 误选：Electron 多 page 下旧版取第一个（悬浮球 `floatingButton.html`），永远报"签到按钮不存在"
- 进程名硬编码 `*TRAE SOLO CN*`：本机进程名是 `Trae CN.exe`，运行检测恒为否、`--close` 杀不掉
- 自动定位把 `Downloads\TRAE_CN-Setup-x64.exe` 安装包当主程序启动
- `locate-trae.ps1` 无 BOM 导致 PowerShell 5.1 解析崩溃（补 UTF-8 BOM）；候选名补 `Trae CN.exe`
- `launch-with-debug.bat` 括号块内变量解析期展开导致定位成功也报错；bat 全 ASCII 化（`chcp 65001` 下 cmd 解析 UTF-8 中文行偏移错位不可根治）
- `uninstall-schedule.bat` echo 裸括号被当作块结束符
- 模板字符串正则转义崩溃（`Invalid regular expression flags`）；未登录检测被菜单里固定的"退出登录"误触发
- 冷启动时 UI 事件未挂载导致点击头像无效（自动重试 3 轮）
- `relaunch-with-debug.ps1` 杀进程按安装目录匹配（不再硬编码进程名）
- 自动定位扫描目录补 `%LOCALAPPDATA%\Programs`，`readdirSync` 补异常保护

### 变更

- bat 脚本全部改为 ASCII（cmd 中文解析问题不可根治，说明文字保留在 README 与 Node 输出）；ps1 保持中文但必须带 BOM
- Node 侧 PowerShell 调用优先 `pwsh` 7

## 2026-08-19

### 新增

- 初始版本：CDP 自动签到（`src/auto-checkin.mjs`，零第三方依赖，Node >= 18）
- Trae 可执行文件四级定位（命令行参数 > 运行中进程 > 注册表 > 常见目录扫描）
- `launch-with-debug.bat` / `install-schedule.bat` / `uninstall-schedule.bat`
- 独立 profile 隔离测试（`--profile`）、签到后关闭 Trae（`--close`）
- 退出码约定：`0` 签到成功 / `1` 失败 / `2` 今日已签
