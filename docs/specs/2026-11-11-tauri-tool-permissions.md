<a id="tinker-a-m2b-工具与权限闭环实施计划"></a>

# Tinker-A M2B Tool and Permission Loop Implementation Plan

**Current execution status (2026-11-16):** Tasks1–3 complete and independently reviewed, baseline `7e58fe4fd59d25dfaeb502e31fc64e972f10ebe9`. Task4 final code freeze `68455c9aee34bd0fda153101addfe4150d960fee`; independent supplementary review CodeReadyApproved, Critical/Important/Minor all 0 (static review ran no tests/GUI). 952698d full Rust335 pass, full Bun3500 pass/4 existing skip/0fail; fmt/clippy/type/lint/Electron/both packages exit0. 684 formal-workspace fallback-only change reran27 affected tests/type/lint/Electron/both packages exit0. After normal user unlock, actual final684 native golden/settings visuals/313.143ms input→original NSMenu Quit/latest-active-session and Unicode-newline draft reopen/zero automatic HTTP verified. Candidate archive/signature audits complete, not pushed/PR-published/installed; see report for exact rerun scope and unexecuted boundaries, without claiming general migration complete.

**Current persistent worktree:** `/Users/simmonj/Documents/ChatGPT/Tinker/migration-work/tools-native-acceptance-20261116`, branch `feat/tauri-tools-native-acceptance`; logs/artifacts in sibling `tools-native-checks-20261116`. Exact results follow the [acceptance report](2026-11-11-tauri-tool-permissions-validation.md). Original design times/paths/heads/early task states below remain historical baselines, not current execution entry points.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` to implement this plan task-by-task. Root chose a fresh implementer and independent review per task, serial single-writer execution; no need to reask execution method or design approval. Every task also follows the global constraints and frozen contracts below.

**Historical plan status (2026-11-15):** Task1 implemented/core-tested, awaiting independent review; Tasks2–4 not yet implemented or accepted.
**Historical design baseline:** separate branch `feat/tauri-tool-permission-loop`; PR22 merged2026-11-11 06:49:16 UTC, main=`e961d92911f7574ce38c1f8b11f402e255ff0250`. Source investigation used PR22 head `873babe59f19e0e30c29db10397eb4365419feb6`; Root normally fetched/merged that main, current HEAD=`2f3c517ab5e3aa5c93d07d81f78d184001039c68`, without reset/overwrite. New work is no longer a stacked PR.
**Domain language source of truth:** `CONTEXT.md`, this spec; prerequisite `docs/specs/2026-11-11-tauri-formal-ui.md`. Do not modify README.md/CLAUDE.md.
**Goal:** complete OpenAI SSE tool call→real permission decision→real synthetic-file read-only execution→tool result to model→final reply/follow-up context/history recovery in the original React workbench.
**Architecture:** existing RunController is sole execution coordinator and RunStore sole runtime source of truth; provider handles one protocol round, runner holds only trusted synthetic-file capability. Preserve text APIs/formats; tool runs use explicitly versioned append logs projected by the original formal actor into existing tool cards/permission banners.
**Tech Stack:** existing Rust/std, serde, reqwest, tokio, Tauri, React/Jotai. Root accepted promoting cached locked `sha2 =0.10.9` to exact direct dependency for draft receipt digests; lock adds only a dependency edge, no packages/versions/downloads or runtime downloads.

<a id="全局约束与完成边界"></a>

## Global Constraints and Completion Boundaries

- Historical working directory `/private/tmp/tinker-research-cleanup-20261110`; after recovery use only the persistent worktree above, explicit workdir for every exec, shell `/bin/zsh`, login=false. Old temporary path is not a recovery entry; stop/report any exec-server ENOENT.
- Use only owned numeric-loopback HTTP mocks, fake keys, host-created marker synthetic roots/files. No real models/credentials/user files/spending/installation/production switch; no HOME credential reads. Core retains future trusted-provider injection; no real-service acceptance this batch.
- Original Electron UI layout/styles, defaults, production paths, and all M2 text/close/recovery behavior unchanged. Lab and `DesktopRuntime::open` default tools disabled. Renderer parameters, model names, or user prompts do not enable tools.
- OpenAI Chat function tools only,0/1 call per round,max 4 calls/5 provider rounds; `parallel_tool_calls:false`. Anthropic tools, legacy function_call, multiple choices/calls, writes, shell, MCP, real directories, alwaysAllow explicitly unsupported, runner count 0.
- Preserve RunStore event16KiB/count 4096/log4MiB/input 64KiB/output 256KiB/context512KiB/HTTP request4MiB. DesktopRuntime MAX_PAGE_BYTES actually2MiB; formal history8MiB input/16MiB projection and mock body512KiB remain. All budgets measure full encoded JSON; results/permissions cannot bypass byte caps.
- New tool limits: raw UTF-8 arguments≤2KiB, result≤4KiB, provider call ID≤64 bytes ASCII alphanumerics/`_`/`-`; strict argument object contains only required `path:string` (≤128 bytes). Reject unknown fields. Results also obey16KiB encoded-event cap; do not truncate JSON or break call/result links to evade limits.
- Total run wall deadline≤120s from controller start, including permission waits/all HTTP rounds; permission deadline=min(now+60s,runDeadline). Each HTTP round gets remaining total budget and≤15s idle; renderer130000ms SEND deadline unchanged. Tests may inject shorter positive limits, never increase maxima.
- User copy uses en/zh i18n and semantic colors; builtin tool descriptions/prompts English. Old Electron permission API signatures unchanged. Follow CLAUDE typing/file-size rules; no general filesystem-sandbox promise.
- Tasks1/2 only build/validate core capabilities, without user-visible tool channels. Add separate tools preview binary only after Task3 real wiring; no complete migration/download delivery claim before Task4 acceptance.

<a id="决策与协议依据"></a>

## Decision and Protocol Basis

Controller owns the tool loop, rather than HTTP provider owning permissions/files/journal or a parallel Agent/UI. Cancellation/idempotency/recovery/follow-up context share existing core.

[Official OpenAI function-calling documentation](https://developers.openai.com/api/docs/guides/function-calling): stream deltas correlate by index; id/type/function.name usually appear only initially, arguments accumulate; results use `role:"tool"` + `tool_call_id`. Request schemas set `strict:true`, `additionalProperties:false`, all properties required, and `parallel_tool_calls:false`. Even when parallel is disabled, explicitly reject multiple response calls rather than taking only the first.

<a id="冻结的跨任务接口task1定义全部类型后续任务不得自创同义dto"></a>

## Frozen Cross-Task Interfaces (Task1 Defines All Types; No Synonymous DTOs)

Signatures below are target additions, not claims of existing implementation. Retain `RunProvider::execute/execute_context`, `RunController::start_with_provider/continue_with_provider/read/cancel`, and public v1 DTOs. Rust types explicitly derive Serialize/Deserialize with camelCase/deny_unknown_fields; tagged enums reject unknown variants/fields.

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

Public `ToolContext` fields do not imply caller trust: revalidate before provider/serialization; IPC never accepts message arrays. ProviderToolCall is only a complete protocol candidate; controller must parse strict ToolCall before persistence/permission requests. ToolSpec.name maps to fixed English wire names; no arbitrary runtime registration.

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

Visibility: `ToolRecord`, `ToolRecordKind`, `ToolEventPage` pub; header/StoredToolRun/store methods crate-private. Only typed core is public; legacy v1 JSON adds no fields. New fixed RunError codes: toolUnsupported, toolArguments, toolLimit, permissionNotFound, permissionConflict, permissionExpired, runTimeout, toolFailed; arbitrary network/system error text remains excluded.

<a id="存储状态取消的不可变规则"></a>

### Immutable Storage/State/Cancellation Rules

1. v1/context-v2 retain strict schemas/writes; add private `runs-v1/tools-v3/`. Validate header version 3/record version 1 separately, without reusing old PROTOCOL_VERSION meaning. Old methods reject tool runs with UnsupportedVersion. Global enumeration covers all three layouts, rejects cross-layout duplicate runIDs, globally monotonic created_order, supports existing v1/v2 same-order history with stable order/layout sorting; every new layout record uses global max+1, and v3 same-order collision with any layout fails. No preflight bypass by checking old IDs only in old directories. Task1 default-disabled RunController::open/from_store returns UnsupportedVersion for tool runs without recovery/execution; Task2 adds tool-aware opening for Task3 open_with_tools, recovering only after all global checks. No v1/v2 file rewrites.
2. Initialize tools-v3 and sync parent directory only on explicit tool creation; opening text-only storage must not add it. If present, startup preflight reads all tool logs/bindings before appending recovery events. New directories/files retain symlink/hardlink rejection and 0600/0700 policy.
3. States: Queued→Started/Running; RoundStarted(round from 0)→TextDelta*→RoundFinished. call=None means model Stop, next event only Completed; call=Some requires unique provider callId, then PermissionRequested→WaitingInput. Granted→Running→ToolStarted→ToolFinished; Denied/Expired→Running→corresponding error ToolFinished (no ToolStarted)→next RoundStarted. Maximum 4 calls; fifth model round only Stop.
4. Terminated accepts only Completed/Failed/Cancelled/Interrupted. Completed requires final model Stop and no pending/unclosed call. Cancelled/Failed/Interrupted atomically closes pending/granted/started calls in one Terminated event; closed_call identity/outcome must match, without fabricated success. Reject any delta/decision/result after terminal state.
5. Reducer verifies receipt.sequence=current record.sequence and ticket.runId/call/workspace revision=header/current call; permissionId=`p-{runId}-{round}` (≤80 bytes, separate validator), UI toolUseId=`{runId}-tool-{round}`. Original provider callId correlates HTTP tools. No provider callId reuse within a run; UI IDs unique across runs.
6. append+sync_data before memory/UI/execution. Reserve2 MAX_EVENT_BYTES and 2 event slots after each nonterminal event for ToolFinished/Terminated; write failure immediately blocked/token cancelled/recovery_required, no further network/runner. Snapshot is cache only.
7. Build Context from complete Completed-ancestor transcripts; old text ancestors become User+Assistant, tool ancestors retain assistant.call→tool.result adjacency. Each Assistant contains only that round's partial_text, never cumulative snapshot.output; pre-call intermediate text remains visible but appears once in transcript, cleared after round commit. Never flatten tool results into assistant text. All text/args/results/metadata count toward context budget; preserve16-ancestor cap and strict parent sequence/order/cycle checks. tool_context_for explicitly receives proposed child_order, parent strictly earlier; no u64::MAX substitute. Legacy text continuation of tool ancestry returns ContextUnsupported before new DesktopRuntime Bind.
8. External decisions only Granted/Denied; core produces Expired/Cancelled/Interrupted. Response verifies exact run+permission ownership, pending/deadline/state. Same committed decision retry returns original receipt; opposite conflicts; grant after expiry/cancel never wakes execution. Instant validates deadlines; persisted expires_at_ms is display/audit only, never extended by clock rollback.
9. Grant writes receipt/wakes only, not execution. Worker revalidates under lifecycle lock and writes ToolStarted; for≤4KiB owned regular-file reads, actual runner entry/bounded read/result commit share one short critical section, without unlocked queued-execution window. Cancel ack linearizes on the same lock: cancel-first means execution0; already-started tools finish the short section before ack, not revocation of read bytes. Do not extend this locking strategy to long shell/network tools.
10. Wait using Condvar/short ticks without DesktopRuntime/actor locks; close/delete/Stop also cancel pending. Startup marks all nonterminal tool runs Interrupted and closes incomplete calls, without runner/HTTP/permission-wait replay. Page reload retains worker/reconstructs current pending. Duplicate SEND returns original facts without restarting.

<a id="task-1canonical-transcriptdurable-v3状态与兼容适配"></a>

## Task 1: Canonical Transcript, Durable v3 State, and Compatibility Adapters

**Independent delivery:** new logs support create/append/strict read/recovery projection/cross-version context; old text tests unchanged. Tool entry disabled, no real HTTP/runner dependency.

**Files:** add `apps/tinker-rust/src-tauri/src/tool_types.rs`, `tool_journal.rs`, `tool_context.rs`, `tool_journal_tests.rs`; edit sibling `lib.rs` (exports), `run_provider.rs` (default tool-round methods), `run_store.rs` (same-lock v3 I/O/global preflight), `run_store_header.rs` (v3 dispatch only, no relaxed old headers), `run_types.rs` (errors). Necessary pure state functions stay in `session_lifecycle.rs`; existing text migration results unchanged.

**Consumes:** existing RunStore safe I/O/single-writer lock, ParentRunRef, RunStatus, RunError; no Task2 types.
**Produces:** all above tool_types/journal/context types and RunStore methods; RunProvider defaults execute_tool_round→ContextUnsupported, validate_tool_result→Ok. Task2 consumes directly, no duplicate DTOs.

- [x] Write `tool_journal_tests` behavior: two list/read rounds then Stop→Completed; exact transcript after save/reopen; strict old v1/v2 byte fixtures; legacy parent→tool child→tool grandchild links; text then call within round, cumulative two-round output appears once per transcript; tool parents rejected by legacy context.
- [x] First run `cargo test --offline --manifest-path apps/tinker-rust/src-tauri/Cargo.toml tool_journal -- --test-threads=1`, expecting undefined new types/methods; record actual failure, not predicted results as observations.
- [x] Implement frozen types/strict wire, pure reducer, single-lock v3 I/O, global preflight/context conversion. Behavioral table tests: `grant→deny` conflict, duplicate ToolStarted, wrong-call result, unclosed-call Completed, postterminal delta, cross-layout same-ID, parent sequence/order/cycle,513KiB context rejection, truncated tail recovery_required, complete illegal line CorruptLog, sync failure leaves snapshot unchanged.
- [x] Recovery tests: pending/granted/started snapshots Interrupted-close with no pending, preserving committed text/call/result; uncommitted results show interrupted only. Task1 runs no executor, so no-auto-replay is not end-to-end proven.
- [x] Rerun targeted command; run `cargo test --offline --manifest-path apps/tinker-rust/src-tauri/Cargo.toml -- --test-threads=1` and `cargo fmt --manifest-path apps/tinker-rust/src-tauri/Cargo.toml -- --check`. Expect all pass with text contracts unchanged; record counts/exit codes.
- [x] Self-review text-only opening/directories for v3 effects; update actual progress and hand to Root for independent review. No new UI channel/binary/runtime capability; Root decides commits, implementer does not advance tasks independently.

**Historical plan status (2026-11-15):** Task1 implemented/core-tested, awaiting independent review; Tasks2–4 not implemented/accepted.

<a id="task-2实际http-rounds权限控制器与合成文件执行"></a>

## Task 2: Actual HTTP Rounds, Permission Controller, and Synthetic-File Execution

**Independent delivery:** public RunController + owned HTTP proves real grant/deny/expired/cancel→runner→tool result→model final reply; no formal UI exposure.

**Files:** add `apps/tinker-rust/src-tauri/src/tool_execution.rs` (controller helper), `synthetic_workspace.rs`, `chat_http/tool_openai.rs`; edit `run_controller.rs`, `chat_http.rs`, `chat_http/sse.rs` (shared framing), `run_provider.rs` (HTTP implementation), `lib.rs`; add `tests/tool_http.rs`, `tests/tool_execution.rs`, `tests/synthetic_workspace.rs`. Preserve old `chat_http/openai.rs`/Anthropic text parsing; extract framing only, no relaxed unsupported assertions.

**Historical plan status (2026-11-15):** Task1 implemented/core-tested, awaiting independent review; Tasks2–4 not implemented/accepted.
**Produces:** frozen RunController tool-opening/four execution-read methods; `ChatHttpProvider::execute_tool_round`; `SyntheticWorkspace::create(root: &TrustedRoot) -> Result<Self, RunError>` implements ToolExecutor, constructed only by trusted hosts/tests.

- [ ] Failing-first public-controller tests: first owned HTTP requests list; before grant runner0/no second HTTP; after grant count 1, second HTTP exact assistant.tool_calls + role:tool/tool_call_id; read round waits likewise; final marker only after mock verifies actual file contents. Old execute/execute_context retain text golden path.
- [ ] Run `cargo test --offline --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --test tool_http --test tool_execution --test synthetic_workspace -- --test-threads=1`, record expected missing-method failure.
- [ ] HTTP single round accumulates index=0 id/name/arguments; initial metadata/later argument chunks allowed, changing id/name/type, unknown deltas, second index rejected. Return ToolCall only after complete JSON+finish_reason tool_calls+completed SSE; premature [DONE]/disconnect runner0. Tool-round Stop requires explicit stop; legacy text codec retains completion compatibility.
- [ ] Send only two fixed strict schemas; context serializes user/assistant/tool without call-ID rewriting. Verify UTF-8/escaped args, same-frame text+call, first-chunk-only ID, postfinish deltas, duplicate finish, multiple choices/calls, empty callId, args>2KiB, unknown tools/fields, incomplete JSON. Protocol rejection must precede PermissionRequested.
- [ ] SecretGuard covers text/full call id/name/args/result, rejecting known fake keys before journal/UI. HTTP validate_tool_result runs after execution and before ToolFinished append; rejection writes only fixed toolFailed closure, never publishing sensitive arguments first. Test cross-chunk keys, malicious result keys absent from disk/UI, no provider error bodies persisted, fake bearer absent from mock metadata.
- [ ] Controller current becomes exclusive internal Text/Tools enum sharing RunStore/worker/lock, not two simultaneous currents. Implement deadline/condvar/receipt idempotency/terminal closure; legacy cancel/drop cancels/joins tool worker. Pass remaining before HTTP and min(config.total,remaining) inside provider; permission wait occupies no HTTP future.
- [ ] SyntheticWorkspace creates fixed `notes/intro.txt`, `notes/steps.txt` (English UTF-8 Unicode fixtures) in fresh private subdirectory with create_new, retaining open handles/fixed manifest/revision. list only manifest; read exact virtual keys via bounded handles, unix FileExt::read_at or Mutex seek(0)+read, not shared-offset try_clone as independent cursor. Repeated/concurrent reads return identical full content. Compare read bytes to host fixture expectations; tampering→toolFailed, never arbitrary new content as synthetic result. No paths to std::fs::read/open; reject ..,absolute,NUL,unknown keys/fields. Restart creates fresh fixtures, never reopens external files/deletes existing fixture directories.
- [ ] Counts: deny/expired/cancel-before-start/wrong-run/stale permission/unsupported/malformed/write-or-sync-failure=0, duplicategrant=1. Barriers cover cancel-first and ToolStarted-first, no new entry after ack; crash after read/before result commit recovers with runner increment0; poststop HTTP increment0; total expiry closes pending/final runTimeout.
- [ ] Rerun targeted/all Rust tests/fmt/clippy: `cargo clippy --offline --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --all-targets -- -D warnings`. Expect passes; HTTP evidence captures tool correlation and real fixture content, beyond runner mocks. Record/Root review, no UI enablement.

<a id="task-3desktopruntimeformal-actor与原react真实接线"></a>

## Task 3: DesktopRuntime, Formal Actor, and Original React Wiring

**Independent delivery:** original input in tools-preview host runs real tool loop; original M2/text Lab/production Electron remain unchanged.

**Files:** edit `apps/tinker-rust/src-tauri/src/desktop_runtime/{mod,profile,protocol,execution,session,store}.rs`, `formal_agent/{channels,actor,projection,delivery,protocol}.rs`, `formal_host.rs`, `formal_platform/launch.rs`, `formal_launch.rs`; add `formal_mock/tools.rs`, explicitly enabled via `formal_mock/mod.rs`; edit `apps/electron/src/tauri-formal/{protocol,transport}.ts`, `apps/electron/src/renderer/hooks/useGlobalAgentListeners.ts`, `packages/shared/src/types/agent.ts` (snapshot event only), related en/zh locales; add/extend `tests/tool_desktop.rs`, `tests/tool_formal.rs`, `apps/electron/src/tauri-formal/tools.test.ts`. Preserve preload `respondPermission`, PermissionBanner, original tool-component signatures/visuals.

**Historical plan status (2026-11-15):** Task1 implemented/core-tested, awaiting independent review; Tasks2–4 not implemented/accepted.
**Produces (frozen):**

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

Only trusted hosts create bindings; validate profile existence/OpenaiChat/revision, public profiles.list excludes executor/options/key/endpoint. Model catalog ordinary strings; no hidden tool capability in renderer configuration. Old TrustedProfile serialization unchanged.

Fixed core methods: `sessions.historyV2` same parameters as History; `chat.eventsV2` same as Events; `chat.permissionRespond` takes `{sessionId,runId,permissionId,behavior:"allow"|"deny",alwaysAllow:false}`; `chat.pendingPermissions` takes `{sessionId: string|null}`. Returns respectively old turn/page plus `toolState: ToolRunSnapshot|null` (eventsV2 typed events), PermissionReceipt, `{permissions: PermissionTicket[]}`. Strict DTOs/limits throughout; text turns in V2 have toolState=null; v1 rejects tool runs. No arbitrary renderer core dispatch.

Original `agent:permission:respond` still accepts only PermissionResponse; actor resolves exact session/run via pending registry, never guesses current session. Same-generation validation/CloseGate rejection precede grant. `agent:get-pending-requests` retains `{permissions,askUsers:[],exitPlans:[]}`; PermissionRequest projects file ToolPreview/canAlwaysAllow=false without rawargs/absolute paths to renderer.

The new shared stream event is the only new recovery contract:

```ts
interface ToolRunSnapshotEvent {
  type: 'tool_run_snapshot'
  sdkMessages: SDKMessage[] // 此run已提交消息，稳定uuid
  activeText: string       // 当前未commit round的partial_text
  pendingPermissions: PermissionRequest[]
}
```

Events stay in original AgentStreamEvent envelope with sessionId/requestId/startedAt/generation/deliverySequence unchanged. `ActiveRun.currentSnapshot` may contain this event; RestoreBundle.sdkMessages includes committed tool history, activeSnapshot contains full snapshot. Handler replaces only matching run SDK messages/active text/toolActivities/pending, never clears other runs/sessions; unchanged snapshots produce no duplicate notifications. Old text_snapshot unchanged.

- [ ] Failing public DesktopRuntime tests: tool binding SEND/v2 states/allow-deny drive real HTTP; duplicate SEND no rerun; text defaults no schemas; switching to text profile with tool parent→ContextUnsupported before Bind; delete/close cancel pending. Check binding journal+v3 cross-validation, global preflight before recovery.
- [ ] Run `cargo test --offline --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --test tool_desktop --test tool_formal -- --test-threads=1` and `bun test apps/electron/src/tauri-formal/tools.test.ts`, record failures.
- [ ] Implement bindings/v2 reads/permission facade; page budgets cover full toolState; insufficient page→fixed pageLimit, no silent event omission. Logical revision includes tool policy, random mock port excluded from idempotency.
- [ ] Add waitingInput to formal `projection::active`; project all assistant.tool_use/user.tool_result/final text in order with stable uuids, scoped toolUseId, original HTTP provider ID. SDKMessageRenderer/ExecutionStepGroup/ContentBlock unchanged. Original long send promise settles only terminally.
- [ ] Typed delivery: full round commits→SDK messages, results→SDK users, permissions→asci_event; on backpressure send full tool_run_snapshot before advancing cursor, never text_snapshot then skip tools. Terminal plan supports all unsent SDK messages with stage/index retries; duplicates create no duplicate history; restore barrier uses cursor/pending from same snapshot.
- [ ] Original hook deduplicates permission_request by session+permissionId; permission_resolved dequeues; tool_run_snapshot atomically replaces per-run state and clears terminal/timeout pending. Reuse PermissionBanner ack dequeue/Esc stop; denied-response errors use existing i18n feedback, no toy buttons. Synchronize shared event and en/zh keys.
- [ ] Owned tool mock enabled only through `OwnedMock::start_tools()`: first list, exact result→read, expected fixture→final, follow-up verifies complete prior call/result history; denied/expired yields real explanatory terminal state. Explicit synthetic profile (`local-tools-mock`, revision `local-tools-protocol-v1`); original mock cannot freely emit tools.
- [ ] Add `src/bin/tinker-tools-preview.rs`, `tauri.tools.conf.json`, identifier=`com.tinker.tools-preview`; only this entry calls `formal_launch::run_tools(context, expected_identifier, probe)`→FormalHost::open_tools. Original run/M2 binary unchanged; separate marker kind, appData `synthetic-tools-v1`, prefix `tinker-tauri-tools-preview-`, never open old M2 root. Validate root before any write/window; share original renderer/CSP without arbitrary IPC/eval/network.
- [ ] Check >256-event backpressure, unread permission requests/resolutions, reload pending, wrong generation/old run, restore-timeout recovery, duplicate snapshots, late grant, closePreparing/closeReady, pending-session deletion; assert runner0/1 and no duplicate hook cards. Rerun targeted, `bun run typecheck`, `bun test apps/electron/src/tauri-formal apps/electron/src/renderer/components/agent/PermissionBanner.test.tsx apps/electron/src/renderer/locales/key-parity.test.ts`, all Rust. Record for Root review.

<a id="task-4owned-native-qa构建与完整交付守门"></a>

## Task 4: Owned Native QA, Builds, and Complete Delivery Gates

**Independent delivery:** runnable separate tools-preview package and traceable native UI evidence, explicitly distinguishing actual passes/unexecuted work and mocks/real models.

**Files:** add `apps/tinker-rust/scripts/build-tools.ts`, `build-tools-native-qa.ts`, `src-tauri/src/bin/tinker-tools-native-qa.rs`, `src-tauri/tauri.tools-qa.conf.json`; extend `formal_native_qa.rs`/support local records as needed (no rendererIPC) and existing packaging helper; report `docs/specs/2026-11-11-tauri-tool-permissions-validation.md`. Existing build-formal/build-native-qa still default M2. Ordinary tools preview forbids probes; QA identifier=`com.tinker.tools-native-qa`, existing formal-native-qa feature/native-qa-dist.

**Consumes:** Task3 complete `FormalHost::open_tools`, run_tools, original React; existing owned WKWebView QA local command protocol.
**Produces:** `bun apps/tinker-rust/scripts/build-tools.ts` (original formal renderer, then explicit TAURI_CONFIG direct cargo, separate .app), `bun apps/tinker-rust/scripts/build-tools-native-qa.ts` (QA renderer/binary); report records SHA, commands/exits, app paths/hashes/signing facts, screenshots and HTTP/journal correlations.

- [ ] Build guards: mixed M2/tools/QA identities fail before window/data; ordinary all-features still no probe. Scripts delete only own fixed-name artifacts, not user/old packages; explicit TAURI_CONFIG, verify entry symbols/identifier.
- [ ] Complete synthetic flow: original editor→Send→list permission→allow→actual list details→read permission→allow→result→final. Separate sessions for deny/timeout/Esc/Stop/window close/menu Quit. Real DOM controls, explicitly not system mouse automation; no atom/runner calls posing as interaction.
- [ ] Evidence root `/private/tmp/tinker-tauri-checks-m3-tools-20261111/native-qa/<batch>` (0700); separate trusted synthetic session root. Existing `native-qa-command.py` drives owned WKWebView; reconcile screenshots/journal/HTTP request metadata/runner records. Metadata synthetic only, no Authorization.
- [ ] Reload pending/granted/result-committed validates snapshots; restart pending/started/postresult validates Interrupted without replay; completed reopen+follow-up retains all call/results. Fault injection proves crash boundaries, report differentiates real restarts/unit injection.
- [ ] Validate languages/themes, model/effort text compatibility, close-final-debounce, response/close races, >256delivery backpressure, wrong-generation old events; M2 regressions prove no replacement.
- [ ] Run/log in order: `cargo fmt --manifest-path apps/tinker-rust/src-tauri/Cargo.toml -- --check`; `cargo test --offline --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --all-features -- --test-threads=1`; `cargo clippy --offline --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --all-features --all-targets -- -D warnings`; `bun run typecheck`; `bun test`; `bun run lint`; `bun run electron:build`; `bun apps/tinker-rust/scripts/build-tools.ts`; `bun apps/tinker-rust/scripts/build-tools-native-qa.ts`. Expect exit0; retain real environment/baseline failures for Root assessment, never unrelated source changes to hide them.
- [ ] Independent review/simplify: grant≠execute, no postcancel late start, no recovery side-effect replay, typed context links, budgets/secret guards, original-path diffs, expired permission cards disappear. Itemize pass/unexecuted; no downloadable-complete claim without UI pass.
- [ ] Root verifies latest main, commits/pushes separate Draft PR through repository flow; no merge/auto-merge/install. Do not execute during plan writing.

<a id="验收清单与回滚"></a>

## Acceptance Checklist and Rollback

Required evidence: deny/expired/cancel-before-start/wrong-run/stale-generation/unknown-tool/bad-args/storage-failure runner0; duplicategrant≤1; each restart adds0 runner/HTTP calls; final answer only after HTTP receives matching tool results; follow-up retains links; original permission/tool cards functional without duplicate/ghost pending.

Rollback: quit tools app, continue M2/Electron; old directories never migrated, new v3 data exclusive to new tools app. Never open new profiles with old binaries; retain synthetic data, cleanup separately authorized. Revert source per task without production defaults. Delivery describes only an “original-UI loop for OpenAI-compatible protocol, owned mocks, and synthetic read-only tools,” not real models/arbitrary tools/full product.

<a id="task2-实现接口补充2026-11-15"></a>

### Task2 Interface Addendum (2026-11-15)

`RunProvider` adds a backward-compatible default method
`validate_tool_context(&self, context: &ToolContext, tools: &[ToolSpec]) -> Result<(), RunError>`，
defaulting to `Ok(())`. Controller calls before v3 header creation; HTTP checks protocol/catalog/full context
and known keys (new input included), without public key getters. Raw tool arguments and strictly decoded JSON paths
are checked before HTTP round return; results pass existing `validate_tool_result` before journal commit.
Existing text APIs do not call this seam. Synthetic workspace retains only newly created fixture handles; actual reads use
Mutex-protected seek/read, comparing compile-time fixture bytes; virtual paths never become open arguments.
Only explicit `RunController::open_with_tools` enables tools; default Lab/Electron/DesktopRuntime unchanged.

Task2 review adds default pure-validation seam:
`validate_tool_output(&self, output: &str) -> Result<(), RunError>` defaults Ok.
Tool workers validate cumulative candidate output before every TextDelta write; HTTP reuses private known-key
checks to prevent cross-round leakage; validation panics caught under lock. Old text APIs do not call it.
Synchronous persistence cannot be interrupted in hard real time; recheck absolute deadlines after successful return to prevent
execution, next-round networking, or Completed after budget exhaustion. Tool opening rejects recovery_required logs
in any layout before recovery append; read-only inspection may still return that flag.
