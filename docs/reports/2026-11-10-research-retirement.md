# Tinker 科研退役执行记录

起始基线 main `4ca339592668581c1dc36abc9097fc9bf0aa1650`。隔离分支 `refactor/tinker-general-product-cleanup`，原目录全部未提交改动保留。执行期间重新核实 PR #19 已由用户合并，main 为 `53c191d663e1733840aa6fa0475ca6494e98bce4`，通过正常 merge `2de0c30` 同步，零冲突。本批没有改写 Rust 源码，也不声称生产已切换 Rust。

## 批次 1：Tinker 身份与当前开发规则

已改写当前 CLAUDE、CONTEXT、README 和开发入口文档。当前 SDK/架构说明与运行代码对齐，完整旧 SDK 调查归档到 [历史 SDK 集成](../history/ASCI-agent-sdk-integration.md)，15 份专属科研规格加历史状态头且保持原路径与主体。旧科研资源链接指向不可变 Git 基线，避免成为断链或当前恢复指令。保留有效规则、当前 Tinker 仓库工作流、原作者及上游来源。完整旧科研 CONTEXT 归档到 [历史领域词汇](../history/ASCI-CONTEXT.md)，不再作为当前产品目标。

新建项目/默认会话的身份文件使用 Tinker，保留 ambient CLAUDE 防护、运行时语言指令和兼容路径。仅在文件缺失时写入，已有用户/历史文件保持原样。本轮没有扫描或修改真实会话目录，没有改 seed/prune、数据库、登录、密钥和安装版。

| 验证 | 结果 |
|---|---|
| 新身份测试 RED | 4 通过、4 预期失败，旧 ASCI 内容触发失败 |
| 身份测试 GREEN | 8 通过，0 失败 |
| 身份与路径定向回归 | 25 通过，0 失败，79 断言 |
| 全仓 Bun | 3471 通过，0 失败，385 文件 |
| 类型检查 | 6 workspace 通过 |
| 全仓 lint / diff 检查 | 通过 |
| Electron build | 通过，仅构建 |
| 独立规格与质量审查 | 通过，无可确认重要问题 |

原 CONTEXT 全文归档比对通过，仅调整移动后的相对链接。61 个本地文档链接存在，AGENTS 符号链接及 LICENSE/NOTICE 保持。未执行真实 SDK 指令优先级、原生 UI 或线上调用验收，不将生成文本测试称为实际模型身份验证。

## 批次 2：停止默认科研执行，保留通用媒体

已移除科研意图/sticky 专属路由、系统提示中的强制科研链、科研 MCP 构造和 hook 装配、启动时科研后台服务与能力包 seed。内置 `lit-search`、`lit-review`、`research-gap` 三包（19 文件）和五个专属工作流技能（9 文件）从源码分发退役。另删除 3 个仅针对已退役资源的延迟/生成器测试，历史 parser/schema/export 与通用测试保留。

OCR/ASR 使用既有独立设置字段，不再依赖 Zotero 总开关。MCP 设置保留可操作的媒体开关与缓存管理，ASR 默认关闭，挂载不下载。九个 Zotero 科研写入/重建入口明确返回 `SCIENTIFIC_WORKFLOW_UNAVAILABLE`，历史读取与媒体管理接口保留。

用户自建 MCP、Agent、技能、能力包继续通过通用接口装配。停止自动覆盖项目 `.claude/agents`、`.mcp.json` 和自动修改 Claude trust。技能运行目录使用本次自有临时投影，命名空间与手动 Skill 引用一致；SDK 查询与后台任务持有租约，停止/异常/关闭后按明确生命周期释放，不抢删仍活跃的资源。

已安装的五种已知工作流副本仅在目录布局和完整指纹与当前发布版精确相符时从运行投影排除，未知/修改副本保留，**不删除磁盘用户文件**。指纹识别先有界检查全部元数据，额外附件、缺失、变长、链接、超深/过多条目直接保留而不读附件正文。仅已知小文件布局才有限分块读取并复核 fd 身份、大小与读取后的布局。

| 验证 | 结果 |
|---|---|
| 科研路由/MCP/启动/媒体/注册定向行为 | 红绿回归通过 |
| 五种发布副本与修改副本 | 5/5 已知排除、5/5 修改保留 |
| 指纹读取边界 RED → GREEN | 1 通过/4 预期失败 → 13 通过/0 失败（含投影回归） |
| 全仓 Bun（最终有界指纹源码） | 3388 通过、0 失败，387 文件，9043 断言 |
| 类型 / lint / Electron build / diff | 全部通过，6 workspace 类型检查 |
| SDK 关闭生命周期回归 | 70 次模拟 started→abort/dispose、异常迭代与 local_workflow 终态通过 |

