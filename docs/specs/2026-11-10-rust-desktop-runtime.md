<a id="正式界面复用的-rust-desktop-runtime-实施计划"></a>

# Rust Desktop Runtime implementation plan reusing the production UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development task-by-task. Each task starts with behavior red/green tests, followed by independent specification/quality review. Publish a Draft PR only after related tasks form a usable end-to-end loop.

**Status**: M1 implementation and local acceptance complete; all three tasks passed independent review. Default unchanged; M2/M3 incomplete. User authorized implementation directly after planning. Baseline main `5683b781cc46ab631f73c7e84c735dcb9fb58021`, PR #19/#20 merged. Read-only design is in milestone-design.md in the local checks directory; the following is the execution source of truth.

**Goal:** In the existing production UI, use an explicitly opted-in Rust process for text sessions, model selection, multi-turn streaming, cancellation, errors, and restart/history recovery, binding Tauri handlers to the same Rust application service.

**Architecture:** Keep renderer/preload; Electron main adds only thin backend routing, stdio client, and production message-protocol projection. Rust owns session/request bindings and execution facts, reusing RunController/context-v2; Tauri and stdio share one application service. Default Electron/SDK unchanged; no RustLab page expansion.

**Tech Stack:** Existing React/TypeScript/Electron, Rust/Tauri, serde/reqwest/tokio, Bun; prefer dependency reuse.

<a id="总里程碑"></a>

## Overall milestones

| Stage | Usable result | Gaps before complete switch |
|---|---|---|
| M1 this round | Existing UI → real Rust subprocess → text HTTP provider, production sessions/recovery; shared Tauri IPC | Still uses Electron platform; real models/native environments require separate validation |
| M2 | Consistent tools/permissions/artifacts/generation/background execution; Tauri loads same renderer with platform services implemented by domain | Align all old capabilities, resource protocols, system authentication, key stores |
| M3 | Synthetic legacy-data compatibility, user-authorized import/rollback, three platforms and same-condition resource tests, production rollout | Change default and retire old implementation only after meeting feature matrix |

Do not describe M2/M3 as complete this round. No promise to migrate in days or infer memory benefits from Rust.

## Global Constraints

- Preserve production UI, styles, layout, and default Electron/SDK behavior. Allow new routing only when unpackaged, explicitly opted in, using a separate newly created synthetic-data root and valid trusted-profile configuration; reject if any condition is absent rather than silently changing root.
- Do not read real channels.json, system keys, sessions, accounts, or projects; no real model requests, installation/deployment, restored research features, or writes to the original dirty worktree.
- Trusted host profiles allow numeric loopback only this round; disable DNS/proxies/redirects/external addresses. Host defines profile/model/revision; renderer sends logical IDs only; secrets never return to UI, logs, errors, or persistence.
- Model configuration this round means trusted-profile registration, metadata discovery, and model selection, not complete real-channel credential CRUD migration. Unmigrated modification/probe interfaces in original channel settings return unsupported, without falling back to real legacy services.
- Trusted host must durably precreate DesktopRuntime caller root under a stable parent: existing absolute non-symlink directory; core does not recursively create caller ancestors. Each open verifies root and direct parent before namespace writes; core verifies its own namespace/session directory chain.
- Original run DTO/schema, Lab commands, and history readers remain compatible; no real-data rewriting. New production sessions use separate `desktop-runtime-v1` namespace and lock.
- At most 128 sessions and 128 request records per session; title ≤1024 UTF-8 bytes; IDs retain 64-byte ASCII validation; timestamps are JS-safe integer milliseconds. Preserve existing input/output/event/context limits; never truncate while claiming full history.
- Same-session create supports reuseDraft=true; sessions.update changes only title/pinned/archived; deletion first tombstones and stops that session, without releasing locks during execution or deleting active runs.
- New wire version 1, JSONL frame ≤4MiB, pending ≤32, ordered history pages ≤2MiB serialized body each, old production API aggregation ≤16MiB; fail explicitly on overflow. No transport error automatically replays side effects.
- A session's current profile may change on an explicit new send; historical per-turn bindings never change. Empty drafts may first send using another channel. Old requestId replay must not revert current profile or trigger HTTP.
- Freeze request identity session/request/profile/model/configRevision/input/effort; replaying a request does not invoke provider again. Failed/canceled/interrupted runs cannot be parents; a new retry inherits only the latest successful ancestor.
- Explicitly reject unmigrated tool/thinking/multimodal, attachments/directories/MCP/skills, coding, queue/fork/rewind/compact, etc.; do not discard parameters and fake success. Default UI `taskMode:search` is text-mode metadata and must not wrongly reject ordinary sends; default effort high requires explicit protocol mapping, never silent omission.
- Accept no late deltas after cancellation or stale terminal states overwriting new requests. Cancellation/rejection executes no tools. There is no actual tool runner this round; tool blocks from models return explicit unsupported with execution count zero; full authorized execution belongs to M2.
- Renderer explicitly registers bounded opaque requestIds; after terminal cleanup, continue rejecting callbacks for owned old requests. startedAt is real time only, never identity ordering; equal/backward clocks must permit sends. Old ERROR/COMPLETE and send Promises cannot change new request errors, drafts, running state, or terminal side effects; unidentified legacy SDK/external calls retain compatibility.
- Text preview does not expose deliverables file resources this round, avoiding premature file services that would migrate again; production static UI assets allow trusted build directories, real artifact protocols integrate together in M2.
- New user-facing descriptions/errors use en/zh i18n; comments/logs use Chinese; no any, second state library, or bulk internal ASCI identifier renames. Source soft limit 500/hard 800 lines; split by domain.
- Independent commit/review per task; proceed only without important unresolved findings. Final Rust/Bun/type/lint/build and feasible UI validation; no CI-passed claim without records. Normal hooks, safe branch/Draft PR, no force push/merge/install.

