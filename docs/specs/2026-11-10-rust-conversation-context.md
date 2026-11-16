<a id="rust-lab持久化父执行链与真实-http-多轮上下文"></a>

# Rust Lab: Persistent Parent Execution Chains and Real HTTP Multi-Turn Context

Status: Core implementation and local automated validation complete, 2026-11-10. Baseline main `4ca339592668581c1dc36abc9097fc9bf0aa1650`, isolated branch `feat/rust-conversation-context-audit`. Implemented at the user's request to continue migration; production UI, features, and data unchanged. Synthetic loopback services only, without real credentials or online models. Uses the same RunStore lock and context-v2 subdirectory; downgrade mixed-write ordering limits below. See stage report for untested exact Started/fsync fault injection, dedicated multi-turn panic, and other gaps; the entire design checklist is not claimed as tested.

<a id="推荐的一个完整批次"></a>

## Recommended Complete Batch

Add a real Tauri command `continue_lab_run(requestId, parentRunId, input, scenario)`, reusing `RunController`, `RunStore`, and `ChatHttpProvider`, treating a successfully completed execution as an immutable parent. Reconstruct validated `user/assistant` messages from parent-chain JSONL, append current user, and enter the existing HTTP/SSE lifecycle. Existing JSONL, paginated reads, cancellation, and restart recovery continue managing results. Desktop defaults to offline fixtures; HTTP is injected only by trusted hosts. Automated acceptance uses synthetic data and numeric loopback only.

First turns retain `start_lab_run`; continuation/branching explicitly require parentRunId, never inferred from current/latest run. Preserve the three existing commands' parameters, public RunSnapshot/RunRecord/RunEventPage shapes, old v1 log contents, and read/write paths. Register the new command in real `main.rs` generate_handler and connect actual InvokeRequest + MockRuntime + loopback HTTP; no unit-test-only bypass library, experimental UI redesign, or production Electron connection.

Parent-task constraints refine the layout: old v1 remains runs-v1/<id>.jsonl; new continuations use runs-v1/context-v2/<id>.jsonl, under the same RunStore and root writer.lock. Old readers scan direct root *.jsonl only, preserving old logs while new continuations are temporarily invisible after downgrade without data deletion. New versions unify ID lookup/deduplication/createdOrder allocation across both layouts; no second conversation store/controller.

<a id="已核验的代码事实"></a>

## Verified Code Facts

- `run_commands.rs`: Trusted host `RunHostState::with_chat_http` already connects HTTP; renderer chooses only requestId/input/scenario. `main.rs` defaults to offline `RunHostState::new`.
- `run_controller.rs`: One active execution; worker lock serializes start; inner lock protects store/current; provider spawns only after header and Started persistence succeed. runId=requestId; duplicates compare input/scenario. Drop cancels/joins; open marks nonterminal runs interrupted without provider replay.
- `run_store.rs`: Sole source of truth `runs-v1/<id>.jsonl`; `<id>.json` is disposable cache. Private RunHeader and public DTOs deny_unknown_fields; header/events currently protocolVersion=1. Header limit 512KiB, log 4MiB; single-writer directory lock. Direct symlink/hardlink, corrupt middle records, and future versions rejected; truncated tails require recoveryRequired.
- `chat_http.rs`: `RunProvider::execute(&str, ...)` currently builds one user message; HTTP no-retry/proxy/redirect protections, timeout, cancellation, SSE parsing, output budgets, and key-reflection blocking already independently verified; do not reimplement.
- `tests/run_invoke.rs` has real handler, HTTP process exit/restart, cancellation/deduplication, and sensitive-data-free JSONL evidence; `tests/support/http.rs` currently limits request reads to 16KiB. Large-context tests need a separate bounded helper or parameterized limit, never unbounded reads.

<a id="三种设计及结论"></a>

## Three Designs and Conclusion

| Approach | Benefits | Costs/Problems | Conclusion |
|---|---|---|---|
| Same RunStore/original writer.lock manages root old v1 and context-v2 new private v2 headers, persisting parentRunId/parentSequence/contextPolicyVersion with bodies from existing records | Same truth/lock; one header creation includes full start intent; reuses recovery/deduplication; old readers ignore subdirectory and open old logs; no copied history/new store | Separate header version/layout from event/IPC versions; old binaries cannot see continuations; mixed-version ID collisions/order ties need explicit behavior | **Recommended**, smallest batch with complete invariants |
| Preserve v1 header, add `<id>.context.json` sidecar | Old programs generally ignore sidecars and read JSONL; reconstruct parents from existing records | No two-file atomic transaction; context-only/log-only/fsync uncertainty. Fundamentally, missing sidecar makes context runs indistinguishable from legacy standalone runs, silently losing ancestors. Without copied input, orphan intent cannot fully identify same-requestId requests | Do not implement under claims of zero schema change and complete safety |
| New conversation store/manifest with full message snapshots and independent references/copied history | Self-contained context, easy conversation display | Duplicate deduplication/locks/recovery/budgets/lifecycle, cross-store transactions and copied data; beyond minimal batch | Consider in later full-conversation/migration stages |

