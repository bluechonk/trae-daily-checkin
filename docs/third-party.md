# 第三方引用与许可证说明

本仓库代码为独立实现（零第三方代码依赖），运行与文档中引用了以下第三方组件。本文档记录出处、许可证与合规说明。

## 引用清单

| 组件 | 版本（实测） | 用途 | 引用方式 | 许可证 | 出处 |
|------|--------------|------|----------|--------|------|
| agent-browser | 0.39.2（CLI）/ commit `dac13bb`（技能快照） | 浏览器/Electron 自动化 CLI，用于探索 Trae 签到 DOM 并验证流程；官方技能文档随附于 `.agents/skills/agent-browser/` | CLI 作为外部工具使用；技能文档为**完整复制**的官方快照（未修改），随仓库分发 | Apache-2.0（Copyright 2025 Vercel Inc.） | [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) |
| Node.js | >= 18（实测 24.21.0） | 运行环境（内置 `fetch` / `WebSocket` / `child_process`，因此无需 npm 依赖） | 运行时环境 | MIT | [nodejs.org](https://nodejs.org) |
| Trae CN / TRAE SOLO CN | TraeCN 1.107.1 | 被自动化的目标应用 | 不分发、不修改其代码，仅通过其自带的 Chromium 远程调试协议（CDP）操控本机已安装实例的界面 | 专有软件（字节跳动） | [trae.com.cn](https://www.trae.com.cn) |

## 许可证合规说明

### agent-browser（Apache-2.0）

- Apache-2.0 允许自由使用、修改与再分发，前提是保留原版权与许可声明。
- **CLI**：作为外部工具安装使用（`npm i -g agent-browser`），本仓库不含其代码。
- **技能文档快照**：`.agents/skills/agent-browser/` 完整复制自 vercel-labs/agent-browser（HEAD `dac13bb`，2026-10-18 浅克隆），**未做任何修改**，随本仓库分发。已按 Apache-2.0 第 4 条要求：
  - 保留原 [LICENSE](../.agents/skills/agent-browser/LICENSE)（Apache-2.0 全文，Copyright 2025 Vercel Inc.）；
  - 来源与克隆信息记录在该目录的 [SOURCE-NOTES.md](../.agents/skills/agent-browser/SOURCE-NOTES.md)（上游无独立 NOTICE 文件，来源声明由本仓库维护）；
  - 本仓库对快照的增改仅限本仓库自己的技能文件（如 `trae-checkin/`），不在快照目录内。
- 如后续更新快照，请同步刷新 SOURCE-NOTES.md 中的 commit 与日期。

### Node.js（MIT）

仅作为运行环境使用，不随本仓库分发。MIT 许可要求保留版权声明——本仓库不含 Node.js 源码，无附带义务。

### Trae（专有软件）

- Trae 是字节跳动的专有产品，本仓库与其无任何隶属或授权关系。
- 本仓库不逆向、不解包、不存储 Trae 的任何专有代码或资源；自动化仅通过 Chromium 标准调试协议（CDP，`--remote-debugging-port` 为应用自身开放的能力）在用户本机操作用户自己的已登录界面，等同于用户手动点击。
- 使用本脚本产生的账号行为（签到得积分等）由使用者自行承担；请遵守 Trae 的用户协议，勿将本方案用于批量账号或破坏性场景。

## 本仓库许可证

本项目自身以 [MIT](../LICENSE) 许可发布（与 `package.json` 的 `license` 字段一致）。使用本仓库代码时请保留 LICENSE 文件。