定向宿主夹具运行真实 IPC 注册、MCP 装配、`runOrchestratorQuery`、`ClaudeAgentAdapter`，SDK query 被模拟且 baseOptions 人工构造。不是完整 `AgentOrchestrator.sendMessage`、原生 SDK 派活或 UI 验收。原生模型、GUI、Python/OCR/ASR 执行及真实下载未测试，也未读取密钥或调用付费服务。

旧 project `settingSources` 保留。无法判定归属的既有 `.claude/agents`、`.mcp.json`、项目指令与未知旧技能版本不改动，仍可能被 SDK 自行发现；不宣称所有磁盘发现路径已关闭。SDK 原生 programmatic Agent 派发及 symlink plugin 行为仍待验证，不以此为由恢复自动 trust 写入。

## 批次 3：旧科研页面与替代路由

新会话和空右栏恢复只显示 Files。Papers/研究空白从已有结果显式打开，仍可关闭、重开和阅读。移除论文主面板、展开窗口、详情、Library 替代详情和嵌套资料弹窗的科研入库/图谱/生成/沉淀等主动操作。保留已有表格、来源锚点、本地 PDF、复制/导出路径与普通笔记。

旧导入 atom 只清内存，不执行 ingest/link；科研确认卡片只读。两个科研等待服务立即取消，不留 pending Promise，不发新卡片；迟到响应不能重启流程。通用 ChoiceCard、权限、AskUser、ExitPlan 与普通消息不受这两类旧请求阻塞。论文 IPC 的六项确证科研写入和图谱 build/add-to-Zotero 先返回不可用，不打开存储或联网。普通 notes、feedback、读取/导出和既有资料管理保留。

Library 中已有 review/conversation 的引用和普通 free note 仍能操作；退役的仅 paper 入库分支。账户说明已澄清“本地记录不随账户跨设备同步”与“模型/工具可能接收任务所需输入”，不承诺对话绝不上传。不改登录/OAuth。

| 验证 | 结果 |
|---|---|
| 最终定向 React/IPC/service 回归 | 78 通过、0 失败，11 文件，188 断言 |
| 全仓 Bun（独立审查修复后） | 3399 通过、0 失败，390 文件，9100 断言 |
| 类型 / lint / Electron build / diff | 全部通过，6 workspace 类型检查 |
| 独立审查 | 两项 P2 修复后通过，无剩余阻塞发现 |

曾有一轮同时构建时 wrapper fixture 在默认 5 秒超时；单独复测 2/0，之后完整 suite 两轮均通过，未改超时或 skip。只能记录其为瞬时失败，不能将资源竞争当已证明原因。默认沙箱的本机回环监听失败另经正常狭窄权限运行验证，未绕过拒绝。

页面验证为真实 React/Jotai + happy-dom 与合成 main IPC 委托，不是原生 Electron 点击。实际点击验证保留的 review/conversation 引用与笔记保存，零 paper 入库。原生 GUI、Zotero、账户、真实模型/数据未验收。未引用的旧科研弹窗/图谱兼容源码仍有保留，不宣称全源码清场。

## 批次 4：专属技能资源与统一退役策略

追加删除经过逐目录依赖核对的 49 个专属技能目录，精确 402 文件、5,090,292 原始字节。与首五个工作流合计退役 54 个技能目录，保留 35 个通用与 10 个跨用途技能；完整清单见[逐目录清理表](./2026-11-10-scientific-skill-curation.md)。原有 root LICENSE/NOTICE 与五个保留技能 LICENSE.txt（共七路径）逐字节保持。

54 项受信发布布局/指纹集中到 shared JSON，seed/copy/upgrade/discovery 使用同一策略。运行时仍只排除精确已知副本，未知/修改副本保持可用和原字节，不删除安装目录。元数据检查按每个精确布局预算，硬上限 64 条目、4 路径段、64KiB 单文件、512KiB 总正文；正文用 8KiB buffer，读取至发布字节数加一个哨兵字节，并保留 fd 身份/时间/大小及读取后布局复核。实际最大目录 35 条目、457,166 字节，不因一处额外附件而读它的正文。

保留技能中四处对退役技能的可选建议已在三个文件中改为通用能力表述。EDA 内对外部 Python 库的示例保留，不将库 import 误判为已删技能目录依赖。不卸载通用 Python 或已安装外部库。

| 最终验证 | 结果 |
|---|---|
| D 定向测试 | 15 通过，0 失败 |
| 全仓 Bun（含最新 main 与全部清理） | 3400 通过，0 失败，391 文件，9150 断言 |
| 类型 / lint / Electron build / diff | 全部通过，六 workspace 类型检查 |
| 真实 Git 基线重建审计 | 54/54 发布指纹与布局通过，45 保留目录、七法律文件、统一策略及实际 mock SDK plugin 输入通过 |
| 每布局异常/读取边界 | 已知与修改副本、额外附件/链接、有限读取与投影回归通过 |
| 常规测试无 Git 历史 | 通过，使用合成正文及隔离子进程 digest 映射 |
| 显式历史审计缺基线 | 明确 needs-history 退出 1，不自动 fetch 或静默 skip |
| 独立资源/指纹/依赖审查 | 通过，无未关闭重要发现 |

