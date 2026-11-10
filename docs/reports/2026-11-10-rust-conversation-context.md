# Rust 多轮上下文迁移阶段报告

状态：限定范围的实现和自动化验证完成，独立审查通过，准备安全分支与 Draft PR 交付。不是整套产品或原生窗口验收完成。

## 基线与范围

- GitHub main：`4ca339592668581c1dc36abc9097fc9bf0aa1650`，已包含前轮 HTTP/SSE 迁移。
- 分支：`feat/rust-conversation-context-audit`。
- 工作树：`/private/tmp/tinker-context-audit-20261110`。
- 设计与验收：[持久父链规格](../specs/2026-11-10-rust-conversation-context.md)。
- 并行只读审计：[ASCI 与科研保留报告](2026-11-10-legacy-research-audit.md)，清单仅针对上述 main 基线。

本批让显式父执行引用贯穿 Tauri handler、控制器、上下文重建、HTTP messages 和既有事件持久化。只有成功完成的父链可以继承，分支彼此隔离；取消、失败、中断的部分输出仍可读，但不当作成功历史发送。超出明确预算时拒绝，不静默裁剪。

不改正式 Electron UI、功能、入口、依赖、配置路径或安装版。不读取真实会话和密钥，不调用外部模型、不收费、不操作原生验收窗口。科研文档和旧功能这轮只审计，不删除；许可证、作者归属、兼容包名与数据路径保留。

## 兼容及降级边界

原 v1 日志和 start/read/cancel DTO 保持；新增 continuation 的私有 v2 header 放在同一 RunStore、同一 writer.lock 管理的 `runs-v1/context-v2` 子目录。旧 reader 仍能打开根目录 v1，新 continuation 在旧版本暂不可见但不会被删除。重新升级后可读取。降级混写如发生相同 ID，新版明确拒绝冲突，不任选一份；跨布局同 createdOrder 按固定顺序读取，不将其宣称为真实墙钟时间排序。

默认桌面入口仍为离线实验。仅实现旧 provider 接口的实现对多轮返回 `contextUnsupported`，不把固定模拟文字说成理解了上下文。可信 HTTP 宿主通过合成服务验证真实消息数组。

## 实际验证证据

| 检查 | 结果 |
|---|---|
| main Rust 基线 | 118 顶层测试通过，0 失败 |
| 最终 Rust 全量回归 | 141 顶层测试通过，0 失败，新增 23 项，不重复累计子进程辅助结果 |
| 全仓 Bun | 3463 通过，0 失败，384 文件 |
| 六 workspace 类型检查 | 通过 |
| 全仓 lint | 通过 |
| Rust Lab Vite build | 通过 |
| Electron build | 通过，未启动或安装 |
| Rust fmt / clippy（所有 target，警告作错误） | 通过 |
| 原生 binary build | 通过，Mach-O arm64，仅编译 |
| 独立规格及质量审查 / simplify | 核心行为满足规格，无未关闭重要代码问题，未测故障窗口见下文 |
| 科研清单独立重放 | 全部文件、正则、计数、资源集合一致，零差异 |

