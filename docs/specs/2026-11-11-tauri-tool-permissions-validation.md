# Tinker-A 工具权限原生验收记录

状态：Task4 进行中；未达到用户下载交付门槛。2026-11-16 恢复于持久工作树。

源码基线：`7e58fe4fd59d25dfaeb502e31fc64e972f10ebe9`（Task1–3 已完成）。Task4 只增加构建入口、QA 隔离与实际验收记录。README/CLAUDE 未修改。

本轮 checks：`/Users/simmonj/Documents/ChatGPT/Tinker/migration-work/tools-native-checks-20261116`。
命令经 `run-clean.py` 过滤环境，使用隔离 ASCI home、离线 Cargo 和独立持久 target；不读取真实凭据、不连接外部模型、不安装应用。

## 构建身份

| 用途 | binary | identifier | renderer | feature |
|---|---|---|---|---|
| 普通工具预览 | tinker-tools-preview | com.tinker.tools-preview | formal-dist | formal-preview |
| 原生工具 QA | tinker-tools-native-qa | com.tinker.tools-native-qa | native-qa-dist | formal-native-qa |

普通入口固定 `None` 探针，即使 all-features 编译也不会安装 QA 控制器。QA 入口要求显式 `TINKER_TOOLS_PREVIEW_ROOT`；TrustedRoot 在任何窗口/数据操作前验证合成工具临时根。配置身份在 Builder 创建前验证。普通包使用独立 `synthetic-tools-v1`，不取代 M2、Lab 或 Electron。

## 当前验证

- 新增构建隔离测试：首次 1 pass / 2 fail（新配置及 helper 缺失），实现后 3 pass / 0 fail；原始日志 task4-red.log / task4-green.log。
- 全仓类型检查与 lint 退出 0；日志 typecheck.log / lint.log。
- Lab、正式、QA renderer 均已用自身 Vite 配置实际构建；保留已知大 chunk 警告。
- 初次从仓库根执行 Electron Vite config，因 Tailwind 工作目录错误失败；随后从各应用正确 cwd 构建通过，未修改样式掩盖失败。
- 首次全特性 Rust 测试退出 0（rust-all-features.log；最终源码复跑待补）。新增 `[partial-error]` 合成 mock 场景先失败后通过：formal_mock 3 pass / 0 fail（partial-red/partial-green 日志与收据），真实 SSE 文本后断流，无终态 SSE；不伪造核心状态。
- 后续补最终计数、构建产物与原生证据。

## 尚待完成

正式工具包与 QA 包构建、实际 WKWebView 控件完整流程、权限拒绝/超时/取消、reload/进程重启/关闭、语言主题、背压与历史/HTTP 关联，以及全套回归与独立审查。任何未执行的项目不视为通过。

签名仅计划本机 ad-hoc，不代表公证或 Developer ID 签名；不绕过 OS 安全提示。回退方式为停止新预览应用，继续使用原 Electron；本批不会安装到 Applications 或切换生产数据。
