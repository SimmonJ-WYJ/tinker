# Tauri Queued Turns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`, serial single-writer tasks, behavior red/green tests, independent task review, and final whole-branch review. User authorized continuing the existing migration plan without another execution-method confirmation.

**Status:** Implementation authorized, baseline preflight complete. No queue implementation is claimed by this plan.
**Baseline:** main `450df3a86ca9cfc64d4b8777c98a1311f5230d57`, after merged PR #24.
**Goal:** Make the existing workbench's text FIFO queue, Option/Alt interrupt-send, Stop, reload, and restart history work through the Rust/Tauri runtime.
**Architecture:** DesktopRuntime owns durable accepted queue intent and execution lineage in its existing journal. The existing native actor owns live scheduling and delivery. Keep initial send ownership separate from each execution run. Reuse original React components and IPC facade.
**Tech Stack:** Existing Rust/std/serde/reqwest/Tauri, React/TypeScript/Jotai, Bun. No new dependencies or database.
**Predecessors:** `2026-11-10-rust-desktop-runtime.md`, `2026-11-11-tauri-formal-ui.md`, and `2026-11-11-tauri-tool-permissions.md`. Their completed tasks are not repeated.

## Global Constraints

- Preserve original workbench components, layout, styles, shortcuts, production Electron/SDK defaults, installed apps, real data and credentials. Do not edit README.md/CLAUDE.md. New records and PR copy are English, source comments/logs remain Chinese, user-visible messages use synchronized en/zh i18n.
- Work only in the current isolated worktree on `feat/tauri-queued-turns`. Other checkouts are not clean assumptions: main checkout has 63 status entries, original source status timed out after 15 seconds. Never reset, clean, stash, move or overwrite those checkouts.
- Only trusted-host-created synthetic roots, fake keys, owned numeric-loopback model mocks and synthetic read-only tools. No real model calls, secret access, installation, deployment or production switch. No new general filesystem authority, shell, MCP, images, attachments, or Anthropic tools.
- Keep existing text/Lab/legacy commands and schemas compatible. Queuing is explicitly opted in by a new trusted runtime constructor and native capability, not enabled by a renderer flag or prompt. Existing ordinary constructors still reject queue methods.
- Use the existing single-writer journal for queue intent, with strictly versioned additions. New readers validate old records unchanged plus the new records. Old readers must reject unsupported new schema before recovery writes. Do not rewrite old logs or pretend old binaries can open queue-enriched synthetic data on rollback.
- Output/terminal facts remain run-log authority. Queue records own accepted intent/order/disposition only. No independent mutable queue database or duplicated editable run output.
- Keep existing 64KiB input, 512KiB context, 2MiB desktop page, 4MiB frame, 16MiB formal projection, 128 sessions/requests per session and 16 active-session caps. New pending limits: 16 per chain, 128 globally, 512KiB full encoded pending payload per session. Accepted unique queued IDs count toward existing request quota even after abandonment. Reject before append, never silently truncate or drop.
- Identical accepted UUID/payload retries return the original receipt in pending/bound/closed/recovered states. Different chain/text/interrupt/session/config conflicts. No duplicate reordering, cancellation, provider or tool execution. Receipt loss is reconciled by exact UUID, never retried with a new identity automatically.
- Stop, failure, final close and deletion bar subsequent starts durably before acknowledging success. Freeze on uncertain persistence/cancellation. Reject stale expected-chain/revision/run control operations without affecting a newer chain. Same-process document reload continues live work. Process restart never automatically executes any previously accepted queue or tool.
- Preserve input/partial output and accepted-but-unexecuted text with exact UUIDs in history. Never render abandoned items as executed. Successful earlier turns remain readable if a later queued turn fails.
- Keep ordinary Completed-only parent policy. Full interrupt parity uses a narrowly versioned redirected lineage, authorized by the exact durable interrupt receipt, only after its exact predecessor is Cancelled and all pending calls are terminally closed. Failed/crash-interrupted/general-cancelled parents remain forbidden. No replay of parent tools and no renderer-supplied context array.
- Separate stable chain/attempt ownership from execution request/run identities. Permissions, tool calls, snapshots and cursors use actual execution identity. Initial send promise and STREAM_COMPLETE finish once for the chain. Late old-chain events, replies, Stop or grants cannot affect the next chain.
- Preserve existing badge clearing at each legacy-equivalent completed-turn boundary. Do not quietly change to a new exact-pending UI policy. New internal queue snapshots/receipt metadata may repair native ownership/reload without adding layout, controls, or an app entry.
- Source soft limit ~500/hard ~800 lines, focused helpers by concern, no `any`, no new global-state library. Do not grow current aggregators with a second business engine.
- Reuse known build cache `migration-work/tools-native-target`, one compiler/build at a time. Check disk before large builds and stop new builds below 4GiB free. Do not clean user files or unknown caches.
- Normal hooks and independent review before safe push/Draft PR. No force push, merge, auto-merge, deployment or installation. Remote SHA/checks/status/Actions must be checked separately.

