# Rust 会话回放阶段实施计划

状态：本地实现与验证完成，准备独立Draft PR。用户已授权的隔离技术迁移批次。基线 main `a371b7f409f1e34a88bba4411694c95af923c86c`。领域事实源：既有 `tinker-rust-session-persistence.md`、Electron `AgentMessage` JSONL 与本规格。关联 PR：完成验证后仅建 Draft，不合并。

## 目标与边界

沿用 Rust/Tauri/React 基础，为后续会话迁移提供可验证的只读历史回放和执行状态模型，不连接真实用户数据或模型。现有草稿命令、schema、生产 Electron、图片交互与权限策略保持不变。

方案选择：本批次采用 Rust 流式只读适配器与纯状态机。直接导入真实历史或替换 Electron 存储需要完整 SDK/权限/工具兼容，当前证据不足，因此不纳入。本阶段不新增 Tauri 命令、前端功能或数据路径。

## 全局约束

- 不读取或迁移 `.asci`、Tinker Candidate、真实会话或密钥
- 不替换安装版，不重启用户任务，不改旧 worktree
- 不增依赖，沿用 Rust 1.89 floor、Tauri 2、serde/serde_json 锁文件与 React/TypeScript
- 本地北京时间00:00后实施，02:00停止启动新工作
- JSONL 仅读，不修补、不截断、不追加源文件，错误不含用户内容
- 只兼容简化 `AgentMessage` JSONL，不声称兼容 SDK 原始日志或全部 Electron 能力

## Task 1：有界历史回放

文件：新增 `src-tauri/src/session_history.rs`、`src-tauri/tests/session_history.rs`，在 `lib.rs` 导出模块。

接口：`read_history(reader: impl BufRead, options: HistoryOptions) -> Result<HistoryPage, HistoryError>`。`HistoryOptions { limit, before_line }`，默认64条，最大256条，行上限1MiB，每页保留源行总计最多8MiB。大消息页可更短，通过游标续读。游标为源文件一基行号，返回下一页之前的行号，不复制全文件。前提是调用方使用同一追加型文件，源文件被重写后的跨快照游标不在本阶段保证范围。

- [x] 测试先行：空文件、Unicode、所有四个角色、model及未知字段、分页顺序与无重复、坏行/未来形状、未完成尾行、超长行与读取错误
- [x] 验证缺失模块的预期失败，再实现队列仅保留最近limit条，解析时先限制行字节数
- [x] 对合法无换行结尾记录正常读取，对语法未完成的末行报告 `incomplete_tail`，中间损坏或无效语义拒绝整页，不静默跳过
- [x] 保留未知 JSON 字段语义，原文不写回。ID/角色/content/createdAt必要字段严格校验，时间戳在JS安全整数内

## Task 2：可中断状态模型

文件：新增 `src-tauri/src/session_lifecycle.rs`、`src-tauri/tests/session_lifecycle.rs`。

接口：`RunState::queued(run_id)`、`apply(run_id, RunEvent)` 与 `restore()`。状态queued/running/waitingInput/completed/failed/cancelled/interrupted，事件start/waitForInput/continue/complete/fail/cancel/interrupt。运行ID不一致、非法跨状态、终态重入拒绝并保留旧状态。恢复running/waitingInput标记interrupted，不自动执行、续费或重放副作用。该模型是迁移契约，不控制真实后台进程。

- [x] 先写queued→running→waitingInput→running→completed、取消、崩溃恢复、旧run拒绝与序列化测试并确认失败
- [x] 实现纯状态转移、v1持久化快照的安全解码与恢复，未来schema拒绝
- [x] 穷举全部状态/事件组合，证明失败不更改状态与终态无法继续

## Task 3：可复现测量与兼容检查

文件：新增离线测量 example与脚本，说明放 `docs/rust-session-replay/validation.md`。

- [x] 合成JSONL固定规模与内容，release构建同一个读取器，两种输入策略分别为全文件缓冲和流式文件读取，均输出同一历史页摘要
- [x] 每种策略至少3次，macOS `/usr/bin/time -l`记录最大RSS及耗时，明确仅比较解析路径，不是Electron/Tauri整机收益
- [x] Rust fmt/test/clippy、Rust Lab前端typecheck/build、整个仓库typecheck/test与Electron build，使用隔离fixture
- [x] 审阅diff、凭据模式与许可边界，验证老草稿测试仍通过，记录回滚和未验收
- [ ] 仅通过后按项目流程提交独立分支与Draft PR，核验远端SHA与该SHA检查状态，不绕过钩子/分支规则

## 回滚与剩余兼容

本阶段仅新增库模块、测试和测量工具，可逐文件移除模块及导出，不改变草稿v1结构和现行安装。旧工作区和用户未提交改动不动。尚未迁移SDK消息、项目、渠道、工具、付费确认、重连、rewind、真实后台取消、窗口资源管理与完整原生交互，不能宣称功能替代或整体内存下降。
