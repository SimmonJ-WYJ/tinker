# 正式界面复用的 Rust Desktop Runtime 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development task-by-task。每个任务先行为红绿测试、再独立规格/质量审查。相关任务合成一个可用闭环后才发布 Draft PR。

**状态**：用户已授权规划后直接实施。基线 main `5683b781cc46ab631f73c7e84c735dcb9fb58021`，PR #19/#20 已合并。只读设计在本机检查目录 milestone-design.md，下面为执行事实源。

**Goal:** 在原正式 UI 中，以明确 opt-in 的 Rust 进程承接文本会话、模型选择、多轮流式、取消、错误和历史重启恢复，并用同一 Rust application service 绑定 Tauri handler。

**Architecture:** 原 renderer/preload 保持，Electron 主进程只增加薄后端路由、stdio client 和正式消息协议投影。会话/请求绑定与执行事实由 Rust 服务持有，沿用 RunController/context-v2；Tauri 与 stdio 使用同一 application service。未切换默认 Electron/SDK，不扩展 RustLab 页面。

**Tech Stack:** 现有 React/TypeScript/Electron、Rust/Tauri、serde/reqwest/tokio、Bun，优先复用依赖。

## 总里程碑

| 阶段 | 可用结果 | 完整切换前的缺口 |
|---|---|---|
| M1 本轮 | 原 UI → 真实 Rust 子进程 → 文本 HTTP provider，正式会话与恢复；共用 Tauri IPC | 仍借 Electron 平台，真实模型/原生环境另验 |
| M2 | 工具/权限/产物/生图/后台执行一致性；Tauri 加载同一 renderer，逐域实现平台服务 | 所有旧能力、资源协议、系统认证与密钥库对齐 |
| M3 | 合成旧数据兼容、用户授权导入/回滚、三平台和同条件资源测试，正式灰度 | 满足功能矩阵后才改默认和退役旧实现 |

本轮不将 M2/M3 写成已完成。无承诺几天迁完，不根据 Rust 语言推算内存收益。

## Global Constraints

- 保持原正式 UI、样式、布局与默认 Electron/SDK 行为。只在未打包、显式 opt-in、独立新建模拟数据根及可信 profile 配置同时有效时允许新路由，缺任一条件拒绝而非静默改根。
- 不读取真实 channels.json、系统密钥、会话、账户或项目数据，不发真实模型请求，不安装/部署。不恢复科研能力。不写原 dirty 工作树。
- 本轮可信宿主 profile 只允许 numeric loopback，禁 DNS/代理/重定向与外部地址。profile/model/revision 由宿主定义，renderer 只发送逻辑 ID，秘密不返回给 UI、日志、错误或持久化。
- 模型配置接口本轮为可信 profile 注册、元数据发现和模型选择，不声称迁完真实渠道凭据 CRUD。前端原渠道设置中未迁移的修改/探测接口明确 unsupported，不回落真实旧服务。
- DesktopRuntime caller root须由可信宿主预先在稳定父目录中durable创建，既有absolute非symlink目录；core不递归建caller祖先。每次open在namespace写入前确认root及直接parent，namespace/session自有目录链由core确认。
- 原始 run DTO/schema、Lab 命令与历史 reader 兼容，不重写真实数据。新正式会话使用独立 `desktop-runtime-v1` 命名空间及锁。
- 会话数量最多128，每会话最多128个请求记录，title最多1024 UTF-8字节，ID沿用64字节ASCII验证，时间戳为JS安全整数毫秒。现有输入/输出/事件/上下文上限保持，不裁剪冒充完整历史。
- 同一session的create支持reuseDraft=true；sessions.update只变title/pinned/archived；删除先tombstone且停止该session，不能在执行中释放文件锁或删除仍活跃run。
- 新 wire 版本1，单 JSONL frame最多4MiB，pending最多32，历史按序分页且每页最多2MiB序列化正文，正式旧API聚合最多16MiB，超限明确失败。任何 transport 错误不能自动重放副作用。
- session的当前profile可随明确的新send切换，历史每turn绑定不改；空draft首发选另一渠道也可用。旧requestId重放不能回退当前profile或触发HTTP。
- 请求身份冻结 session/request/profile/model/configRevision/input/effort，重放同一请求不再次调用 provider。失败、取消、中断不可作父链，重试新请求只继承最近成功祖先。
- 未迁移的 tool/thinking/多模态、附件/目录/MCP/skills、coding、queue/fork/rewind/compact 等要明确拒绝，不丢参数后假成功。默认 UI 始终传的 `taskMode:search` 是文本模式元数据，不能错误拒绝普通发送；默认 effort high 必须有明确协议映射，不能忽略。
- 请求取消后不接收晚到 delta，不接受迟到旧终态覆盖新请求。取消/拒绝不执行工具。本轮没有实际工具runner；模型返回工具块应明确 unsupported且执行计数为零，完整授权执行在M2。
- 面向用户新增说明/error走en/zh i18n，注释与日志中文，不用any，不加第二套状态库，不批量改内部ASCI标识。源码软500/硬800行，按域拆分。
- 每任务独立提交/审查，无重要未修问题才下一任务。最终Rust/Bun/类型/lint/构建与实际可行界面验证，无CI记录不称通过。正常hooks，安全分支/Draft PR，不强推/合并/安装。