## Source Facts and Design Choices

- `AgentQueueMessageInput` is `{sessionId,userMessage,uuid?,interrupt?}` and returns an accepted UUID. Preserve this public facade. Existing actual shortcut is configured send gesture plus Option/Alt.
- AgentView currently refuses every desktop preview queue before clearing the composer. Only trusted queue-capable native bootstrap removes that refusal. Other preview hosts remain unsupported.
- Legacy badges clear on each SDK `complete` and STREAM_COMPLETE. There is no existing `user_message_consumed` event. Native internal events must not be misrepresented as old SDK behavior.
- The current native actor and renderer gates own a request by the initial local send ID. Sending subsequent core request IDs unchanged would drop later replies. Tool snapshots also currently use envelope requestId as execution identity. This milestone corrects both seams.
- The current core inherits only successful ancestors. Cancel-and-resend would silently lose the interrupted turn's context. This milestone includes authenticated redirected lineage, rather than weakening ordinary parent checks.

Alternatives considered: renderer-only FIFO loses reload/recovery and durable acknowledgment. A second actor queue file splits input truth across stores. The selected core journal plus thin actor chain is the shortest compatible path through existing execution.

## Frozen Boundary

`DesktopRuntime::open_with_queueing(root, profiles, tool_bindings)` explicitly enables the new methods. Ordinary `open` and `open_with_tools` remain unchanged. Profiles/tool bindings remain trusted host inputs.

New methods use strict camelCase DTOs with unknown-field rejection:

```ts
interface ExistingSend {
  requestId: string
  sessionId: string
  profileId: string
  modelId: string
  userMessage: string
  startedAt: number
  effort: string | null
}
interface BeginChain extends ExistingSend {}
interface QueueInput {
  sessionId: string
  chainId: string
  uuid: string
  userMessage: string
  interrupt: boolean
}
interface QueueQuery { sessionId: string; chainId: string; uuid?: string }
interface AdvanceQueue {
  sessionId: string
  chainId: string
  expectedActiveRequestId: string
  expectedQueueRevision: number
}
interface StopChain {
  sessionId: string
  chainId: string
  reason: 'stop' | 'failure' | 'close' | 'delete'
}
```

- `chat.beginChain` accepts the exact existing Send fields and returns ChainSnapshot. Chain ID equals the immutable initial request ID.
- `chat.queue` accepts QueueInput and returns QueueReceipt. Derive profile/model/effort/revision from the chain binding, never current settings or caller-supplied credentials.
- `chat.queueState` accepts QueueQuery and returns a bounded ChainSnapshot, plus exact receipt when uuid is supplied.
- `chat.advanceQueue` accepts AdvanceQueue and returns ChainSnapshot. Bind/dequeue atomically before starting the next provider, using the preceding terminal execution's context.
- `chat.stopChain` accepts StopChain and returns ChainSnapshot after start exclusion/cancellation is known. An early Stop for a valid session/expected initial request may record a bounded stop tombstone so a delayed Begin cannot start it. It cannot stop another chain.