A sidecar can fail closed only with a durable discriminator surviving sidecar loss: change headers, add records unknown to old readers, or reserve a new runId namespace rejected by all old/new writers. The first two still change schema; the third changes old ID acceptance and requires collision/downgrade handling. Writing sidecar before JSONL alone proves only one commit window, not missing-metadata detection. Never encode lineage implicitly in input, scenario, or createdOrder.

<a id="语义与精确数据形状"></a>

## Semantics and Exact Data Shapes

Add `run_context.rs`:

- `ParentRunRef { run_id: String, sequence: u64 }`, serde camelCase + deny_unknown_fields.
- `RunLineage`: Internal `Standalone` or `Continuation { parent: ParentRunRef, policy_version: u32 }`; StoredRun adds internal lineage and created_order, outside public RunSnapshot.
- `ChatRole { User, Assistant }`, lowercase wire representation, these roles only.
- `ChatMessage { role: ChatRole, content: String }`.
- `RunContext { messages: Vec<ChatMessage> }`: Private fields, controlled construction/read-only access; root `[user(input)]`; continuation `[ancestor user, ancestor assistant, ..., parent user, parent assistant, current user]`. No renderer-supplied messages/role/system prompt.
- Fixed `CONTEXT_POLICY_VERSION=1`, `MAX_CONTEXT_ANCESTORS=16`, `MAX_CONTEXT_BYTES=512*1024` (total content UTF-8 bytes including current input), `MAX_HTTP_REQUEST_BYTES=4*1024*1024` (entire serialized JSON request bytes). Experimental policy, not tokenizer/model token limits or universal model compatibility. Even worst-case sixfold JSON control-character expansion fits; explicitly check after serialization too.

**No automatic trimming/summarization**. Parent chains exceeding 16 completed turns or 512KiB return `contextLimitExceeded`, without new logs, networking, or parent changes. Never keep assistant while dropping user, split UTF-8, or silently omit ancestors. Exact limits accepted; +1 byte/ancestor rejected. Preserve current input's 65536-byte limit. This finite explicit policy makes one batch verifiable without persisted trimming algorithms/token cost estimates. Future policyVersion2 may define complete-turn suffix trimming without changing policy1 semantics.

Add fixed `RunError` codes `ContextParentNotCompleted`→`contextParentNotCompleted`, `ContextLimitExceeded`→`contextLimitExceeded`, `ContextUnsupported`→`contextUnsupported`. Missing parents reuse `runNotFound`; invalid IDs reuse `runInvalidOptions`; existing corrupt/future/symlink/io codes contain no paths/content.

Continuation requires parent. parent==requestId yields `requestConflict` even before existence, preventing self-loops. Parent must be Completed, !recoveryRequired, with correct terminal sequence. Reject Running/Queued, Failed, Cancelled, Interrupted parents entirely, not just their assistant output; unsuccessful user input also stays out. Retrying after failure/cancellation requires a new requestId pointing to the original successful parent; failed runs/partials remain readable. Same requestId means lookup/deduplication, never retry.

Two requestIds may sequentially branch from the same parent. Inherit only explicit ancestors, never siblings/latest/same-input runs. Existing lifecycle forbids appends after parent completion; stored parentSequence anchors its terminal state. Load validates exact sequence and strictly decreasing createdOrder, plus visited IDs for cycles. No new hash dependency; no claim to prevent same-user malicious in-place edits preserving sequence, consistent with existing symlink-check boundaries.

<a id="持久化与原子性"></a>

## Persistence and Atomicity

Preserve `RunHeaderV1` fields and serialization. Add strict `RunHeaderV2` with shared fields but header `protocolVersion=2`, required `parent: ParentRunRef`, required `contextPolicyVersion=1`. Only continuations use v2; roots remain v1. Events remain protocolVersion=1; public snapshots/pages remain 1. Do not globally change PROTOCOL_VERSION to 2 and alter old events/DTOs.