<a id="方案取舍"></a>

## Tradeoffs

Loading the current UI in Tauri first encounters auth, synchronous themes, settings, updates, media, windows, and many startup APIs, risking a bridge that only pretends to succeed. Putting real business logic into Rust application services first and connecting two thin transports lets users validate the new engine in familiar UI sooner; Tauri later avoids remigrating session logic. The temporary Electron sidecar client owns no new long-term business logic.

<a id="共同-wire-契约"></a>

## Shared wire contract

Requests/responses use fixed method allowlists and error codes; stdout contains JSONL protocol only. Read events by bounded sequence-cursor polling, without infinite push queues. `chat.send` returns immediately after starting background execution so cancel cannot be blocked.

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

Malformed frames without valid IDs may emit a fixed stderr code and close; the client fails all pending requests consistently, without echoing malformed content or producing falsely valid replies.

Exactly one of result/error; unknown versions/fields/methods/IDs/overflow return fixed codes without raw parameters. Public Rust profile DTOs omit endpoint/key; secret profiles initialize through trusted constructors or controlled CLI config, never renderer-supplied Tauri configuration. Tauri `desktop_runtime_request` uses the same service/decoder, without duplicate business logic.

`sessions.create` accepts title/profileId/workspaceId/reuseDraft; empty drafts reuse only with the same profile/workspace; normal create does not implicitly join current project. `sessions.update` accepts sessionId and title/pinned/archived, never arbitrary patches.

`chat.send` explicitly accepts requestId/sessionId/profileId/modelId/userMessage/startedAt/effort. History/events preserve start time/request bindings; events include sessionId/requestId/runId/sequence/kind; deltas contain incremental text only, terminal states fixed codes. Session history returns stable turn/message identities, states, models, and times; compatibility layer generates the same SDKMessage projection without inventing usage/cost or SDK session provenance.

<a id="task-1rust-正式会话-facade真实进程与-tauri-共用服务"></a>

## Task 1: Rust production-session facade, real process, and shared Tauri service

**Files:** Add `packages/shared/src/types/desktop-runtime.ts` and barrel; Rust `src/desktop_runtime/` (mod/protocol/profile/session/store domains), `src/bin/tinker-runtime.rs`, `src/desktop_commands.rs`, tests `tests/desktop_runtime.rs`/`desktop_process.rs`/`desktop_invoke.rs`; appropriately adjust Cargo/lib/main.

**Consumes:** Existing RunController/RunStore/context-v2/ChatHttpProvider, synthetic trusted profiles. Task1 first runs the service with existing OpenAI text; outbound effort/public protocol mapping follows in Task2 and must meet its gate before Task3. Task1 cannot claim original-UI send support.
**Produces:** `DesktopRuntime::open(root, profiles)` and fixed-wire `dispatch`, real stdout/stdio binary, same-core Tauri state/handler. Before first test, fix exact API and synchronize TS/Rust contracts; do not alter wire-method semantics above without authorization.