The Task1 report freezes the exact serialized QueueReceipt/ChainSnapshot definitions and error codes before Task2 starts. They must include chainId/sessionId/revision, active execution Turn, pending accepted message identities/text/order, closure reason, stable message UUID mapping, and badge-clear boundary. Keep existing Turn wire shape unchanged. Receipt disposition links run-log status rather than duplicating output truth. Use fixed errors without raw text/key/path leakage.

Journal transitions must cover acceptance, atomic queued binding, chain closure, authenticated redirect edges and recovery. Version any required lineage extension explicitly. Existing nonqueue request replay and legacy readers retain their old behavior.

## Task 1: Durable Rust Queue and Authenticated Redirect Context

**Files:** Existing `apps/tinker-rust/src-tauri/src/desktop_runtime/{mod,protocol,session,store,execution}.rs`, new focused queue modules beside them, narrowly required `run_context`, `run_store`, controller/tool context/journal helpers, and new integration tests `tests/desktop_queue.rs` / `tests/queue_redirect.rs`.
**Consumes:** Existing immutable Send/bindings, RunController, RunStore, trusted profiles/tools, current cancellation and context bounds.
**Produces:** The five frozen dispatch methods, opt-in constructor, durable queue/recovery semantics, exact serialized receipt/state contracts for Task2.

- [ ] RED: use existing `runtime.dispatch(json!({...}))` in a synthetic integration test. A queue-capable runtime is constructed through a test helper initially using the ordinary constructor. Assert `chat.beginChain`/`chat.queue` return success, enqueue B/C while A is blocked, and advancement sends A/B/C exactly once. Observe the missing-feature error before implementation.
- [ ] Implement the opt-in constructor, strict DTOs, reducer/journal replay and methods. Pending text acceptance is synced before receipt, UUID conflict/retry behavior is durable. Do not duplicate editable input or bypass existing store preflight.
- [ ] RED/GREEN: interrupt D while A is streaming or waiting on permission, then D/B/C. Confirm provider messages include A's committed input/partial transcript, all unresolved tool calls closed, no old tool replay. Ordinary continuation from generic Cancelled/Failed/Interrupted remains rejected.
- [ ] Cover Stop-before-start versus Bind-before-Stop, delayed Stop for A after new chain B, repeated interrupts/UUIDs, queue quota/encoded overflow, storage failure, malformed/future/truncated journal, and restart after acceptance/binding/start. Restart produces zero HTTP/tool calls and preserves every accepted user UUID once.
- [ ] Run focused RED/GREEN with recorded outputs, then full Rust all-features tests/fmt/clippy once. Commit with normal hooks and self-review. Save report and exact interface appendix for Task2.

Behavior test shape (reuse actual existing test harness fixtures, never invent a paid provider):

```rust
let receipt = runtime.dispatch(json!({
    "version":1,"id":"queue-b","method":"chat.queue",
    "params":{"sessionId":sid,"chainId":chain,"uuid":"b",
              "userMessage":"B","interrupt":false}
})).unwrap();
assert!(receipt.error.is_none());
// Repeat the same call and compare its immutable acceptance identity.
// Controlled provider records must contain B exactly once after A completes.
```

## Task 2: Native Actor and Original Workbench Queue Integration

**Files:** `formal_host.rs`, `formal_agent/{actor,channels,delivery,projection,permissions,protocol}.rs`, focused queue bridge helpers, `apps/electron/src/tauri-formal/{protocol,transport}.ts`, native-only queue state helper, original AgentView capability guard, tool snapshot/attempt listeners and tests only where required. Existing Electron main/preload behavior and layouts remain unchanged.
**Consumes:** Task1 exact receipt/state APIs and opted-in runtime. Existing generation/restore/close gate and original facade.
**Produces:** Real queue/interrupt/Stop through original editor, additive trusted native capability, stale-action protection and complete chain/execution projection.