## 方案取舍

先让 Tauri 直接加载现 UI 会先遇到 auth、同步主题、settings、更新、媒体、窗口和大量启动 API，容易变成空成功桥。先把真实业务放入 Rust application service，再用两个薄 transport 接它，可以更快让用户在熟悉 UI 验证新引擎；后续 Tauri 不再重迁会话逻辑。临时 Electron sidecar client 不承担新长期业务。

## 共同 wire 契约

请求/响应只用固定方法白名单和固定错误码，stdout只有JSONL协议。读取事件采用有界sequence游标轮询，不引入无限push队列。`chat.send`启动后台执行后立即回复，不能阻塞cancel。

```ts
interface DesktopRequest {
  version: 1
  id: string
  method: 'runtime.describe' | 'profiles.list' | 'sessions.list' | 'sessions.create' | 'sessions.update' | 'sessions.delete' | 'sessions.history' | 'chat.send' | 'chat.cancel' | 'chat.events'
  params: unknown // 各method在边界精确解码，unknown不能直接进入执行
}
interface DesktopReply {
  version: 1
  id: string
  result?: unknown
  error?: { code: string }
}
```

畸形frame若无合法id可发固定stderr码并关闭，让client统一fail pending，不能回显坏内容或输出伪合法reply。

result/error严格二选一，未知版本/字段/方法/ID/超限报固定码，不回显原始参数。Rust公开profile DTO不包含endpoint/key；秘密profile由trusted constructor或受控CLI配置初始化，Tauri command不接受renderer配置。Tauri `desktop_runtime_request`使用同一服务和decoder，不复制第二套业务。

`sessions.create`接title/profileId/workspaceId/reuseDraft；空draft的复用只在同profile/workspace下，正常create不隐式归入当前project。`sessions.update`接sessionId与title/pinned/archived，不能任意patch。

`chat.send`明确接requestId/sessionId/profileId/modelId/userMessage/startedAt/effort。start时间/请求绑定在历史与事件里保持，events记录包含sessionId/requestId/runId/sequence/kind，delta仅增量text，终态固定码。session history返回稳定turn/消息身份及状态、模型和时间，兼容层生成同一SDKMessage投影，不能编造usage/cost或SDK session provenance。

## Task 1：Rust 正式会话 facade、真实进程与 Tauri 共用服务

**Files:** 新增 `packages/shared/src/types/desktop-runtime.ts` 与barrel；Rust `src/desktop_runtime/`（mod/protocol/profile/session/store分域），`src/bin/tinker-runtime.rs`，`src/desktop_commands.rs`，测试 `tests/desktop_runtime.rs`/`desktop_process.rs`/`desktop_invoke.rs`，适当修改Cargo/lib/main。

