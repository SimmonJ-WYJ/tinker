# Tinker 领域语言

当前产品面向通用聊天、写作、编程、图像与文件任务。本文件保留通用对话、编排、遥测与数据所有权定义。
科研证据集、研究空白、论文语料和旧版本路线图已存入[历史 CONTEXT](docs/history/ASCI-CONTEXT.md)，仅用于理解旧数据、协议和代码来源，不作为当前产品目标。
来源与许可见 [NOTICE](NOTICE)、[LICENSE](LICENSE) 和[历史 README](docs/history/ASCI-README.md)。

---

# 对话流（Conversation Flow）

Tinker 桌面应用里 Agent 与用户对话的可视化区域。本文件记录"对话流"这一领域的统一语言，
供产品与工程在讨论会话渲染、执行过程展示时对齐术语。

## Language

**回合 / Turn**:
两次用户输入之间，Agent 产出的一段连续内容（可含多条 assistant 消息）。
_Avoid_: 消息组、message group（实现层用语，不在产品讨论中使用）

**过程块 / Process Block**:
Agent 在抵达最终回答前的中间步骤——即"思考（thinking）"块与"工具调用（tool call）"块。
_Avoid_: 中间消息、step（单说 step 时含义不清）

**最终回答 / Final Answer**:
Agent 面向用户的文字输出（text 块）。是用户真正关心的"结论"，始终一级可见、不被折叠。
_Avoid_: 文本块、text block（实现层用语）

**执行步骤组 / Execution Step Group**:
一段连续（≥2 个）过程块折叠而成的、对话流一级只占一行的可展开父集。
折叠时：运行中显示当前步（带转圈），完成后显示"已执行 N 步"；有步骤失败则显示报错徽标"⚠ 执行 N 步·M 步失败"（不自动展开）。
默认折叠，点击展开按原样式逐条看详情。
**单步退化**：若一段过程只有 1 个步骤，不包组，直接显示该过程块本身（保留具体工具名）。
_Avoid_: 父集（口语简称，正式文档用"执行步骤组"）、TodoBoard（那是另一个已存在的概念）

**队友 / Teammate（scenario sub-agent）**:
主 Agent 通过 `Task`/`Agent` 工具派发的子 Agent（如狐尼克、鹰尼克）。
每个队友的过程块单独成一个 **执行步骤组**，折叠行带队友名徽标（⊙ 名字·执行 N 步）。
_Avoid_: 子代理、subagent（口语可用，徽标统一用昵称）

**TodoBoard（任务进度卡）**:
Agent 的实时待办清单，由 `TodoWrite`/`TaskCreate`/`TaskUpdate` 工具驱动，渲染成一张进度卡片。
**与执行步骤组无关**——它是状态看板而非"待隐藏的过程"。
_Avoid_: 把它和 Task/Agent 派发（队友）混为一谈——二者都带"Task"字样但语义不同。

## Relationships

- 一个 **回合** 由若干 **过程块** 和 **最终回答** 交替组成
- 连续（≥2）的 **过程块** 折叠成一个 **执行步骤组**；**最终回答** 切断分组
- **说话人切换**（主 Agent ↔ 队友、队友A ↔ 队友B）也切断分组：每个 **队友** 自成一组
- **TodoBoard** 作为一级可见卡片，同样切断分组（组 → TodoBoard → 组）
- 因此对话流一级呈现：`最终回答 → 执行步骤组（一行）→ 最终回答 → 执行步骤组 → …`

## Example dialogue

> **PM：** 一个回合里 Agent 想了一下、查了三个工具、然后回答，对话流上看到什么？
> **工程：** 一个 **执行步骤组**（一行"执行 3 步"）+ 下面的 **最终回答**。想看过程点开那一行。
> **PM：** 如果中间它先回了半句话再继续查呢？
> **工程：** 那半句 **最终回答** 切断分组，变成：组 → 文字 → 新的组 → 文字。
> **PM：** 它派了狐尼克和鹰尼克干活呢？
> **工程：** 主 Agent 一组，狐尼克一组（⊙ 狐尼克·执行 6 步），鹰尼克一组，各自折叠。

## Flagged ambiguities

- "执行步骤"既可指单个过程块，也可指折叠后的组——已区分：单个叫 **过程块**，折叠后的父集叫 **执行步骤组**。
- "Task"歧义：`Task`/`Agent` = 派发 **队友**；`TaskCreate`/`TaskUpdate`/`TodoWrite` = **TodoBoard** 待办清单。二者无关。
- 单个过程块不成组（**单步退化**）——避免出现无意义的"执行 1 步"。

---

# Agent 编排（Orchestration）

记录主 Agent / 子 Agent / 工具执行的通用语言。当前执行边界以 `agent-orchestrator.ts`、`run-orchestrator-query.ts`、`agent-prompt-builder.ts` 与注册表源码为准。

## Language

**主 Agent / Master Agent**:
接收用户需求、在当前模式允许的工具与队友中决定执行方式的 Agent。权限、工具范围、模型与语言由运行时配置约束。

**队友 / Teammate（SubAgent）**:
主 Agent 派发任务的独立子上下文；它在对话流中以队友执行步骤组展示。是否派发取决于任务与当前可用注册项，不要求每个任务都经过多 Agent 或能力包。

**能力包 / Capability Pack**:
将场景 Agent、Skill / MCP 引用与 UI 配置组织在一起的扩展容器。术语不代表任何科研包默认启用；已安装资源、历史数据兼容与当前可执行工作流是三个不同边界。

**权限边界 / Permission Boundary**:
主进程装配 SDK 查询、允许工具与权限请求的约束。子 Agent 和工具不能通过文案绕过该边界。

## Relationships