正常永久测试不保留被删科研正文，也不依赖浅克隆中未必存在的旧 Git 对象。合成 digest 映射验证布局/策略，不冒充真实原文 SHA-256；另用本机完整历史显式运行无映射的真实重建审计，二者分开记录。真实审计命令为：

```sh
bun apps/electron/src/main/lib/__tests__/fixtures/scientific-assets.fixture.ts --git-baseline
```

夹具自行使用合成目录。此命令需要本地 `4ca339592668581c1dc36abc9097fc9bf0aa1650` 对象，不读取用户技能目录或自动联网取历史。

## 同步最新 main 后的 Rust 回归

合入用户已合并的 `53c191d` 后，本分支相对该 main 的 `apps/tinker-rust` 源码差异为零。重新运行：

| 检查 | 结果 |
|---|---|
| `cargo fmt -- --check` | 通过 |
| Rust Lab Vite build | 通过 |
| `cargo clippy --locked --all-targets -- -D warnings` | 通过 |
| `cargo test --locked` | 141 顶层测试通过，0 失败，不重复累计子进程辅助测试 |

首次 clippy 因新工作树缺少 `frontendDist` 报错；正常构建 Lab 前端后原命令通过，没有改 Rust 源码或压制检查。测试使用隔离目录、伪凭据和本机回环模拟服务，未运行线上模型或原生窗口。本批补测不能当作完整新栈产品/UI 验收。

## 保留边界与后续

- 当前 Electron/SDK 后端、会话/渠道/生图/文件/项目/登录和通用媒体仍保留，Rust 未替代的生产后端不退役。已有安装版没有被覆盖或重启。
- 历史科研对象、schema、读取/导出、PDF/锚点和普通笔记保留，没有删除表或迁移真实会话。
- `@asci/*`、`ASCI_*`、`.asci/.asci-dev`、协议名、app identifier、OAuth/deeplink 与许可证/原作者归属继续保留。外部 Google 同意页面/服务配置没有修改。
- 未使用的旧科研 dialog、GraphModal/NodeInspector、科研服务/resource 源码有保留，处于未接入或兼容边界。没有声称全部科研源码、所有 ASCI 字符串或所有历史规格被删除。
- 用户自建/修改资源、旧未知版本、已有 project CLAUDE/agents/MCP 不能凭名字销毁；SDK 自行发现边界仍存在。
- 通用 Agent 在真实原生 SDK 中派活、原生 GUI、中英/主题手动切换、真实模型与媒体执行仍需验收。本批没有重做完整 MVP UI，没有模型费用、整机内存或速度改善的实测声明。

## 本地证据与回滚

发布前差异检查未发现新增凭据模式、用户数据或构建产物路径；LICENSE/NOTICE、保留技能法律文件、bun.lock 及相对最新 main 的 Rust 源码均零差异。原主工作区仍在 `codex/tinker-rust-foundation`，读取时有 63 个 dirty 条目，本批没有在那里修改源码或清理文件。

完整日志保留于 `/private/tmp/tinker-cleanup-checks-20261110`，包括 identity/runtime/history/assets 与 final-rust 前缀。检查通过的命令为 `bun run typecheck`、`bun run lint`、`bun test`、`bun run electron:build`，Rust 的 fmt/clippy/test 及 Lab Vite build。运行时清除 ambient 服务变量，ASCI_CONFIG_HOME/ASCI_RUNTIMES_HOME 指向全新的合成目录，Cargo 复用已确认缓存；回环模拟采用正常权限路线，不读取凭据或触发付费调用。

| 清理提交 | 作用 |
|---|---|
| `eab860e` | Tinker 身份与基础开发文档 |
| `23b257f` | 科研运行接线退役、媒体独立控制 |
| `64b52e3` / `e95a1b7` | 当前 SDK/架构说明、历史规格状态与源链接 |
| `5cb68de` | 科研主动 UI/IPC 退役、历史与通用资料管理保留 |
| `180a68f` | 追加 49 个专属技能及统一有界识别 |

需要源码回滚时按依赖逆序 revert 对应清理提交，先资源再 UI 再运行接线，最后文档/身份。**不回滚用于同步用户 main 的 merge `2de0c30`，不撤销用户已合并的 Rust PR #19。** 不删除已有数据以消除回滚冲突。单个旧读模块尚有依赖时先保留并审查，而非删除整目录。

远端分支为 `refactor/tinker-general-product-cleanup`，按正常 hooks 提交并仅交付 Draft PR。最终完整 head SHA、PR 与该 SHA 的 checks/status/Actions 以交付回复及 PR 审查评论为准；本报告记录本地证据，不将无 CI 记录称为通过。不合并、不部署、不安装。