Split `check_version` into header dispatch (1/2 only) and existing event checks (1 only). `entries` and `load` share header decoder in each layout, avoiding scan/load disagreement; `snapshot_from_header` uses normalized private headers without exposing storage version through IPC. Missing parent/bad reference/unknown fields in v2 → corruptLog; future header/contextPolicyVersion → unsupportedVersion. Old v1 lineage=Standalone.

`RunStore::create_continuation(id,input,scenario,parent_ref)` shares header writing, createdOrder, budgets, and path checks with original create; no second writer lock/storage engine.

**Exact layout:** RunStore retains the sole lock at `parent/runs-v1/writer.lock` (also used by old versions), adding `context_root = root.join("context-v2")`. Scan only root v1 and this fixed v2 subdirectory, without recursive traversal. ensure_dir/canonicalize/direct-symlink checks apply to context_root. v1 paths require header1; context-v2 requires header2; mismatches → corruptLog. `find_location(id)` safe_file-checks both: both exist → corruptLog, neither → runNotFound; never choose arbitrarily. StoredRun carries internal layout; append/cache_snapshot stay in its directory with <id>.json cache names; directory fsync targets the actual parent. Duplicate IDs fail closed at open/deduplication without overwrites/automatic repair. Allocate max createdOrder across layouts +1; original start writes root v1, continue writes context-v2.

**Downgraded mixed-write boundaries:** Old programs ignore context-v2 while reading/writing root v1, so cannot deduplicate invisible continuation IDs. If an old version reuses a hidden ID, upgrading explicitly returns corruptLog without deleting either. New old-version v1 writes may also tie hidden v2 createdOrder. Preserve per-layout unique order, allow cross-layout ties, sort by `(createdOrder, layoutRank)` (v1=0, v2=1). This is deterministic read order, not actual strict start chronology after downgrade. Normal new-version global order remains strictly increasing. Newly written parent chains require parent.createdOrder < child.createdOrder, retained in v2 validation. Do not hide ties with mtime scans, old-header rewrites, or global manifests. Explicitly test old-style order ties and duplicate IDs across layouts. This limit preserves new-version multi-turn context/restart deduplication and usable downgraded old logs. Actual start order:

1. Validate ID/input/scenario; acquire existing worker/inner locks.
2. **Check requestId for duplicates/conflicts first**. Old start conflicts with existing continuation even for matching input/scenario; continue conflicts with standalone. Compare input/scenario/parentRunId for continuation; host freezes parentSequence on first creation, without re-resolving parent on resend to change intent.
3. Existing match returns current/persisted snapshot without provider calls, including completed/failed/cancelled/interrupted after restart. Host provider/model changes still do not rerun; provider identity remains outside request identity, preserving existing behavior.
4. If absent, confirm unblocked/no active run. Join old worker; under existing locks reconstruct/validate parents from **disk truth**, not current cache potentially marked storage failure; validate budgets and freeze immutable RunContext.
5. Persist input/scenario/parent/policy/createdOrder in one v2 header; write_all + sync_all + directory sync using existing non-overwriting create_new. Then append Started + sync_data.
6. Only then spawn provider; worker captures frozen RunContext, never querying latest/disk ancestors during sending.

This does not claim atomic header writes under arbitrary power loss: preserve detectable incomplete single-file writes. Complete header-only or post-Started crashes recover as Interrupted; partial/bad headers fail closed; io/fsync uncertainty blocks the controller without automatic provider retries. The crucial guarantee is lineage and input in **one fact record**, avoiding a cross-file window where start is confirmed before parent intent is durable. Recovered interrupted requestIds return existing state without repeated paid effects.

Missing/corrupt/future/path-invalid parents never become roots or empty context. `open` should validate all logs before recovery (old sequential recovery could rewrite early items before detecting later corruption); at least validate v2 static fields/parent graph before new requests. Two-pass validation+recovery is sufficient without an index store. Nonterminal v2 recovers interrupted normally; parents must already have succeeded. Bounded sequential loads check at most 17 ancestors, releasing events individually rather than retaining each 4MiB collection; excessive depth yields contextLimitExceeded. Do not claim this solves the existing absence of a global startup run-count budget.

<a id="provider-和-http-接入"></a>

## Provider and HTTP Integration

Minimal compatible extension: Keep `RunProvider::execute(&str,...)`, add object-safe `execute_context(&RunContext, token, emit)` with default implementation accepting only one user then delegating to execute. Multiple messages return ContextUnsupported; never silently use the last user. Controller uniformly calls execute_context; old provider-injection tests need no bulk signature changes.