最终 Rust 分组：库 70、HTTP 协议 7、传输 10、多轮 IPC 6、历史 IPC 2、历史库 4、原执行 IPC 11、SDK 历史 12、会话历史 14、生命周期 5。测试使用伪凭据、合成数据及本机 numeric loopback。HTTP messages 按既有适配器及 [官方接口](https://developers.openai.com/api/reference/resources/chat) 序列化为独立 user/assistant 消息，不把历史拼成一条提示文字。

### 已实测的关键行为

- 真实 Tauri handler + MockRuntime + HTTP：两轮、子进程重开后第三轮，精确 1/3/5 条角色消息与 Unicode 内容。
- 同一父节点分支，其他分支变为 latest 后仍只沿显式父链继承。
- 双线程重复发送、重启后重复发送不新增请求，更换 input/scenario/parent 或 start/continue 模式明确冲突。
- 第二轮取消、503、超时、断流、配置 key 反射和进程 exit23：部分输出保留，失败轮不能当父，重启中断不重放模型副作用。
- 超过 16 个祖先、512KiB 总内容或非法父链拒绝，不创建子日志；精确边界、UTF-8、控制字符、引号及大于 16KiB 的真实出站正文已覆盖。
- 未来 schema/policy、缺父、自环、多节点循环、sequence/order 错误、截断、坏缓存、跨布局 ID 冲突、降级 order 平局、symlink/hardlink 与目录替换均有合成回归。
- 两遍启动预检：后项 lineage 损坏时，前项 header-only 或 Started/partial 日志不会被提前改写。
- context 目录只读导致真实 header create 失败：没有 provider 调用或子日志，同控制器保持 blocked，恢复权限并重开后才可明确重试。
- 实际 delta 存储失败只保留已确认内容。第二轮上游伪 key/错误 body 不进入 IPC 或 A/B/C JSONL。

### 审查修复与过程证据

首个真实行为红测失败于 `Command continue_lab_run not found`，实现后通过。补测又发现缓存掩盖跨布局同 ID，先红再修复。审查发现新 context-v2 目录项缺父目录同步，已在构造 store/provider 前确认根目录 sync；同时恢复有界首行扫描，避免每次创建执行都重读全部历史正文，完整校验仍在启动和父链读取执行。严格 clippy 曾提示布尔表达式简化，等价修复后重新运行。没有压制 lint 或跳过钩子。

日志目录：`/private/tmp/tinker-context-checks-20261110`，Cargo 缓存：`/private/tmp/tinker-rust-target-20261110`。旧临时工作树与旧缓存已不在，本轮新建隔离目录，不清理用户文件。原主工作区已有未提交改动，未在该处实施。

## 未验证与后续

本机 HTTP 服务与真实 handler 使用 Tauri MockRuntime，不能代替原生 WebView/界面验收。真实模型兼容、TLS 握手、账户认证、费用、工具、生图、项目和完整产品替换不在本轮验收范围。下一步真实调用需具体服务、模型、一次性凭据用途、合成请求及费用上限的授权。

未注入精确 Started append/sync、目录 sync 或文件 fsync 故障，没有做物理断电实验。实际 header 权限失败、delta 失败、损坏/截断恢复和控制流审查不等于全部 I/O 故障窗口验证。多轮专用 panic 场景没有另跑，沿用已测试的共享 catch_unwind 路径。未运行旧二进制，兼容证据为原 v1 文件/DTO 形状与模拟降级混写测试。未测其他 OS、模型 token 容量或整机内存收益；启动全库扫描仍无全局 run 数预算。

字节上限不是模型 token/费用额度。没有自动摘要或裁剪，没有模型配置 UI，没有将 HTTP provider 默认启用，也没有复刻完整产品 UI。旧 providerKind/scenario 仍是兼容元数据，不能当真实网络来源展示。

回滚首选停止使用新增 continuation 命令；整批 revert 不删除已有实验历史，原生产应用不受影响。保留新子目录数据供新版恢复读取，不以删除数据解决冲突。

## 交付约束

最终 diff 审阅与凭据模式扫描未发现实际凭据。生产 `apps/electron`、`packages`、`bun.lock`、两套原型前端及旧原型源码零差异。正常 pre-commit 会自动递增根包及 Rust Lab 包 patch 版本，只有版本元数据变化，不增加生产依赖。README、CLAUDE、现有科研功能和许可证未改动。

源码、规格、审计与清单按同一安全分支交付，正常钩子提交及推送，只开 Draft PR，不合并或部署。具体远端 SHA、PR 和 CI 查询结果以最终交付回复及 PR 审查评论为准；没有 checks/status/Actions 记录时不称 CI 通过。
