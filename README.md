# Tinker

Tinker 是基于现有 ASCI 项目演进的 AI Agent 桌面应用。根据任务切换聊天、写作、编程和图像能力。

已交付安装包的基线为 **0.1.603-rc.1 候选版**；当前开发源码版本以 `apps/electron/package.json` 为准。源码提交不会自动更新安装包，也不表示已经稳定发布或通过 Apple 公证。

## 本机开发

需要 Bun 1.2.5+、Node.js，以及相应平台的 Electron/native 依赖。

```sh
bun install
TINKER_CANDIDATE=1 ASCI_SKIP_LOGIN=1 bun run electron:build
TINKER_CANDIDATE=1 ASCI_SKIP_LOGIN=1 bun run electron:start
```

本候选采用免登录、本机自带 Key。API Key 仅在应用内配置，不要提交到 Git。
Mac 候选资料隔离在 `~/Library/Application Support/Tinker Candidate`；没有自动迁移现有 ASCI 会话或渠道。

## 当前清理与兼容边界

当前源码正在按依赖退役科研专属流程，保留通用聊天、模型/渠道、生图、项目、历史读取/导出和媒体能力。执行批次与测试边界见[科研退役记录](docs/reports/2026-11-10-research-retirement.md)。现有 Electron/SDK 后端仍承担生产功能，Rust/Tauri 是独立迁移路径，未用它替换正式界面或用户数据。

## 旧候选验证记录与限制

以下是上列旧候选版本的记录，不代表当前源码或新安装包的完整验收。

- 上次候选构建回归：3127 通过、4 跳过、0 失败；类型检查与构建通过。
- 已实测首页、模型缺省设置入口、中文切换、项目创建、搜索、示例草稿及返回后保留草稿。
- 真实 Key 认证、聊天/生图端到端、连续编辑和另一台电脑首次安装仍需验收。
- macOS 安装包当前为临时签名，未公证。本仓库不包含安装包、个人渠道、Key 或会话数据。
- 内部 `@asci/*` 命名空间暂时保留，避免破坏已有模块契约；图形标志沿用现有版本。

原项目的 CI、自动发布和通知配置保存在 `docs/upstream-workflows/*.disabled`，不会在本仓库自动执行。更新源和对外发行配置尚待确认，不要直接执行旧配置向原仓库发布。

当前 issue 与 PR 默认提交到 [`SimmonJ-WYJ/tinker`](https://github.com/SimmonJ-WYJ/tinker)，上游历史链接保留原仓库归属。

## 项目来源与许可

保留原有 ASCI/OPENSCI Labs 及贡献者归属。许可见 [LICENSE](LICENSE)，声明见 [NOTICE](NOTICE)。原项目文档见 [历史 README](docs/history/ASCI-README.md) 与 [历史领域语言](docs/history/ASCI-CONTEXT.md)。当前开发约定见 [CLAUDE.md](CLAUDE.md)，通用领域语言见 [CONTEXT.md](CONTEXT.md)；旧科研路线图不再作为当前产品目标。