`ChatHttpProvider` overrides execute_context; old execute constructs one message and reuses the same stream. Stream serializes validated messages as model/messages/stream:true, checks full request-byte budget before requesting, and retains all network security/SSE/cancellation/SecretGuard/chunk logic. Never concatenate role/content into one user string to simulate multiple turns.

`OfflineFixture` adds no multi-turn support, using trait-default safe rejection. Default offline-host continuation persists failure `contextUnsupported`, never pretending fixed output understands history. Trusted HTTP hosts and context-capable test providers verify actual context. Legacy execute-only providers explicitly reject multi-turn rather than dropping history.

Reuse original scenario parsing, empty-input checks, trusted-provider selection, spawn_blocking, and fixed-code mapping in `continue_lab_run`; small shared helpers may reduce repetition without refactoring old command behavior. `main.rs` adds registration only. Existing read/cancel return strict old DTOs for v2 too. No history editing, conversation lists, automatic parent choice, or new UI; future lineage display needs a separate query DTO, not new fields in strict RunSnapshot.

<a id="明确文件边界和实施顺序"></a>

## File Boundaries and Implementation Sequence

1. Tracked spec: Parent task writes `docs/specs/2026-11-10-rust-conversation-context.md`, documenting schema compatibility/default offline boundaries; follow repository specs placement, leave README/CLAUDE unchanged.
2. `src/run_context.rs`: Types/shapes/byte-budget validation; export in `lib.rs`; only new error codes in `run_types.rs`.
3. `src/run_store.rs`: v1/v2 normalization, internal StoredRun lineage/order, create_continuation, parent-chain reads. If large, extract sibling header codec/context assembly modules called by the same RunStore; never duplicate storage.
4. `src/run_controller.rs`: Old start delegates to shared internal start; add continue_with_provider, mode+parent deduplication, freeze context before creation; reuse cancellation/finish unchanged.
5. `src/run_provider.rs`, `src/chat_http.rs`: Safe default context rejection, explicit fixture override, HTTP messages/outbound budget.
6. `src/run_commands.rs`, `src/main.rs`: Register real handler. Frontend source/contracts/styles, production source/dependencies unchanged.
7. `src/run_context_tests.rs` (module tests), `src/run_store_tests.rs`, `src/run_provider_tests.rs`: Boundaries/persistence/lifecycle. New `tests/context_invoke.rs` for real IPC+HTTP, two/three turns, branching/restart. Avoid expanding existing 650-line run_invoke; extract existing support fixture/Invoke helpers if useful, keeping scope focused.
8. Stage report records executed checks, source scope, incomplete work, rollback boundaries. Parent task runs full project validation; this design task does not.

<a id="必须通过的验收行为先行"></a>

## Required Acceptance (Behavior First)

<a id="真实竖切面"></a>

### Real Vertical Slice

- Original start A: loopback receives exact `[user:u1]`, returns chunked Unicode `a1`; continue B(parent=A) receives exact `[user:u1, assistant:a1, user:u2]`, output enters existing paginated JSONL. Trait capture alone is insufficient.
- Destroy/reopen same fixture root and trusted HTTP host, continue C(parent=B): exact 5 messages, same order/UTF8. A/B/C old DTOs pass original strict decoding; terminal cancel remains idempotent.
- Branch D from A contains only A+new user, excluding B/C. Continuing from B later ignores D being latest.
- Concurrent duplicate B while active produces one HTTP socket; matching requestId/input/scenario/parent resent after restart creates 0 sockets. Changing input/scenario/parent separately yields requestConflict; old start using continuation ID and continue using legacy ID conflict with unchanged log bytes.

<a id="故障与恢复"></a>

### Failures and Recovery

- Cancel B after partial output; late chunks/finish cannot change terminal state. B partial stays readable but cannot parent. New C from A resending user executes without B user/partial in body. At least one each of failure/timeout/transport failure; panic uses existing capture/provider path.
- Subprocess exits abnormally after B Started + partial delta; restart marks B interrupted without provider call; duplicate B returns interrupted; C from A excludes B. Header-only v2 likewise recovers, retaining parent.
- Header/Started/delta storage failures: No socket before durable confirmation; later failures retain confirmed partials and existing recoveryRequired/block state, without automatic retry. Parent-load failures precede any child-log write.
- Synthetic header3, contextPolicyVersion99, missing/bad parent ID/self/cycle, nondecreasing order, wrong parent sequence, missing/Cancelled parent, Completed parent with truncated tail/recoveryRequired all fail closed without source changes/HTTP. Do not skip middle corruption. Symlink/hardlink use isolated fixtures; verify external target bytes unchanged.
- Unify cross-layout deduplication; old-style root-only scan ignores context-v2 and reads v1. Simulated downgraded cross-layout order ties sort as specified; duplicate IDs yield corruptLog with both files unchanged.
- All existing v1 fixtures open/read/start/cancel; original header fields and event protocol1 unchanged; never send v2 as event protocol2 to frontend. Corrupt caches remain rebuildable; cache is never truth.