**Consumes:** 既有RunController/RunStore/context-v2/ChatHttpProvider、合成trusted profiles。Task1先以既有OpenAI文本跑通服务，effort/public协议选择的出站映射由紧随Task2完成，Task3前必须过对应门槛；Task1不能声称已支持原UI发送。
**Produces:** `DesktopRuntime::open(root, profiles)` 及固定wire `dispatch`，真实stdout/stdio binary，同coreTauri状态及handler。实现者在首个测试前固定精确API并同步TS/Rust contract，不擅改上述wire方法语义。

- [ ] 明确session journal与run日志的事实源关系：先持久化不可变请求绑定与用户输入再启动run；启动前写入失败不调用provider。中间崩溃保留请求为interrupted/不确定，不自动重放。RunStore中输入/父链与绑定不一致拒绝。索引/缓存可重建，不让两个独立JSON都自认事实源。
- [ ] RED：session create/list/update/draft重用、不同会话历史隔离；请求绑定冲突；真实进程两轮与重启第三轮mock HTTP捕获1/3/5条角色消息，Unicode保留。
- [ ] 实现bounded元数据/请求journal、单写锁、每会话复用控制器、最多16活跃会话，迟到终态归属与重启恢复，不在每个请求open而interrupt活跃run。
- [ ] RED并实现：同时send只一次provider；更换input/model/revision/effort冲突；失败/取消部分输出保存；进程kill后interrupted；坏/截断/未来schema、安全路径和存储失败先拒绝。
- [ ] 真实进程测试：未知/超大/截断frame、错误reply ID、stdout不混日志、EOF关闭、慢provider期间cancel快速返回，父进程断开不留模型请求、无自动重发。stdin不提供任意路径/命令执行。
- [ ] Tauri真实invoke(MockRuntime)调用同服务；对非法参数同错误码；旧Lab tests继续通过。
- [ ] 运行Rust fmt/test/clippy，记录实际红绿/计数和各故障窗口未测项，独立review后Root提交。

## Task 2：两种文本协议与 effort 映射

**Files:** Rust provider新增Anthropic codec（按域拆文件），必要共享HTTP/SSE/secret/timeouts helpers；desktop profile/factory扩展protocol，合成server测试。现有OpenAI API/Run DTO兼容。

**Consumes:** Task1 trusted profile registry与request/effort不可变绑定。
**Produces:** `openai-chat` 与 `anthropic-messages` 文本provider均可选，明确capability。仅codec/私有provider工厂扩展，不触及renderer。

