# Rust 会话草稿持久化基础

状态：隔离实验实现，未接生产会话。关联 issue / PR：无。领域事实源：本文件与 src-tauri/src/session_store.rs。

## 本阶段范围

在既有 apps/tinker-rust 上继续，保留 com.tinker.rustlab 标识及旧 snapshot、save_draft、submit_draft 命令。仅持久化默认会话 draft 的草稿；不是完整会话历史迁移。原有内存 domain 的五个行为测试保留。未接模型、渠道、密钥、项目、消息流、重连、rewind 或 Electron 数据。

## 数据与接口

Tauri app_local_data_dir()/session-store-v1 内保存 draft.json、draft.bak 与 store.lock。路径由后端决定，前端不能提供路径。JSON schemaVersion=1；字段 sessionId、revision、draft。IPC protocolVersion 继续为 1，旧 architecture/draft 保留，新增 sessionId、revision、recoveryRequired、storageKind。React 解码器接受旧 v1 且明确标记 memory；未知协议拒绝写入。

单个草稿限制 65536 UTF-8 字节；读取文件上限 524288 字节，容纳 JSON 控制字符转义。仅允许受限 ASCII session ID，不执行用户输入。Unix 新建目录 0700、新建文件 0600；拒绝直接符号链接。不是防御同一用户恶意并发文件替换的安全隔离机制。

写入：进程级文件锁 + 进程内互斥 + 预期 revision；先写上一版备份，再同目录临时文件写入、sync_all、rename、Unix 目录同步。同步失败报告结果不确定，要求保留输入并重读。临时文件不自动当成已提交记录。显式保存及尝试发送才写入，尚无自动保存。

读取损坏主文件时仅展示可用备份并禁止保存。recover_draft(expectedRevision) 显式保留损坏原件，再恢复备份。备份可能少一版，界面明确提示。未来 schema、超大文件、无可用备份、路径异常都停止覆盖，不把它们变成空草稿。原件及备份不自动删除。

## 实施与兼容边界

1. 已有骨架及 Electron 未提交工作备份；隔离临时目录测试。
2. Rust 版本化存储、故障与并发测试。
3. 旧命令兼容适配器、可恢复错误码、Tauri 独立路径接线。
4. React 契约校验、中英文文案及显式恢复流程。
5. 通过检查后仅更新实验目录；不安装、不启动生产版、不迁移真实数据。

保持旧 submit 语义：先保存，再返回 emptyInput 或 modelNotMigrated，绝不声称请求已发送。保存错误先返回，不伪装成功。旧界面可忽略新增响应字段；新界面可识别旧内存后端。这里只是草稿层兼容，不能据此宣称完整 Electron 会话兼容。

## 验收与回滚

Rust 测试覆盖重开读取、Unicode、大小与 ID 限制、原子备份失败、损坏主/备文件、未来 schema、孤立临时文件、revision 冲突、线程并发、进程退出、路径符号链接及 Unix 权限失败。适配器保留旧错误/字段，验证模型未迁移仍保存输入。TS 校验旧/新/坏契约；浏览器合成 IPC 验证中英文及恢复分支。

原实验代码与本轮集成前的源码备份保留在 Tinker-A 项目会话的本地 diagnostics 目录，不进入本仓库。回滚仅恢复本轮列出的 Rust 文件并移走新增文件，禁止重置整个仓库。旧安装版本从未替换，可继续使用。实验数据留原地，回退的内存版不会读取或删除它。新旧实验进程不可共用运行；新进程抢锁失败会显示错误。

未验收：真实原生窗口完整端到端、物理断电/磁盘损坏、Windows/Linux 文件替换与目录持久化、生产数据导入、所有原有功能、整机内存收益。本机测试不能外推这些结论。下一步再做消息/事件模型与可中断执行状态，先用合成会话回放验收。
