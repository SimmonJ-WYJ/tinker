# Native Channel and Model Settings Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` with one implementation writer, behavior RED/GREEN, independent task review, and a final whole-branch review. Continue the already authorized text-workbench milestone without another execution-method confirmation.

**Status:** Existing-channel slice implemented. Independent review identified Important finding I1; its scoped repair passed actual RED/GREEN, affected all-features Rust, fmt and warnings-denied clippy. Scoped re-review and new committed-head full/build/native verification remain pending. Native tooling recovery and baseline acceptance are recorded separately; new channel-settings GUI acceptance remains UNRUN.
**Baseline:** merged main `77f052052de8fc6af659c0def19d57f0c4515869` after PR #25.
**Goal:** Make the original channel settings controls operate against Rust for existing host-managed channels, including durable model availability and actual owned-loopback connection discovery.
**Architecture:** Keep one native actor, one platform snapshot/receipt authority, the existing session journal and original preload API. Add a bounded nonsecret channel overlay to platform persistence. The host retains immutable connections. A native-only trusted runtime availability setter gates new sends after immutable receipt reconciliation, without changing provider identity or accepted queue execution.
**Tech Stack:** Existing Rust/std/serde/reqwest/Tokio/Tauri, React/TypeScript/Jotai, Bun. No dependencies, real credentials, new UI, model requests, or general network authority.

## Global Constraints

- Reuse the existing isolated worktree on `feat/tauri-channel-model-settings`. Do not touch the original source, user checkouts, other worktrees, installed applications, or real data.
- Preserve production Electron/SDK defaults and original renderer layout, CSS, components, shortcuts and ordinary runtime constructor behavior. No README.md / CLAUDE.md edits.
- Repository documents and PR/review text are English. Source comments/logs are Chinese. User-facing messages use synchronized en/zh i18n.
- Only new trusted synthetic roots and owned numeric-loopback mocks. Do not read a real credential store, environment credentials or actual history. No paid model request, model probe POST, installation, deployment, or production switch.
- Only existing trusted profile IDs and model IDs can be edited. No new connection/profile CRUD, unknown model IDs, provider/protocol changes, arbitrary URLs, real key import, capabilities expansion, shell, filesystem authority or image tools.
- Keep platform revision, mutation receipts, write-before-ack, bounded private atomic storage and failure freeze. Reuse the existing platform store rather than adding another mutable configuration database. Preserve old snapshots with no overlay and fail closed for unsupported/corrupt data before recovery writes.
- Persist only channel name/enabled/model ID/name/enabled metadata, never URL, port, plaintext/encrypted key, credential placeholder or complete raw connection inputs. Do not serialize secrets into mutation receipts, errors or logs.
- Immutable connection fields from the original full-form update may be accepted only as validated no-ops against the current owned connection. Normalize them away before platform receipts. Reject changed or unrecognized fields. Empty API key means no change. Any nonempty value must match the known synthetic key of this host and must never be persisted.
- Public channel list uses the original Channel shape. It may expose only this preview's current owned numeric-loopback base URL and an empty apiKey. Decrypt-key compatibility can return only the literal existing MOCK_KEY after proving a host-managed synthetic connection, never a general TrustedProfile key.
- Connection and model-list tests perform actual bounded GET discovery against the host-owned endpoint, use no environment proxy, follow no redirects, and never accept renderer URLs as authority. At most 2 seconds and 64 KiB response. No provider chat POST is hidden inside Test. Successful copy explicitly describes connection/catalog validation, not model execution.
- Metadata changes affect new sends. Already accepted chains/queued UUIDs retain their original configuration and can complete, stop and reconcile identically. Disabling must not stop/replay existing work, erase history, change configRevision, or defeat exact retry receipts. New disabled starts must cause zero HTTP/tool execution.
- Allow empty channel/model selection as an explicit paired state, including all channels/models disabled. Reconcile an invalid selected channel/model atomically during channel mutation. Preserve the original UI's selection clearing/fallback semantics and do not report unsupported settings as saved.
- No new `any` or global state library. Focused helpers, ~500-line soft and ~800-line hard source limits. Do not grow the existing 856-line ChannelForm. The preferred design needs no change to that component.
- Reuse `migration-work/tools-native-target`, one compiler at a time. Stop new large builds below 4 GiB free. No cleanup of user files, old bundles or unknown caches.
- Run normal hooks and independent review before authorized branch push/Draft PR. No force push, merge, auto-merge, deployment or installation. Report native channel-settings GUI as UNRUN until final-binary acceptance, distinguish baseline native evidence, and record remote CI accurately.