- [x] Define source-of-truth relationship between session journal and run logs: persist immutable request bindings/user input before starting run; pre-start write failure never calls provider. Crashes leave request interrupted/uncertain without automatic replay. Reject RunStore input/parent-chain mismatches. Index/cache rebuildable; no two independent JSON files both claiming truth.
- [x] RED: Session create/list/update/draft reuse, cross-session history isolation; request-binding conflicts; real-process two turns + third after restart, mock HTTP captures 1/3/5 role messages, Unicode preserved.
- [x] Implement bounded metadata/request journals, single-writer lock, reused controller per session, at most 16 active sessions, late-terminal ownership and restart recovery; do not open per request and interrupt active runs.
- [x] RED and implement: Concurrent sends call provider once; input/model/revision/effort changes conflict; failures/cancellation preserve partial output; process kill restores interrupted; reject bad/truncated/future schemas, unsafe paths, and storage failures first.
- [x] Real-process tests: Unknown/oversized/truncated frames, wrong reply IDs, no logs on stdout, EOF closure, prompt cancel response during slow provider, no lingering model requests after parent disconnect, no automatic resend. stdin offers no arbitrary path/command execution.
- [x] Real Tauri invoke (MockRuntime) calls same service; illegal parameters produce same codes; old Lab tests continue passing.
- [x] Run Rust fmt/test/clippy; record real red/green counts and untested fault windows; Root commits after independent review.

<a id="task-2两种文本协议与-effort-映射"></a>

## Task 2: Two text protocols and effort mapping

**Files:** Add Rust Anthropic provider codec (split by domain), shared HTTP/SSE/secret/timeout helpers as needed; extend desktop profile/factory protocol, synthetic-server tests. Existing OpenAI API/Run DTO compatible.

**Consumes:** Task1 trusted-profile registry and immutable request/effort bindings.
**Produces:** Selectable `openai-chat` and `anthropic-messages` text providers with explicit capabilities. Extend codec/private provider factory only, without renderer changes.