- [ ] RED：两模型/两协议真实loopback请求、正确路径/auth/角色/system字段、provider不支持effort或字段先拒绝；默认high及可支持effort真实出站，不静默忽略。
- [ ] Anthropic按官方Messages streaming的message_start→content_block_*→message_delta→message_stop验证状态，ping可忽略，文本增量UTF-8按字节分片可重组。非文本/tool/thinking块明确unsupported；error/非成功stop/truncated不伪装完成。
- [ ] 复用已验证取消/总120秒与idle15秒上限、域名禁用/loopback宿主范围、HTTP错误脱敏；测试并发取消、错误body/key反射、超时断流和socket清理，工具执行计数始终0。
- [ ] 官方协议参考：[Claude streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)、[Messages](https://platform.claude.com/docs/en/api/messages)。只引用协议，不调用真实服务。
- [ ] Rust tests/fmt/clippy通过且review后提交。

## Task 3：正式 Electron UI 的隔离 opt-in 路由与消息投影

**Files:** main新域 `lib/desktop-runtime/{client,router,projection,config}.ts`（按职责命名），`ipc/desktop-runtime.ts`，最小调整agent-session/channel域入口；shared stream union及原 `hooks/useGlobalAgentListeners.ts` 支持typed text_delta，测试原AgentView/AgentMessages/Atom真实组件。preload原API不改形状。

**Consumes:** Task1/2 wire、sidecar binary及trusted synthetic profiles。正式 session list/create/messages/sdkMessages/update/delete/send/stop必须一致路由，不能只改send让历史仍读旧后端。
**Produces:** 原UI+preload+main IPC→真实Rust进程→mock HTTP→持久历史→原UI，关闭opt-in回旧SDK。所有新业务归Rust，TS只适配。

- [ ] RED：默认不启用且旧IPC回归通过；packaged、缺root/配置/binary、非新命名空间、外部目标或异常配置不能启用。路径由主进程可信配置选定，renderer不能执行binary/改env/root。
- [ ] 在独立preview设置域初始化可选profile/model默认值，保持原设置接口与用户随后选择；不触及真实配置。平台偏好本轮可复用旧服务的隔离root实现，不能将这写成Rust配置存储已全部替代。
- [ ] Rust分支必须先分派，不执行旧sticky/context写入或SDK，未迁移操作不fallback。未迁移read/write明确unsupported，有语义安全的既有平台/独立root读服务保留且记录。
- [ ] profile元数据从Rust经原listChannels结构返回，至少2模型可选；未知profile/model/disabled/revision冲突拒绝；渠道凭据CRUD不调用旧decrypt/keychain。
- [ ] 同一history投影生成旧AgentMessage和SDKMessage，稳定UUID防重，user/assistant/terminal状态与durable记录一致。新增typed ASCI text_delta映射到现有applyAgentEvent，终态仅一个完整assistant，不反复推同UUID快照。
- [ ] STREAM_COMPLETE在history已可读后发送并保持startedAt；cancel stoppedByUser；固定错误恢复running且部分内容存在；旧进程/旧请求的晚到事件不能盖掉新流。sidecarexit/坏帧/超时清pending/停止poll，不自动重启重发。
- [ ] queue先明确unsupported，原有optimistic queue/draft恢复不得永久卡住；coding、工具、附件/目录、MCP/skill、非支持override拒绝不静默丢弃。保留原UI源，必须修改的listener/行为helper做最小共享适配且默认旧路径回归。
- [ ] 真实sidecar+localserver的main/preload委托集成，原AgentView/AgentMessages显示Unicode增量/两轮/失败/取消/重开。native Electron可用时用独立owned进程、独立userData和合成fixture实际页面验收/截图，不触碰现有App；阻碍如实记录，不绕过权限。
- [ ] 全仓Bun/type/lint/Electronbuild，Rust回归适当，独立review通过后提交。

## Task 4：整体验收、兼容矩阵与 Draft 交付

- [ ] 执行真进程两协议/两模型、1/3/5上下文、多会话、重放、取消/拒工具、失败/kill/恢复与默认旧路径回归，收敛首次发现后重跑受影响项。
- [ ] 原UI组件/CSS差异清单与可行原生/模拟证据，区分Electron UI、Tauri MockRuntime、原生Tauri未测。未使用的接口不说已迁完。
- [ ] 更新tracked report，列明actual路径/default路径、尚未迁移功能及M2入口、准确命令/计数/log、凭据与数据保护/回滚；不改README/CLAUDE无关规则。
- [ ] 格式/类型/lint/fullBun/Cargo/Electron构建、敏感diff审查、独立全分支review与simplify；通过后正常fetch+merge最新main，再push安全分支/Draft，核实完整head/CI状态，PR后review回帖收尾。

## 回滚与完成定义

停用opt-in即可回原默认backend；新命名空间保持给新版读取，不以删除它解决回滚。旧用户数据/安装版从未被切换。本轮只有正式UI→Rust实际进程、同coreTauriinvoke及上述恢复/取消都实测，才称M1完成；若nativeGUI不可用则单列未验收，不说完整产品可替换。M2/M3未完时保留Electron/SDK。