## Decisions and Alternatives

1. Selected: nonsecret overlay plus trusted immutable host connections, original UI and API. This advances the actual settings/send/restart chain without requesting credential access.
2. Rejected for this batch: renderer-only settings, which can claim success without durable storage and can be bypassed by direct IPC sends.
3. Deferred: general channel CRUD and OS credential storage, which need their own credential lifecycle and authorization design. Do not create a fake implementation or claim full settings parity.

## Task 1: Complete the Existing-channel Configuration Slice

**Files and responsibilities:**
- New focused `apps/tinker-rust/src-tauri/src/formal_platform/channels.rs`: strict metadata DTOs, overlay validation, original-Channel projection, connection no-op normalization and settings reconciliation.
- Existing `formal_platform/{mod,settings,receipt,protocol,launch}.rs`: bounded snapshot/receipt integration and compatible bootstrap state. Touch only the parts required by the overlay, preserve revision/replay and old-snapshot validation.
- New focused `desktop_runtime/availability.rs` and narrow `desktop_runtime/{mod,execution}.rs` changes: trusted availability API, validation against immutable profiles, new-send gate after existing binding/receipt checks. Do not add a renderer dispatch method for changing availability.
- Existing `formal_agent/{channels,actor}.rs` and a focused helper if needed: normalize original channel updates, apply successful platform commit then availability before acknowledging, expose list/test/discovery on the actual formal invoke chain. Poison/failure must freeze further sends rather than leave stale permissive runtime state.
- Existing `formal_mock/mod.rs` plus a small focused module if needed: authenticated owned GET models route and bounded discovery client. Existing chat SSE behavior remains unchanged.
- Existing `apps/electron/src/tauri-formal/{protocol,transport,entry}.ts`: original channel:update uses the same serialized mutation lane/revision and cache snapshots, propagate only necessary coded messages through i18n. Existing preload method names/arguments remain unchanged.
- Both locale error namespaces if new coded copy is needed.
- New Rust integration `tests/formal_channels.rs`, focused Rust unit tests and frontend `tauri-formal/channels.test.ts` through the original preload factory, plus original ChannelForm DOM tests when feasible.

**Interfaces:**
- Original LIST: `channel:list`, args `[]`, returns `Channel[]` with no stored key.
- Original UPDATE: `channel:update`, args `[id, ChannelUpdateInput]`, requires normal `{mutationId, expectedRevision}`, returns confirmed `Channel` and platform snapshot. Allowed metadata is name, enabled and models. Full-form connection/capability fields are immutable validated no-ops only.
- Original TEST / TEST_DIRECT / FETCH_MODELS: keep existing shared argument and result shapes. Only the current owned mock connection is allowed. Unknown profile/model/URL/key fails before network. Success validates authentication/catalog availability, never claims a successful model turn.
- CREATE / DELETE remain explicit unsupported operations. They must not report empty success.
- Trusted runtime availability setter accepts all known profile IDs with a bounded set of known enabled model IDs, applies only to new immutable run bindings. Ordinary callers with no availability policy retain old behavior.
- Actor startup derives policy from the validated durable overlay. A channel update commits platform facts first, applies the already validated policy, then returns. Runtime policy failure blocks new sends and remains a disclosed recovery error.