- [ ] RED: original queue call reaches native host and returns the accepted UUID. Other preview hosts still reject before clearing input. Actual existing frontend component/transport test fails before implementation.
- [ ] Add trusted queue capability and native-only expected chain metadata for queue/Stop. Bind metadata when the user action is initiated, not whichever session chain exists later at the actor. Leave public Electron queue input unchanged.
- [ ] Keep one attempt owner and long-send completion per chain. Use distinct execution IDs for tools, permissions, partial content, histories and new runs. Preserve staged/backpressure-safe delivery and authoritative restore snapshots, including accepted pending messages.
- [ ] Preserve per-turn badge clearing policy without allowing old terminal events to end the whole active chain. Keep the existing queue bar/keyboard/controls and original production paths. Native failure/unknown acknowledgment retains recoverable input and reconciles the exact receipt before rollback, without automatic new-UUID resend.
- [ ] RED/GREEN: A/B/C FIFO, D interrupt while A waits on permission, rapid Stop/new send, queued late ack, reload while active, full outbox, stale old permission/terminal after new chain, per-session isolation, failure after first success, one exact user UUID/bubble, and no partial output assigned to another turn.
- [ ] Test close prepare/abort versus final close: freeze then restore live work on abort, durably stop all pending work on final close, no automatic HTTP on full reopen. No new timer-driven renderer execution engine.
- [ ] Run focused Rust/Bun/type/lint plus affected original queue/ownership/tool snapshot tests. Commit after self-review and save report. Task review must verify both facade compatibility and execution safety.

## Task 3: Native Synthetic Acceptance and Delivery

**Files:** Existing owned QA harness only as needed, focused native scenario data/scripts in checks, tracked report `docs/reports/2026-11-16-tauri-queued-turns.md`. No new application entry or permanent QA automation endpoint.
**Consumes:** Task1/2 real core/actor/original editor and existing tools-native QA binary.
**Produces:** Testable independent preview behavior, evidence, accurate gaps and rollback, reviewed Draft PR.

- [ ] Exercise original editor Send, configured send+Option interrupt, queue bar and Stop in owned synthetic QA. Record ordered local mock HTTP, journal, exact bubble UUID count and permissions for A/B/C and A→D→B→C. Cover failure, Stop/resend, reload, close abort/commit and process restart with zero auto HTTP.
- [ ] Check English/Chinese and light/dark, multiple sessions and backpressure. If GUI/runtime access is blocked, report exact state and continue independent automated checks. Do not bypass lock or denied permission, do not claim native acceptance from mock runtime.
- [ ] Run final Rust fmt/all-features tests/clippy, monorepo typecheck/lint/Bun, Electron build, ordinary and QA Tauri builds. Reuse cached dependencies with one compiler. Do not use real credentials or models.
- [ ] Independent whole-branch review, fix/retest blockers, final source/default/data/sensitive diff review, latest-main merge, normal commit/push hooks, Draft PR and precise head/base/checks/status/Actions verification. Do not merge or install.
- [ ] Record actual passed/failed/unrun checks, source SHAs, UI evidence, retained old checkouts, schema rollback limitation and remaining M2/M3 gaps. No whole-machine memory or full-product/real-service claims.

## Rollback and Remaining Milestones

Stop the independent preview and continue the unchanged installed Electron application. Revert this batch through reviewable commits. Queue-enriched synthetic data needs the new reader; old binaries must refuse new journal/lineage versions rather than mutate them. Do not delete that data or migrate real histories automatically.

Real channel/credential CRUD, real providers, rich draft/attachment/image parity, general tools/shell/MCP, real project/filesystem authority, legacy-data import/export cutover and measured production rollout remain separate milestones. This queue stage must not claim those capabilities migrated.