- 用户需求 → 主 Agent → 直接回答、工具调用或派发队友 → 对话流展示过程与最终回答。
- 用户可用能力以当前模式、设置与注册表为准；工作区身份文件用于声明宿主和隔离无关 ambient `CLAUDE.md`，不能覆盖主 system prompt 或语言 directive。
- 历史 Supervisor 多包协同、科研路线图与未实现协议保留在[历史 CONTEXT](docs/history/ASCI-CONTEXT.md#agent-编排orchestration)，不据此推断当前实现。

---

# 遥测埋点（Telemetry）

记录"崩溃上报 / 行为埋点 / 自进化信号"领域的统一语言。架构决策见 [ADR-011](docs/adr/ADR-011-telemetry-architecture.md)，实现地图见 [telemetry-spec](docs/specs/telemetry-spec.md)。

## Language

**埋点三层 / Three Telemetry Layers**:
Sentry 崩溃上报（恒开、脱敏）、PostHog 行为埋点（toggle ①）、自进化信号（toggle ②，独立通道）。三层独立；Sentry 是否初始化仍受 DSN 与运行环境门控，行为埋点和自进化信号各自受 consent 控制。
_Avoid_: 把三层笼统称"埋点开关"——Sentry 无开关，两 toggle 各管一层且解耦。

**deviceId（匿名设备标识）**:
本地生成的 UUID。未登录时作为行为事件归属键；登录后行为事件使用账户 uid，并通过 identify 合并匿名历史，设备标识本身不变。
_Avoid_: 用户 ID（它不含也不可逆推任何用户信息）。

**consent 模式 / opt-in vs opt-out**:
GDPR 区（含 EEA/UK，时区启发式判定，无法判定按 GDPR 区）默认关、需显式开启 = opt-in；其余默认开、可随时关闭 = opt-out。用户显式选择持久化后优先于地域默认。
_Avoid_: "欧盟 IP 判定"（实现为本地时区启发式，不查 IP——见 ADR-011 §2）。

**采集入口全停 / Full-Stop Gate**:
consent 关闭的语义：不写本地缓冲也不上报，而非"本地照写、只闸上报"。
_Avoid_: 上报开关（窄化，会暗示本地仍在记录）。

**自进化信号 / Self-Evolution Signal**:
5 类结构化信号（任务结构、工具使用、模型选型、错误异常、工作区结构）+ 隐式反馈。字段范围以 `schema/telemetry/*.schema.json`（Zod 生成，tracked）为审计事实源；出口前 Zod strip = 白名单。
_Avoid_: 6 类（Proposal 决策信号已随 Proposal 移出 0.3）。

**隐式反馈 / Implicit Feedback**:
用户对 Agent 产出的非显式质量信号：copy / save / cite / discard / retry；实际事件与动作以事件注册表、信号 schema 和调用点为准。只采动作与对象类型，不采内容。

**脱敏红线 / Redaction Red Line**:
任何出口绝不含：文献全文、PDF、笔记原文、对话原文、检索词、凭据、邮箱、IP、用户名及含用户名路径（路径用户名段 → `<USER>` 占位符）。

## Relationships

- renderer 显式埋点 → IPC → 主进程 telemetry-service（唯一闸口：consent → 白名单 → 脱敏 → deviceId 注入）→ SaaS / 本地 JSONL。
- 事件名 + 属性白名单的事实源 = `packages/shared/src/telemetry/event-registry.ts`（调用点禁裸字符串）。
- 自进化 sender 可插拔：未配置 `ASCI_EVOLUTION_ENDPOINT` 时仅本地 `signals.jsonl` 缓冲；网络出口还须满足 consent 与运行环境门控。

## Flagged ambiguities

- **遥测事实源**：开关、允许字段、脱敏与发送条件以 `telemetry-service.ts`、`sentry-init.ts` 和 `schema/telemetry/` 为准，不从历史版本目标推断线上已启用。
- **native minidump 脱敏**：Crashpad 二进制转储无法客户端脱敏（不含应用注入的用户字段），为 Sentry 已知边界。

---

# 数据所有权（Data Ownership）

本地用户数据属于用户。品牌调整或科研入口退役不能删除历史对象、破坏 schema、清空资源目录或自动迁移真实目录。配置与数据库兼容路径仍使用 `.asci` / `.asci-dev`。

## Language

**导出包 / Export Bundle**:
设置页的数据导出操作生成的 zip。现有 `objects/export-service.ts` 导出 5 类持久对象：Paper、EvidenceRef、Note、EvidenceSet、Review，并附清单、schema 副本和可用的 Review 正文。这是历史数据携出契约，不表示新增科研工作流仍开放，也不表示包含全部聊天、图片、渠道配置或可完整恢复应用。
_Avoid_: 完整备份 / backup（当前导出不承诺完整恢复或导入）。

**对象标准 / Object Standard（O1 Schema）**:
由 TS 类型生成到 `schema/objects/` 的开放 JSON Schema。导出包附相应 schema，外部工具可据此解析数据；历史对象名保持兼容。

**清单 / Manifest**:
导出包内的自描述文件，记录应用版本、时间、对象计数与数据文件对应 schema。读取方先读清单再解析数据。

## Relationships

- 每类导出对象一个 JSON 数组文件；软删对象同样导出，读取方按 visibility 过滤。
- Review 元数据通过包内相对路径关联正文；缺失正文记入 warnings，不泄漏用户本机绝对路径。
- 对象不符合 schema 时导出中止，不落盘生成半成品。Proposal 只附 schema、不导出对象数据；CitationRelation 已不在导出契约。
- 会话历史读取、图像版本引用、普通文件与项目数据的现有存储契约另行保留，不因这份对象导出清单而删除或缩减。