**Behavior cycle and acceptance:**
- [x] RED: actual FormalHost invoke `channel:update` with mutation returns unsupported before implementation. Use a new marked synthetic root and the existing two-model mock. Record command/output.
- [x] Implement metadata persistence and strict validation. Keep immutable connection fields out of receipts and all serialized bytes. Compare source history/journal bytes across metadata changes.
- [x] Verify rename, model aliases, enable/disable, all-disabled, invalid IDs, duplicates, empty/oversized lists, unknown fields, expected-revision conflict and idempotent mutation receipt behavior.
- [x] Reopen the same synthetic root with a new owned server port. Metadata and selection restore without treating the new port as a configuration change. No automatic HTTP or tool execution on reopen.
- [x] Test new disabled sends have zero HTTP/tool calls, exact existing UUID retry remains reconcilable, accepted queued work retains its configuration, and Stop/close/restart behavior remains available.
- [x] Test platform write failure and uncertain writes preserve authority or freeze, no early success/cache changes. Corrupt/future/truncated overlay data fails before recovery writes. Old snapshot without overlay opens unchanged.
- [x] Add actual bounded owned GET catalog/auth discovery, success and failure tests, redirect/external/different port/URL userinfo/key mismatch rejection, missing/unknown probe model rejection and timeout/response bound checks. Inspect output/storage for no secret persistence.
- [x] Through `createDesktopApi(createFormalTransport(...))`, verify update arguments and serialized revision lane, snapshot-after-ack, failure cache preservation, quiesce/close waiting and no Electron import. With original ChannelForm test synthetic key/baseUrl and actual metadata-save payload, prove no component/layout rewrite is required.
- [ ] GREEN: focused Rust/frontend tests and typecheck, then normal commit and task review. Covering commands and RED/GREEN evidence go in the external report.

Example original-API integration assertions:

```rust
let before = host.mock_records().len();
let update = invoke_with_mutation(&host, &generation, "channel:update",
    json!(["local-mock", {"models":[
      {"id":"local-mock-a","name":"Primary","enabled":false},
      {"id":"local-mock-b","name":"Secondary","enabled":true}
    ]}]), "disable-a", revision);
assert_eq!(update["value"]["models"][0]["enabled"], false);
assert!(send_disabled_a(&host, &generation).is_err());
assert_eq!(host.mock_records().len(), before);
```

Use the repository's actual test helpers or define complete local equivalents. Do not commit documentation's illustrative test pseudo-helper names as production APIs.

## Final Verification and Delivery

Implementation verification: prior complete Rust all-features runs, including Root's run on 1c3dbcce, passed before I1 and are historical for this repair. After I1, affected unit/channel/platform/queue coverage passed; Root will rerun the complete suite on the new committed head. Warnings-denied clippy and fmt passed. Full Bun passed 3540 tests with four existing rg integration skips; monorepo typecheck and affected ESLint passed. Original ChannelForm DOM and preload mutation-lane tests passed. Build and native final-binary acceptance are Root-owned remaining gates. The external report records every command, initial RED, failed diagnostic run, interruption, and successful resumed run.

- [ ] Final committed-head complete Rust all-features suite after I1; affected all-features tests, fmt and clippy with warnings denied passed for the repair, single compiler.
- [ ] Monorepo typecheck, full Bun suite, affected lint, Electron build, ordinary Tauri build. Reuse unchanged QA harness, no GUI operation through an alternative route.
- [ ] Independent task/whole-branch/simplify review and final diff/secret/default audit. Fix Critical/Important issues and rerun affected checks.
- [x] Document exactly which backend/process/renderer tests ran and which native GUI actions did not. No whole-product parity, real-model, installation or performance claim.
- [ ] Fetch/merge latest main, normal hooks, safe push and English Draft PR if gates pass. Verify full head/main SHA, checks, statuses and Actions. Required English PR review comment ends workflow.

## Native Acceptance History and Remaining Gate