<a id="有界性与安全"></a>

### Bounds and Safety

- 16 ancestors accepted, 17 rejected; exactly 512KiB content accepted, +1 rejected; retain current input 65536 boundary tests. Budget includes current user and complete assistant output, UTF8 bytes rather than characters.
- Full request budget handles escaping expansion from control characters/quotes/Chinese; server helper has explicit bounds. Correct role array, not string prompt. Reject budgets before HTTP and without child logs (HTTP-only serialized budget checks would already create failed children; prefer controller worst-case context guarantee plus defensive HTTP limit, documenting the distinction).
- Existing SecretGuard still blocks key reflection in second-turn messages; no fake keys in fixture JSONL. HTTP error bodies/URLs/headers never enter fixed errors/logs; no persisted request-body copies.
- Old custom providers without context fail explicitly contextUnsupported, never execute last user while hiding history loss. Existing root execute-injection tests remain.

Automated completion: Real Tauri registration and loopback two-turn/restart/branching all pass; original Rust/TS regression, fmt/clippy, existing build gates pass through parent workflow; zero production-directory/dependency/frontend differences. MockRuntime is not native WebView acceptance; loopback is not external TLS/real model/account/cost acceptance, and makes no such claims.

<a id="回退与明确不做的内容"></a>

## Rollback and Explicit Non-Goals

No Electron/.asci/other-QA data reads/writes, real credentials/external networking/model calls, automatic migration/cleanup, dependencies, production-entry changes, or tools/images/projects/permissions/full conversation UI. Ancestor-run text continuation is the next testable execution capability, not full product replacement.

Feature rollback removes the new command/call entry. A full revert to old binaries scans root v1 only, preserving old logs; context-v2 stays in place but invisible, readable again after upgrading. Downgraded mixed-write ID collisions fail closed on upgrade without deleting/migrating either file; cross-layout order ties use the specified deterministic order. Production Electron was unchanged and requires no Lab-data changes to continue use.

Fixed-subdirectory compatibility needs no dedicated context host or extra read/cancel APIs; existing read/cancel in one RunHostState accesses both layouts, keeping real main wiring clear. If time is constrained, cut optional fixture displays/query APIs, never persistent parent binding, request conflicts, actual HTTP body assertions, or restart tests.

<a id="自审结论"></a>

## Self-Review Conclusion

No parallel conversation store needed: one RunStore/lock, fixed context-v2 layout, private header2. Explicit parent choice, failed-turn exclusion, branching, duplicates, budget failures, and crash recovery; freeze context across threads and rebuild from persistent chains across restarts. Old binaries read root v1 with continuations temporarily invisible; downgrade ID/order limits are explicit. Other whole-product capabilities stay outside this batch.

<a id="实施计划与检查点"></a>

## Implementation Plan and Checkpoints

One complete vertical implementation task, with one implementer handling Rust files; audit tasks add independent reports only, without concurrent source edits.

- [x] Write real-handler multi-turn HTTP red tests in `tests/context_invoke.rs`, confirm failures, then implement command.
- [x] Implement `run_context.rs`; extend the same RunStore's strict private headers/layout/parent validation, preserving v1 serialization.
- [x] Connect controller, typed provider, HTTP messages, and Tauri registration, without production entries/dependencies.
- [x] Cover major boundaries, branches, duplicates, cancellation, failures, restart, corruption, paths, real permission/delta storage failures, compatibility shapes; disclose uninjected windows separately.
- [x] Run `cargo fmt --check`, `cargo test --offline --locked`, `cargo clippy --offline --locked --all-targets -- -D warnings`, and native binary build, all using `apps/tinker-rust/src-tauri/Cargo.toml`.
- [x] Repository-wide `bun run typecheck`, `bun run lint`, `bun test`, Rust Lab Vite and Electron build with isolated test configuration/synthetic data.
- [x] Independent specification/quality review and simplify; fix confirmed important issues and rerun affected checks.
- [ ] Final report separates local mocks, native UI, and unaccepted online scope; verifies zero production-source differences and protection of user changes.
- [ ] Use existing authorization and normal hooks to commit/push a safe branch, create Draft PR only, verify SHA/CI, then finish without merge/install/deploy.
