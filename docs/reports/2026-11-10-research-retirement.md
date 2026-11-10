# Tinker 科研退役执行记录

基线 main `4ca339592668581c1dc36abc9097fc9bf0aa1650`。隔离分支 `refactor/tinker-general-product-cleanup`，原目录全部未提交改动保留。PR #19 是独立 Rust 多轮迁移草稿，本分支不混入其实现，也不声称生产已切换 Rust。

## 批次 1：Tinker 身份与当前开发规则

已改写当前 CLAUDE、CONTEXT、README 和开发入口文档。保留有效规则、当前 Tinker 仓库工作流、原作者及上游来源。完整旧科研 CONTEXT 归档到 [历史领域词汇](../history/ASCI-CONTEXT.md)，不再作为当前产品目标。

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

## 后续与回滚

其余专属技能分发在后续批次处理，本段不把它们写成已退役。历史对象/引用/导出、通用 PDF/媒体、兼容路径及许可证保持。

各批独立提交，可按逆序 `git revert <commit>` 回滚源码。未替换安装版，当前运行版本不随本分支变化。最终提交/PR/CI 与后续批次结果以本报告补充及交付回复为准。