The initial normal CUA inventory call failed before app access with `failed to start Node runtime: No such file or directory (os error 2)`. Root later proved Node existed and the execution cwd was missing, created only the empty private execution directory, and recovered the same normal inventory API. No alternate GUI driver, accessibility bypass, security-setting change, or installed-app replacement was used.

Root independently exercised a copied immutable baseline QA bundle (binary revision 376, runtime-equivalent to baseline 77f0520), using a fresh marked synthetic root. Baseline observations include queued A/D/B/C execution, permissions, partial-failure retention and draft restore, stream Stop, zh/dark, idle reload, and live pending-permission restore. A shared execution transport interruption prevented the initial Quit/restart conclusion; Root resumed that independent acceptance after the environment recovered and confirmed Cmd+Q process exit, durable Unicode unsent draft/tabs/zh/dark, and explicit reopen with exact draft/history plus zero new mock records before sending. A first-paint observation remains for final-binary recheck: accessibility listed restored history while the first screenshot was blank; wheel scrolling made the bubbles render. No UI/CSS change or crash/force-termination injection was made for that observation. These observations do not test the new configuration implementation. Its native settings/save/send/restart acceptance remains UNRUN until Root builds the final source.

## Additional Necessary Lifecycle Repair

An existing actor fault test exposed a real race during active log-path failure. If the streaming worker first marked the run Failed with `recovery_required=true`, text `RunController.cancel` previously returned that terminal in-memory snapshot as success. `chat.stopChain` could then falsely acknowledge safe cancellation and discard actor ownership. Deterministic RED tests cover provider-triggered terminal uncertainty and an active cancel-write failure followed by retry. The minimal guard rejects cancellation success for a current text snapshot requiring recovery; durable terminal idempotency remains unchanged. The original actor ownership/unsafe-close assertion is retained and its diagnostic improved. No ToolContext validator or unrelated lifecycle refactor is included.

## Independent Review Repair I1

The independent task/whole-branch/simplify review found that replaying a successful earlier channel mutation could clear a later recovery freeze: an uncertain post-rename write left the platform store blocked and memory at the prior enabled state, but receipt replay bypassed Store.write and the successful availability setter reset the overloaded blocked flag.

The runtime now distinguishes resettable policy-validation failure from a lifetime `availability_recovery_required` state. Healthy setters and exact mutation receipt replay cannot clear recovery state. Existing accepted send/queue bindings still reconcile before new-binding admission, and safe Stop/close remain available. Only a new runtime derives fresh authority from the validated durable snapshot. No receipt normalization, snapshot version, store recovery procedure, connection authority, ToolContext validator, frontend or production default changed.

- [x] Actual RED: four cases admitted fresh work before the repair, covering post-rename B uncertainty plus exact A replay, pre-write freeze plus A replay, a direct successful setter after freeze, and accepted queue retries followed by a new chain.
- [x] GREEN: the same four cases pass; post-rename snapshot bytes and receipts remain unchanged, reopen derives disabled B, ordinary no-policy constructors and healthy policy updates work, and exact accepted receipts plus Stop/close remain available.
- [x] Covering all-features Rust passed 144 unit, 5 original-API channel, 20 platform and 8 queue tests; fmt and all-target warnings-denied clippy passed.
- [ ] Scoped independent re-review and Root's complete committed-head/build/final native acceptance gates.

Fault injection remains restricted to cfg(test), reusing the existing post-rename Store flag through a test helper. The external report preserves exact commands, statuses, expected RED failures, and prior run provenance.

## Rollback and Remaining Work

Production Electron and existing installed app remain the rollback path. The new overlay is synthetic-only. Preserve it and its receipts rather than rewriting/downgrading data. Old readers must fail before recovery writes when a new overlay is present. Do not delete real data or retire the old backend.

Remaining: native window acceptance, general channel CRUD, secure real credential lifecycle, real provider smoke authorization, image/attachment/general tool parity, legacy-data cutover and measured rollout. This batch is an existing-channel configuration slice, not the complete text-product migration.
