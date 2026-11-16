# Tinker-A M2B 工具与权限闭环实施计划

**当前执行状态（2026-11-16）：** Tasks1–3 已完成并独立通过审查，恢复源码基线 `7e58fe4fd59d25dfaeb502e31fc64e972f10ebe9`。Task4 及集中审查修复源码冻结于 `952698d0168948ebec42c62736acaf04ebc9687d`；最终独立静态审查 CodeReadyForDraft=Yes，Critical/Important/Minor 均0（审查本身未运行测试或GUI）。最终自动检查已完成：fmt、全Rust335 pass、clippy、type/lint/Electron及普通/QA构建均exit0；完整Bun并发上限1为3500 pass / 4既有skip / 0 fail。 新SHA原生验收因系统锁屏且尚无用户解锁回复而待验，不称完整交付。

**当前持久工作树：** `/Users/simmonj/Documents/ChatGPT/Tinker/migration-work/tools-native-acceptance-20261116`，分支 `feat/tauri-tools-native-acceptance`；日志与产物在同级 `tools-native-checks-20261116`。精确结果以[验收报告](2026-11-11-tauri-tool-permissions-validation.md)为准。下文原设计时间、路径、head 与早期任务状态均保留为历史基线，不作为当前执行入口。

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` to implement this plan task-by-task. Root 已选择每任务新的implementer与独立review、单写者串行实施；无需重新询问执行方式或设计许可。每个任务同时遵守下列全局约束和冻结契约。

**历史计划状态（2026-11-15）：** 当时Task1已实现并完成核心测试、待独立审查；Task2–4尚未实现或验收。
**历史设计基线关联：**  独立分支 `feat/tauri-tool-permission-loop`；PR22 已于2026-11-11 06:49:16 UTC合并，main=`e961d92911f7574ce38c1f8b11f402e255ff0250`。本设计源码调查来自PR22 head `873babe59f19e0e30c29db10397eb4365419feb6`；Root已正常fetch/merge上述main，当前HEAD=`2f3c517ab5e3aa5c93d07d81f78d184001039c68`，没有reset/覆盖工作。新工作不再是stacked PR。
**领域语言事实源：** `CONTEXT.md`、本 spec；前置成果 `docs/specs/2026-11-11-tauri-formal-ui.md`。不修改 README.md/CLAUDE.md。
**Goal：** 原 React 工作台内完成 OpenAI SSE 工具调用→真实权限决策→真实合成文件只读执行→tool result 回模型→最终答复/后续上下文/历史恢复。
**Architecture：** 现 RunController 是唯一执行协调器，RunStore 是唯一运行事实源；provider 只负责单轮协议，runner 只持可信合成文件能力。保留现文本 API/文件格式，工具 run 采用明确版本化的追加日志，由原 formal actor 投影到现工具卡和权限横幅。
**Tech Stack：** 现 Rust/std、serde、reqwest、tokio、Tauri、React/Jotai。恢复修复经Root接受，将已锁定缓存的`sha2 =0.10.9`提升为精确直接依赖用于草稿回执摘要；lock仅新增依赖边，无新包/版本/下载，不下载运行时。

## 全局约束与完成边界

- 历史工作目录为 `/private/tmp/tinker-research-cleanup-20261110`；恢复后仅使用上列持久工作树，所有exec显式workdir、shell `/bin/zsh`、login=false。临时旧路径不作为恢复入口；任何 exec-server ENOENT 停止执行并报告。
- 只使用 owned numeric-loopback HTTP mock、假 key、宿主创建的 marker 合成根与合成文件。不得访问真实模型、真实凭据/用户文件、收费、安装或生产切换；不读取 HOME 凭据。Core 保留未来可信 provider 注入能力，本批没有真实服务验收。
- 原 Electron UI 布局/样式、默认入口、生产路径和 M2 所有文本/关闭/恢复行为不变。Lab 和 `DesktopRuntime::open` 默认 tools disabled。工具能力不由 renderer 参数、模型名称或用户 prompt 启用。
- 只支持 OpenAI Chat function tools，每 round 0/1 call，最多4次工具调用/5个 provider rounds；`parallel_tool_calls:false`。Anthropic工具、legacy function_call、多choice/多call、写操作、shell、MCP、真实目录、alwaysAllow 明确 unsupported，runner执行次数0。
- 现 RunStore事件16KiB、事件4096条、log4MiB、input64KiB、output256KiB、context512KiB、HTTP请求4MiB保持。DesktopRuntime MAX_PAGE_BYTES 实际为2MiB；formal history总预算8MiB输入/16MiB投影保持，mock body512KiB保持。所有预算按编码后的完整JSON计算；结果/权限不能绕过字节上限。
- 工具新增：参数UTF-8原文≤2KiB、结果≤4KiB、provider call ID≤64字节且ASCII字母数字/`_`/`-`、工具参数严格对象只含required `path:string`（≤128字节）。未知字段拒绝。结果同时受16KiB编码事件上限；不可为避限截断成不完整JSON或拆散call/result关联。
- 总run wall deadline≤120s，从controller start记时，包含等待权限和所有HTTP rounds；权限deadline=min(now+60s,runDeadline)。每轮HTTP使用remaining总预算和≤15s idle，renderer原130000ms SEND deadline不变。测试可注入更短正时限；不可增大上述上限。
- 用户文案用en/zh i18n、语义颜色；内置工具描述/prompt英文。旧Electron permission API不改签名。代码遵守CLAUDE的类型与文件大小规则；本批不承诺通用文件系统沙箱。
- Task1/2 仅建立并验证核心能力，不能把工具渠道显示给用户。Task3完成所有真实接线后才新增独立 tools preview binary；Task4通过验收前不称完整迁移或交付可下载。

## 决策与协议依据

选 controller 主持工具循环，而非 HTTP provider 内部持有权限/文件/journal，也不新建平行 Agent/UI。这样取消、幂等、恢复与后续上下文共用现核心。

[OpenAI官方function calling文档](https://developers.openai.com/api/docs/guides/function-calling)：stream delta 用index关联，id/type/function.name通常仅首片，arguments累积；结果是 `role:"tool"` + `tool_call_id`。请求工具schema设置 `strict:true`、`additionalProperties:false`、全部属性required，并设置 `parallel_tool_calls:false`。即使请求关闭parallel，响应若多call仍明确拒绝，不能只取第一条。

## 冻结的跨任务接口（Task1定义全部类型；后续任务不得自创同义DTO）

下面签名是目标新增接口，不是现有实现声明。现 `RunProvider::execute/execute_context`、`RunController::start_with_provider/continue_with_provider/read/cancel`、公开v1 DTO必须保留。Rust类型使用显式Serialize/Deserialize派生及camelCase/deny_unknown_fields；tagged enum拒绝未知variant/字段。

```rust
// tool_types.rs；这些类型在 Task1 全部定义，Task2不反向提供Task1依赖。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ToolName { WorkspaceList, WorkspaceRead } // wire: workspace_list/workspace_read
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolArguments { pub path: String }
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderToolCall { pub id: String, pub name: String, pub arguments: String }
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ToolRoundOutput { Stop, ToolCall(ProviderToolCall) }
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolCall {
    pub round: u8, pub call_id: String, pub name: ToolName, pub arguments: ToolArguments,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ToolOutcome { Succeeded, Denied, Expired, Cancelled, Failed, Interrupted }
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolResult { pub call_id: String, pub outcome: ToolOutcome, pub content: String }
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TranscriptMessage {
    User { text: String },
    Assistant { round: u8, text: String, call: Option<ToolCall> },
    Tool { result: ToolResult },
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolContext { pub messages: Vec<TranscriptMessage> }
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolSpec { pub name: ToolName, pub description: String } // path schema固定由codec生成
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PermissionDecision { Granted, Denied, Expired, Cancelled, Interrupted }
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PermissionTicket {
    pub permission_id: String, pub run_id: String, pub call: ToolCall,
    pub workspace_revision: String, pub expires_at_ms: u64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PermissionReply { pub permission_id: String, pub decision: PermissionDecision }
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PermissionReceipt {
    pub permission_id: String, pub decision: PermissionDecision, pub sequence: u64,
}
#[derive(Clone, Debug)]
pub struct ToolRunOptions {
    pub workspace_revision: String, pub permission_timeout: std::time::Duration,
    pub run_timeout: std::time::Duration,
}
// Constructors validate policy revision/positive limits <=60s/120s.
impl ToolRunOptions {
    pub fn new(workspace_revision: String, permission_timeout: std::time::Duration,
               run_timeout: std::time::Duration) -> Result<Self, RunError>;
}
pub trait ToolExecutor: Send + Sync {
    fn workspace_revision(&self) -> &str;
    fn catalog(&self) -> Vec<ToolSpec>;
    fn execute(&self, call: &ToolCall, cancelled: &std::sync::atomic::AtomicBool)
        -> Result<ToolResult, RunError>;
}
// run_provider.rs: default returns ContextUnsupported; no text call path uses this method.
fn execute_tool_round(&self, context: &ToolContext, tools: &[ToolSpec],
    cancelled: &std::sync::atomic::AtomicBool, remaining: std::time::Duration,
    emit: &mut dyn FnMut(&str) -> Result<(), RunError>) -> Result<ToolRoundOutput, RunError>;
// 同RunProvider新增默认Ok；HTTP实现检查result中已知key，controller在journal前调用。
fn validate_tool_result(&self, result: &ToolResult) -> Result<(), RunError>;
```

`ToolContext`公开字段不表示信任调用方：进入provider/序列化前再次validate；IPC永不接受messages数组。ProviderToolCall仅是完整protocol候选；controller解析成严格ToolCall后才能持久化/请求权限。ToolSpec.name映射固定英文wire名称，不允许运行时注册任意工具。

```rust
// tool_journal.rs：在Task1定义并实现；复用RunStore写锁/安全I/O，不建第二个journal。
pub(crate) struct ToolRunHeader {
    pub run_id: String, pub input: String, pub created_order: u64,
    pub parent: Option<crate::run_context::ParentRunRef>,
    pub workspace_revision: String, // header还有固定storageVersion=3/policyVersion=1
}
pub enum ToolRecordKind {
    Started,
    RoundStarted { round: u8 },
    TextDelta { round: u8, text: String },
    RoundFinished { round: u8, call: Option<ToolCall> },
    PermissionRequested { ticket: PermissionTicket },
    PermissionResolved { receipt: PermissionReceipt },
    ToolStarted { call_id: String },
    ToolFinished { result: ToolResult },
    Terminated { status: RunStatus, error_code: Option<String>, closed_call: Option<ToolResult> },
}
pub struct ToolRecord { pub version: u32, pub run_id: String, pub sequence: u64, pub event: ToolRecordKind }
pub struct ToolRunSnapshot {
    pub run_id: String, pub input: String, pub output: String, pub status: RunStatus,
    pub sequence: u64, pub error_code: Option<String>, pub recovery_required: bool,
    pub workspace_revision: String, pub transcript: ToolContext,
    pub pending: Option<PermissionTicket>, pub current_round: Option<u8>,
    pub partial_text: String,
}
pub struct ToolEventPage {
    pub snapshot: ToolRunSnapshot, pub events: Vec<ToolRecord>,
    pub next_after_sequence: u64, pub has_more: bool,
}
// 公共typed core记录；wire由v2门面显式投影，不改变legacy v1。
pub(crate) struct StoredToolRun {
    pub header: ToolRunHeader, pub snapshot: ToolRunSnapshot,
    pub events: Vec<ToolRecord>, pub log_bytes: usize,
}
impl RunStore {
    pub(crate) fn create_tool_run(&self, header: ToolRunHeader) -> Result<StoredToolRun, RunError>;
    pub(crate) fn load_tool_run(&self, id: &str) -> Result<StoredToolRun, RunError>;
    pub(crate) fn append_tool_record(&self, run: &mut StoredToolRun, event: ToolRecordKind) -> Result<(), RunError>;
    pub(crate) fn tool_context_for(&self, parent: Option<&ParentRunRef>, child_order: u64, input: &str) -> Result<ToolContext, RunError>;
}
// Task2实现，Task1不添加未实现的controller方法；Task1默认trait方法编译且测试。
impl RunController {
    pub fn open_with_tools(root: impl AsRef<std::path::Path>) -> Result<Self, RunError>;
    pub(crate) fn from_store_with_tools(store: RunStore) -> Result<Self, RunError>;
    pub fn start_tools(&self, request_id: String, parent_run_id: Option<String>, input: String,
        provider: Arc<dyn RunProvider>, executor: Arc<dyn ToolExecutor>, options: ToolRunOptions)
        -> Result<ToolRunSnapshot, RunError>;
    pub fn read_tools(&self, run_id: &str, after_sequence: u64, limit: usize) -> Result<ToolEventPage, RunError>;
    pub fn respond_permission(&self, run_id: &str, reply: PermissionReply) -> Result<PermissionReceipt, RunError>;
    pub fn cancel_tools(&self, run_id: &str) -> Result<ToolRunSnapshot, RunError>;
}
```

可见性：`ToolRecord`、`ToolRecordKind` 与 `ToolEventPage` 为pub；header/StoredToolRun/store方法保持crate私有。这里只公开 typed core，legacy v1 JSON没有新增字段。RunError新增固定码：toolUnsupported、toolArguments、toolLimit、permissionNotFound、permissionConflict、permissionExpired、runTimeout、toolFailed；仍不传任意网络/系统错误文本。

### 存储/状态/取消的不可变规则

1. v1与context-v2继续原严格schema与写法；新增私有 `runs-v1/tools-v3/`。header version3、record version1分别校验，不复用旧PROTOCOL_VERSION含义。旧方法遇工具run明确UnsupportedVersion。全局枚举必须包含三种layout，重复runID跨layout拒绝、created_order全局单调，兼容既有v1/v2历史跨layout同order记录，继续按order/layout稳定排序；所有layout新建均为全局max+1，v3与任何layout同order拒绝。不能用“旧ids只看旧目录”绕开预检。Task1默认disabled的RunController::open/from_store遇tools run须UnsupportedVersion且不恢复/执行；Task2增加工具aware开库供Task3 open_with_tools调用，必须保持全局预检全部通过后才恢复。对现v1/v2无文件重写。
2. tools-v3只在显式tools创建时初始化并sync父目录；打开纯text库不得自动新增该目录。目录存在时，启动预检必须读全工具日志/绑定关系，未预检完成不得追加恢复事件。新目录/文件使用既有symlink/hardlink拒绝和0600/0700策略。
3. 状态：Queued→Started/Running；RoundStarted(round从0递增)→TextDelta*→RoundFinished。call=None意味着模型已Stop，下一事件只可Completed；call=Some必须唯一provider callId，然后PermissionRequested将run变WaitingInput。Granted→Running→ToolStarted→ToolFinished；Denied/Expired→Running→对应error ToolFinished（禁止ToolStarted）→下一RoundStarted。最多4次call，第5个模型round只能Stop。
4. Terminated只接受Completed/Failed/Cancelled/Interrupted。Completed需要最后模型Stop、没有pending/unclosed call；Cancelled/Failed/Interrupted用一条Terminated事件原子关闭pending/granted/started call，closed_call必须身份匹配、outcome匹配，不伪造成功。终态后任何delta/decision/result拒绝。
5. reducer校验receipt.sequence等于当前record.sequence，ticket.runId/call/工作区revision等于header/current call；permissionId=`p-{runId}-{round}`（≤80字节单独validator），UI toolUseId=`{runId}-tool-{round}`。原始provider callId用于HTTP工具关联。相同run内禁止复用provider callId；UI跨run ID不冲突。
6. 先append+sync_data再更新内存/发布UI/允许执行。每条非终态事件预留2个MAX_EVENT_BYTES和2个event槽用于ToolFinished/Terminated；写失败立即blocked/token cancelled/recovery_required，不能继续网络或runner。snapshot只是缓存。
7. Context从Completed祖先的完整transcript构造；旧text祖先转换成User+Assistant，工具祖先保留assistant.call→tool.result邻接。每个Assistant只收该round的partial_text，不能复制累计snapshot.output；tool_call前的intermediate text可见但只在transcript出现一次，round commit后清空partial_text。不把工具结果压成assistant文本。累计所有text/args/result和metadata进入context预算，保持16祖先上限与严格父sequence/order/cycle校验；tool_context_for显式接收待建child_order，父order必须严格小于它，不用u64::MAX代替已分配子order。legacy text续接工具祖先明确ContextUnsupported，在DesktopRuntime写新Bind前拒绝。
8. 只接受外部Granted/Denied；Expired/Cancelled/Interrupted由核心产生。response查run+permission精确归属、pending、deadline、状态。相同已提交decision重试返回原receipt；相反decision冲突；过期/已取消后grant永不唤醒执行。校验deadline用Instant；持久expires_at_ms仅给显示/审计，不以系统时钟回拨延长等待。
9. grant仅写receipt并唤醒，不等于执行。worker再次在生命周期锁验证并写ToolStarted；对本批≤4KiB owned regular-file读取，实际runner进入和有界读取/结果commit在同一短临界段，不留“释放锁后排队执行”窗口。cancel ack线性化在同锁提交：先提交cancel则执行0，已经进入工具则cancel等待该短段后ack，不能宣称撤销已读内容。不得将此锁策略扩为长时shell/network工具。
10. waiting用Condvar或短tick，不持有DesktopRuntime/actor锁；close/delete/Stop同样可取消pending。启动把所有nonterminal tools标Interrupted并关闭未完成call；不重跑runner、不发HTTP、不恢复权限等待。页面reload则保留worker，并重建现pending。重复SEND返回原事实，不重新启动。

## Task 1：canonical transcript、durable v3状态与兼容适配

**独立交付：** 新工具日志可创建/追加/严格读取/恢复投影/构造跨版本上下文；旧text测试不变。工具入口仍不启用，无真实HTTP/runner依赖。

**Files：** 新建 `apps/tinker-rust/src-tauri/src/tool_types.rs`、`tool_journal.rs`、`tool_context.rs`、`tool_journal_tests.rs`；修改同目录 `lib.rs`（导出）、`run_provider.rs`（默认tool round方法）、`run_store.rs`（同锁v3 I/O/全局预检）、`run_store_header.rs`（只增加v3分发，不放松旧header）、`run_types.rs`（错误码）。必要的状态纯函数仍用 `session_lifecycle.rs`，不得改已有文本迁移结果。

**Consumes：** 现RunStore安全I/O/单writer锁、ParentRunRef、RunStatus、RunError；不依赖Task2任何类型。
**Produces：** 上述所有tool_types/journal/context类型和RunStore方法；RunProvider默认execute_tool_round→ContextUnsupported、validate_tool_result→Ok。Task2直接消费，无重复DTO。

- [x] 写 `tool_journal_tests` 行为：两轮list/read与结果后Stop→Completed；保存/reopen后transcript完全相等；旧v1/v2字节fixtures仍严格读；legacy parent→tool child→tool grandchild关联正确；同round先text再call、两个round累计output只在各自transcript出现一次；tool parent不能喂legacy context。
- [x] 先运行 `cargo test --offline --manifest-path apps/tinker-rust/src-tauri/Cargo.toml tool_journal -- --test-threads=1`，预期新类型/方法未定义而失败，记录真实失败，不写预计结果当实测。
- [x] 实现冻结类型/strict wire、pure reducer、v3单锁I/O、全局预检及context转换。用以下输入/预期写table tests，不仅复制实现：`grant→deny`冲突、重复ToolStarted拒绝、wrong call结果拒绝、call未闭合Completed拒绝、terminal后delta拒绝、跨layout同ID拒绝、父sequence/order/cycle拒绝、513KiB context拒绝、截断最后行标recovery_required、完整非法行CorruptLog、sync失败不更新snapshot。
- [x] 写恢复测试：pending/granted/started三个snapshot经Interrupted closure均无pending，历史保留已提交text/call/result，未提交结果只显示interrupted。Task1不运行执行器，不能把“无自动重放”当端到端已证明。
- [x] 再运行上条targeted命令；运行 `cargo test --offline --manifest-path apps/tinker-rust/src-tauri/Cargo.toml -- --test-threads=1` 与 `cargo fmt --manifest-path apps/tinker-rust/src-tauri/Cargo.toml -- --check`。预期全部通过且旧text契约未改；记录测试数/exit code。
- [x] 自审新增v3是否影响纯text开库/目录；更新progress实际结果，交Root独立审查。该任务不注册新UI渠道、binary或tool runtime capability。由Root决定提交，实施者不自行推进下一任务。

**历史计划状态（2026-11-15）：** 当时Task1已实现并完成核心测试、待独立审查；Task2–4尚未实现或验收。

## Task 2：实际HTTP rounds、权限控制器与合成文件执行

**独立交付：** 通过RunController公共方法和owned HTTP服务证明真实grant/deny/expired/cancel→runner→tool result→模型最终答复；没有formal UI暴露。

**Files：** 新建 `apps/tinker-rust/src-tauri/src/tool_execution.rs`（controller协作helper）、`synthetic_workspace.rs`、`chat_http/tool_openai.rs`；修改 `run_controller.rs`、`chat_http.rs`、`chat_http/sse.rs`（复用分帧）、`run_provider.rs`（HTTP实现）、`lib.rs`；新建 `tests/tool_http.rs`、`tests/tool_execution.rs`、`tests/synthetic_workspace.rs`。旧 `chat_http/openai.rs`/Anthropic纯text解析行为保持；仅抽公共分帧，不放松旧unsupported断言。

**历史计划状态（2026-11-15）：** 当时Task1已实现并完成核心测试、待独立审查；Task2–4尚未实现或验收。
**Produces：** 冻结的RunController工具开库/四执行读取方法；`ChatHttpProvider::execute_tool_round`；`SyntheticWorkspace::create(root: &TrustedRoot) -> Result<Self, RunError>`，实现ToolExecutor。该构造只在trusted host/tests调用。

- [ ] 写public-controller测试先失败：owned HTTP首轮要求list，未grant时runner计数0且无第二HTTP；grant后计数1，HTTP第二请求含exact assistant.tool_calls + role:tool/tool_call_id；第二轮read同样等待；最终只有mock验证真实文件内容后才回最终marker。旧execute/execute_context仍跑原text golden path。
- [ ] 运行 `cargo test --offline --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --test tool_http --test tool_execution --test synthetic_workspace -- --test-threads=1`，记录预期缺方法失败。
- [ ] 实现HTTP单round：累积index=0的id/name/arguments；允许首片元数据、后续arguments片段，不允许中途换id/name/type、未知delta、第二index。必须完整JSON+finish_reason tool_calls并完成SSE后返回ToolCall；[DONE]提前或断流runner0。纯Stop的工具round也须显式stop；旧纯text codec保持原结束兼容。
- [ ] 请求只发两个固定strict schemas；context serializer逐条输出user/assistant/tool，绝不改写call ID。验证UTF-8/escaped args、同帧text+call、id仅首片、结束后delta、重复finish、多choice、多call、空callId、args>2KiB、未知tool/字段、incomplete JSON。所有协议拒绝不得提前PermissionRequested。
- [ ] SecretGuard覆盖text及完整call id/name/args/result，在任何journal/UI提交前拒绝已知fake key泄漏；HTTP实现validate_tool_result，controller执行后先调用该方法再append ToolFinished，拒绝时只写固定码toolFailed关闭call；不要先发布敏感参数再报错。测试跨arguments片段key泄漏、malicious executor result含key不落盘/UI、provider错误body不落盘、fake bearer不进mock metadata。
- [ ] controller current改为内部Text/Tools互斥active enum，仍同RunStore/worker/锁；不建两个可同时执行的current。实现deadline/condvar/receipt幂等/terminal closure；legacy cancel/drop也须取消并join工具worker。进入每轮HTTP前传remaining并在provider内部min(config.total,remaining)，权限等待不占HTTPfuture。
- [ ] SyntheticWorkspace在fresh私有子目录创建固定 `notes/intro.txt`、`notes/steps.txt`（英文UTF-8含Unicode fixture），create_new写入并保留打开句柄/固定manifest/revision；工具list只列manifest，read按精确虚拟key找到句柄并有界读取：unix FileExt::read_at或Mutex保护seek(0)+read，不能把try_clone共享offset当独立游标；重复/并发read必须返回完整相同内容。执行时比较读到字节与宿主fixture预期，外部篡改返回toolFailed，禁止把任意新内容当合成结果。路径不传std::fs::read/open；拒绝..、absolute、NUL、未知key/字段。重启新建fresh fixture，不重开外来文件；不删除已有fixture目录。
- [ ] 添加执行计数断言：deny/expired/cancel-before-start/wrong-run/stale permission/unsupported/malformed/write或sync失败=0，duplicategrant=1；race barrier分别覆盖cancel先赢和ToolStarted先赢，cancel ack后无新增进入；read后result commit前崩溃恢复计数增量0；stop后HTTP请求增量0；总预算到期关闭pending且最终runTimeout。
- [ ] 再跑targeted命令及全部Rust测试/fmt/clippy：`cargo clippy --offline --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --all-targets -- -D warnings`。预期通过；HTTP证据必须捕获工具关联及实际fixture内容，不能只看runner mock计数。记录/交Root审查，不启用UI。

## Task 3：DesktopRuntime、formal actor与原React真实接线

**独立交付：** 新tools preview宿主的原输入框能走实际工具闭环；原M2宿主/文本Lab/生产Electron行为保持。

**Files：** 修改 `apps/tinker-rust/src-tauri/src/desktop_runtime/{mod,profile,protocol,execution,session,store}.rs`、`formal_agent/{channels,actor,projection,delivery,protocol}.rs`、`formal_host.rs`、`formal_platform/launch.rs`、`formal_launch.rs`；新增 `formal_mock/tools.rs`，由 `formal_mock/mod.rs`显式工具构造启用；修改 `apps/electron/src/tauri-formal/{protocol,transport}.ts`、`apps/electron/src/renderer/hooks/useGlobalAgentListeners.ts`、`packages/shared/src/types/agent.ts`（仅新增snapshot事件）及相关en/zh locale；新建/扩展 `tests/tool_desktop.rs`、`tests/tool_formal.rs`、`apps/electron/src/tauri-formal/tools.test.ts`。保留preload `respondPermission`、PermissionBanner、原工具组件签名和视觉。

**历史计划状态（2026-11-15）：** 当时Task1已实现并完成核心测试、待独立审查；Task2–4尚未实现或验收。
**Produces（冻结）：**

```rust
pub struct TrustedToolBinding {
    pub profile_id: String, pub executor: Arc<dyn ToolExecutor>, pub options: ToolRunOptions,
}
impl DesktopRuntime {
    pub fn open_with_tools(root: impl AsRef<Path>, profiles: Vec<TrustedProfile>,
        bindings: Vec<TrustedToolBinding>) -> Result<Self>; // open()等价bindings为空
}
impl FormalHost {
    pub fn open_tools(root: &TrustedRoot, environment: HostEnvironment) -> Result<Self>;
}
```

绑定只在可信宿主创建；验证profile存在/OpenaiChat/revision一致，公开profiles.list不含executor/options/key/endpoint。模型目录普通字符串，工具能力不得藏进renderer配置。旧TrustedProfile序列化schema保持。

固定core method：`sessions.historyV2`参数同History；`chat.eventsV2`参数同Events；`chat.permissionRespond`参数 `{sessionId,runId,permissionId,behavior:"allow"|"deny",alwaysAllow:false}`；`chat.pendingPermissions`参数 `{sessionId: string|null}`。返回分别是原turn/page外加 `toolState: ToolRunSnapshot|null`（eventsV2包含typed event）、PermissionReceipt、`{permissions: PermissionTicket[]}`。全部严格DTO/上限；history/events V2返回text turn时toolState=null；v1不接受tools run。不可给renderer任意core dispatch入口。

原渠道 `agent:permission:respond`仍仅收PermissionResponse，actor用pending registry精确解析session/run，不猜当前会话；同generation校验与CloseGate拒绝先于grant。`agent:get-pending-requests`返回原 `{permissions,askUsers:[],exitPlans:[]}` 形状；PermissionRequest投影用file ToolPreview/canAlwaysAllow=false，不能把rawargs/绝对路径发给renderer。

新增共享stream事件是唯一新增恢复契约：

```ts
interface ToolRunSnapshotEvent {
  type: 'tool_run_snapshot'
  sdkMessages: SDKMessage[] // 此run已提交消息，稳定uuid
  activeText: string       // 当前未commit round的partial_text
  pendingPermissions: PermissionRequest[]
}
```

事件仍在原AgentStreamEvent envelope内，sessionId/requestId/startedAt/generation/deliverySequence不变。`ActiveRun.currentSnapshot`可包含此事件；RestoreBundle.sdkMessages必须含已提交工具历史，activeSnapshot仍携带此完整snapshot。handler仅替换对应run的SDK messages/活动text/toolActivities/pending，不能清空其他run或会话；无变化snapshot不可重复发通知。旧text_snapshot行为不变。

- [ ] 公共DesktopRuntime测试先失败：tools binding可SEND、v2读工具状态、respond allow/deny真正驱动HTTP；同SEND重试不重跑；text默认无tool schemas；切text profile续接工具parent在Bind前ContextUnsupported；删除session/close取消pending。检查绑定journal+v3 cross-validation、先全局预检后恢复。
- [ ] 运行 `cargo test --offline --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --test tool_desktop --test tool_formal -- --test-threads=1` 和 `bun test apps/electron/src/tauri-formal/tools.test.ts`，记录失败。
- [ ] 实现runtime工具绑定及v2读/权限门面；页预算覆盖完整toolState，单页不能容纳返回固定pageLimit，不静默漏events。配置revision将工具策略加入逻辑revision，随机mock端口不参与request幂等。
- [ ] formal `projection::active`加入waitingInput；history把所有assistant.tool_use/user.tool_result/final text按顺序投影，uuid稳定，toolUseId为scoped ID而HTTP保持provider ID。SDKMessageRenderer/ExecutionStepGroup/ContentBlock继续原展示。原send长promise仅terminal结算。
- [ ] delivery新增typed事件投影：完整round commit发SDK message、结果发SDK user、permission发asci_event；背压则下一次发完整tool_run_snapshot后推进cursor，绝不能text_snapshot后跳过工具事件。终态发送计划支持全部未发SDK消息，按阶段/索引重试，重复入队不制造重复history；restore barrier取同一次snapshot的cursor和pending。
- [ ] 原hook permission_request按session+permissionId去重；permission_resolved出队；tool_run_snapshot原子按run替换状态，terminal/timeout清理pending。PermissionBanner现ack后出队/Esc stop可复用，拒绝响应错误要有现有i18n错误反馈；不新增toy按钮。shared新增事件与en/zh文案key同步。
- [ ] owned tool mock只在 `OwnedMock::start_tools()`启用；首prompt发list，确切result后发read，读取fixture预期后发final，follow-up验证前一完整call/result历史；拒绝/expired结果走真实解释终态。添加明确标注合成的独立profile（`local-tools-mock`、逻辑revision `local-tools-protocol-v1`），不能让原mock自由输出工具。
- [ ] 新建 `src/bin/tinker-tools-preview.rs`、`tauri.tools.conf.json`，identifier=`com.tinker.tools-preview`，仅此入口调 `formal_launch::run_tools(context, expected_identifier, probe)`→FormalHost::open_tools。原run函数与M2 binary不变；工具根marker kind独立、appData内`synthetic-tools-v1`、临时前缀`tinker-tauri-tools-preview-`，不能open旧M2根。新root验证在任何写入/建窗口前完成。共用原formal renderer/CSP，不加任意IPC/eval/网络能力。
- [ ] 检验>256事件背压、未读权限请求/解决、reload pending、错误generation/旧run、restore超时恢复、重复snapshot、迟到grant、closePreparing/closeReady、权限等待中删除session；断言runner0或1和hook无重复卡。再跑targeted、`bun run typecheck`、`bun test apps/electron/src/tauri-formal apps/electron/src/renderer/components/agent/PermissionBanner.test.tsx apps/electron/src/renderer/locales/key-parity.test.ts`、全部Rust测试。记录实际结果交Root审查。

## Task 4：owned native QA、构建与完整交付守门

**独立交付：** 可运行独立tools preview包与可追溯原生UI证据；明确实际通过/未运行，不把mock等同真实模型。

**Files：** 新建 `apps/tinker-rust/scripts/build-tools.ts`、`build-tools-native-qa.ts`、`src-tauri/src/bin/tinker-tools-native-qa.rs`、`src-tauri/tauri.tools-qa.conf.json`；按需扩展 `formal_native_qa.rs`/support的本地records（不增rendererIPC）、已有packaging helper；报告 `docs/specs/2026-11-11-tauri-tool-permissions-validation.md`。现build-formal/build-native-qa默认仍构建M2。普通tools preview禁止QA probe；QA identifier=`com.tinker.tools-native-qa`，开启现formal-native-qa feature，使用现native-qa-dist。

**Consumes：** Task3完整 `FormalHost::open_tools`、run_tools与原React渲染；现owned WKWebView QA本地command协议。
**Produces：** `bun apps/tinker-rust/scripts/build-tools.ts`（先原formal renderer再explicit TAURI_CONFIG direct cargo，组装独立.app）、`bun apps/tinker-rust/scripts/build-tools-native-qa.ts`（QA renderer+QA binary）；report写源SHA、命令/exitcode、应用路径/哈希/签名事实、截图与HTTP/journal关联。

- [ ] 增构建配置guard tests：M2/tools/QA identifier混用必须创建窗口/数据前失败，普通tools all-features也没有probe。脚本只删自己固定命名构建产物、不碰用户/旧包；TAURI_CONFIG显式传入，检查入口符号与bundle identifier。
- [ ] 完成唯一合成工作流：原编辑器输入→Send→list权限横幅→allow→工具详情真实list→read权限横幅→allow→结果文本→最终reply。另建会话覆盖deny、权限超时、Esc、Stop、关闭窗口/菜单Quit。用真实DOM控件并说明不是系统鼠标自动化，禁止直接调用atom/runner冒充交互。
- [ ] 证据root固定 `/private/tmp/tinker-tauri-checks-m3-tools-20261111/native-qa/<batch>`（0700）；会话数据放独立可信tools临时根。用现 `native-qa-command.py`驱动owned WKWebView；截图、journal、HTTP request metadata及runner调用记录相互核对。HTTP metadata只记录合成内容与关联，不含Authorization。
- [ ] reload在pending/已grant/结果已提交三个点验证snapshot对账；进程重启在pending/started/结果后三个点验证Interrupted不重放；已完成会话重开+follow-up带全部call/result。故障注入测试可证明崩溃边界，报告明确哪些是真实进程重启、哪些是单元故障注入。
- [ ] 验证双语言/主题、模型/effort纯text兼容、窗口关闭最后debounce、权限response与close竞态、>256delivery背压、错误generation旧事件；运行既有M2回归以证明新路径不取代旧路径。
- [ ] 按顺序执行并保存日志：`cargo fmt --manifest-path apps/tinker-rust/src-tauri/Cargo.toml -- --check`；`cargo test --offline --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --all-features -- --test-threads=1`；`cargo clippy --offline --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --all-features --all-targets -- -D warnings`；`bun run typecheck`；`bun test`；`bun run lint`；`bun run electron:build`；`bun apps/tinker-rust/scripts/build-tools.ts`；`bun apps/tinker-rust/scripts/build-tools-native-qa.ts`。预期exit0；若现环境或已知基线阻塞，保留实际失败并由Root评估，不改无关生产源码掩盖。
- [ ] 独立review/simplify检查：grant≠execute、cancel后无late启动、恢复无副作用重放、typed上下文关联、所有预算/secret guard、原路径diff、permission超时卡片消失。报告逐项通过/未运行；未过UI不得称可下载完成。
- [ ] Root核验最新main后按仓库PR流程提交/推送独立Draft PR；不得merge/auto-merge/安装。本计划编写阶段不执行这些操作。

## 验收清单与回滚

必须证据：deny/expired/cancel-before-start/wrong-run/stale-generation/unknown-tool/bad-args/storage-failure全部runner count=0；重复grant最多1；每个重启恢复runner与HTTP新增次数0；allow后HTTP真实收到对应tool result才给最终答案；follow-up完整保留工具关联；原权限卡与工具卡可操作且无重复/幽灵pending。

回滚：退出新tools app，继续原M2/Electron；原目录从未迁入，新v3数据只由新tools app使用。不要用旧binary打开新profile；保留合成数据，清理另行授权。可按任务revert源码，不改生产默认。交付只称“OpenAI兼容协议、owned mock与合成只读工具的原UI闭环”，不称真实模型/任意工具/全产品完成。

### Task2 实现接口补充（2026-11-15）

`RunProvider` 增加向后兼容默认方法
`validate_tool_context(&self, context: &ToolContext, tools: &[ToolSpec]) -> Result<(), RunError>`，
默认 `Ok(())`。controller 在创建 v3 header 前调用，HTTP 实现检查协议、catalog、完整上下文
及已知 key（含新 input）；不公开 key getter。工具 call 的 raw 参数和严格 JSON 解码后的 path
在 HTTP round 返回之前检查，结果通过既定 `validate_tool_result` 检查后才提交 journal。
现有 text API 不调用此 seam。合成工作区仅保留新建 fixture 的文件句柄；实际读取用
Mutex 保护 seek/read，读后与编译期 fixture 字节比较，虚拟 path 从不成为 open 参数。
工具 API 仅由显式 `RunController::open_with_tools` 启用；默认 Lab、Electron、DesktopRuntime 不变。

Task2 审查修复新增默认纯校验 seam：
`validate_tool_output(&self, output: &str) -> Result<(), RunError>` 默认 Ok。
工具 worker 在每个 TextDelta 写入前校验累计候选 output，HTTP 实现沿用私有已知
key 检查，防止跨 round 拼接泄漏；锁内捕获校验 panic。旧文本 API 不调用此 seam。
同步持久化不能被硬实时中断；成功返回后重新检查绝对 deadline，防止已耗尽
预算后进入执行器、下一轮网络或接受 Completed。工具启动在任何恢复追加前
拒绝任一布局的 recovery_required 日志；只读检查仍可返回该标志。