- [x] RED: Real loopback requests for two models/protocols, correct paths/auth/roles/system fields; reject unsupported effort/fields first; default high and supported effort actually go outbound, never ignored silently.
- [x] Validate Anthropic state against official Messages streaming message_start→content_block_*→message_delta→message_stop; ignore ping; byte-fragmented UTF-8 deltas reassemble. Explicitly unsupported nontext/tool/thinking blocks; error/non-success stop/truncation never fake completion.
- [x] Reuse validated cancellation, total 120-second/idle 15-second caps, disabled domains/loopback-only host scope, HTTP error redaction; test concurrent cancellation, error-body/key reflection, timeout/broken stream/socket cleanup, with tool execution always 0.
- [x] Official protocol references: [Claude streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), [Messages](https://platform.claude.com/docs/en/api/messages). Reference protocols only, no real service calls.
- [x] Commit after Rust tests/fmt/clippy and review pass.

<a id="task-3正式-electron-ui-的隔离-opt-in-路由与消息投影"></a>

## Task 3: Isolated opt-in routing and message projection in production Electron UI

**Files:** New main domain `lib/desktop-runtime/{client,router,projection,config}.ts` (responsibility-based names), `ipc/desktop-runtime.ts`, minimal agent-session/channel entry adjustments; shared stream union and original `hooks/useGlobalAgentListeners.ts` support typed text_delta; test original AgentView/AgentMessages/Atom real components. Original preload API shape unchanged.

**Consumes:** Task1/2 wire, sidecar binary, trusted synthetic profiles. Production session list/create/messages/sdkMessages/update/delete/send/stop route consistently; do not change only send while history still reads legacy backend.
**Produces:** Original UI+preload+main IPC→real Rust process→mock HTTP→persistent history→original UI; disabling opt-in returns to old SDK. Rust owns all new business logic; TS only adapts.

- [x] RED: Disabled by default, old IPC regression passes; packaged builds, missing root/config/binary, existing namespace, external targets, or abnormal configuration cannot enable. Main trusted config selects paths; renderer cannot execute binary/change env/root.
- [x] Initialize selectable profile/model defaults in independent preview settings, preserving original settings interface and later user choice; leave real config untouched. Platform preferences may reuse old services with isolated roots this round; do not call this full Rust configuration-storage replacement.
- [x] Dispatch Rust branch first, without old sticky/context writes or SDK; no fallback for unmigrated operations. Explicit unsupported reads/writes; retain and document semantically safe existing platform/isolated-root read services.
- [x] Rust profile metadata returns through original listChannels structure, at least 2 models selectable; unknown profile/model/disabled/revision conflicts rejected; credential CRUD never calls old decrypt/keychain.
- [x] One history projection generates old AgentMessage and SDKMessage with stable UUID deduplication and user/assistant/terminal states matching durable records. New typed ASCI text_delta maps to existing applyAgentEvent; exactly one complete assistant at terminal state, no repeated same-UUID snapshots.
- [x] STREAM_COMPLETE emits only after readable history, retaining startedAt; cancellation sets stoppedByUser; fixed errors restore running with partial content; late old-process/request events cannot overwrite new streams. Sidecar exit/bad frames/timeouts clear pending/stop polling, without automatic restart/resend.
- [x] Queue initially explicitly unsupported; original optimistic queue/draft recovery must not hang permanently; reject coding, tools, attachments/directories, MCP/skill, unsupported overrides without silent omission. Preserve UI source; minimally adapt shared listener/behavior helpers where necessary, regressing default old path.
- [x] Real sidecar+local-server main/preload delegation integration; original AgentView/AgentMessages show Unicode deltas/two turns/failure/cancellation/reopen. When native Electron is available, use independent owned process/userData and synthetic fixtures for actual page acceptance/screenshots without touching existing App; record blockers honestly, never bypass permissions.
- [x] Full Bun/types/lint/Electron build, appropriate Rust regression; commit after independent review passes.

<a id="task-4整体验收兼容矩阵与-draft-交付"></a>

## Task 4: Overall acceptance, compatibility matrix, and Draft delivery

- [x] Real-process two protocols/models, 1/3/5 context, multiple sessions, replay, cancellation/tool rejection, failure/kill/recovery, and default legacy regressions; resolve initial findings and rerun affected checks.
- [x] Original UI component/CSS difference inventory and feasible native/simulated evidence; distinguish Electron UI, Tauri MockRuntime, untested native Tauri. Do not claim unused interfaces migrated.
- [x] Update tracked report: actual/default paths, unmigrated features and M2 entry, exact commands/counts/logs, credential/data protection/rollback; no unrelated README/CLAUDE rule changes.
- [x] Format/types/lint/full Bun/Cargo/Electron build, sensitive-diff review, independent full-branch review/simplify; publication uses normal fetch+merge latest main, safe-branch push/Draft, full head/CI verification, and post-PR review-reply workflow; actual remote status follows PR records.

<a id="回滚与完成定义"></a>

## Rollback and definition of done

Disable opt-in to restore original default backend; retain new namespace for newer readers, never delete it to implement rollback. Old user data/installed version never switched. M1 requires actual production UI→Rust process, same-core Tauri invoke, and the recovery/cancellation tests above; if native GUI unavailable, list it as unaccepted, never claim full product replacement. Retain Electron/SDK while M2/M3 are incomplete.

<a id="已完成阶段证据持续更新"></a>

## Completed-stage evidence (updated continuously)

- Task 1: `36480123eb068b38e8f7e27d5865609f2ff90c01`. Rust session facade, durable bindings, JSONL process, and shared Tauri handler implemented. 171 Rust regressions and fmt/clippy passed; independent specification/quality reviews passed. Review findings on global read-only recovery preflight, directory-sync retries, and exact pagination budgets fixed with regressions.
- Task 2: `696cdc684ef25811d6a61126ae7efccdee7cb3a3`. Two text protocols, trusted-model effort declarations, and real outbound fields implemented. Final 186 Rust regressions, fmt/clippy, shared types, targeted lint passed; independent re-review passed. Anthropic multiple-top-level-delta fix has real HTTP/runtime-process red/green tests.
- These tests use synthetic data, fake credentials, and local loopback services. Tauri is real-handler MockRuntime invocation, not native windows. See Task 3 for production UI wiring/acceptance; do not extrapolate core tests to full product replacement.

- Task 3: `9e9c790d84bc5036d46b462f87cd3466f1914cf7`. Original production UI through real preload/main/Rust/local HTTP completed sends, multi-turn, two models, failed-draft recovery, cancellation, refresh during execution, full-process reopen, and Chinese/English/themes. R1–R6 and EOF issues fixed with regressions.
- Post-PR fix: `e1344fddc3d232d6151a362b633408a244b3526f`. Independent requestId replaces timestamp ordering; regressions cover five UI entry points, late callbacks, optional default-SDK metadata, unidentified legacy compatibility. Actual renderer completes after clock rollback, without system-clock changes. Final 54 focused tests/333 assertions, 3443 repository-wide Bun tests, 186 Rust tests, six-workspace types, lint, and full Electron build passed; independent re-review and simplify passed. Normal hook incremented Electron workspace 0.1.617→0.1.618, no installer or default switch. See [acceptance report](../reports/2026-11-10-rust-desktop-runtime.md).
