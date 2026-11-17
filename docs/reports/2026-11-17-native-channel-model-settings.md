# Native Channel and Model Settings Validation

- Date: 2026-11-17
- Baseline: `77f052052de8fc6af659c0def19d57f0c4515869`, merged PR #25
- Tested implementation: `616e9adb37300f62dbda8ef7fa234a3a1547a96b`
- Branch: `feat/tauri-channel-model-settings`
- Scope: existing host-managed synthetic channels in the original React UI, Tauri IPC and Rust runtime
- Release status: isolated preview only, no production default change, installation, deployment or online model request

## Delivered behavior

The existing Models & Channels controls now read and durably update names, availability and known-model metadata through Rust. The original full-form update is validated against immutable host-owned connections and normalized before receipts. Only nonsecret metadata is stored. Channel/model availability gates new sends while accepted immutable send/queue receipts retain their original identity and configuration.

Connection tests and model refresh perform bounded authenticated GET discovery against the current owned loopback server. They use no environment proxy or redirects, a two-second deadline and a 64 KiB response limit. The single cancellable worker does not block actor control handling. Success copy in both locales explicitly distinguishes catalog validation from a model turn. CREATE/DELETE, arbitrary endpoints, unknown models and real key import remain unsupported.

Two necessary recovery fixes are included. Text cancellation cannot acknowledge an uncertain in-memory terminal snapshot as durably stopped. Recovery freezing is monotonic for a runtime lifetime, so a successful old channel receipt or healthy policy setter cannot reopen fresh execution after a failed/uncertain write. Reopen derives authority from the validated durable snapshot instead of rewriting uncertain evidence.

## Automated verification

All commands used isolated synthetic config/runtime roots and the existing offline Cargo cache. Owned HTTP/SSE mocks used fake credentials only. No model service, credential store or real conversation was accessed.

| Check | Result |
| --- | --- |
| `cargo test --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --all-features -- --test-threads=1` | Exit 0 on final code, 397 top-level tests across 40 Cargo targets, zero failed or ignored. Nested spawned-child summaries excluded from the total |
| `bun test` | Exit 0, 3540 passed, four existing real-rg integration skips, zero failed, 418 files |
| `bun run typecheck` | Exit 0 across all six workspaces |
| Affected ESLint for native transport/protocol/entry and channel tests | Exit 0, frontend unchanged after this run |
| `cargo fmt --manifest-path apps/tinker-rust/src-tauri/Cargo.toml -- --check` | Exit 0 after I1 repair |
| `cargo clippy --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --all-features --all-targets -- -D warnings` | Exit 0 after I1 repair |
| `bun run electron:build` | Exit 0, build only, production app not launched |
| `bun apps/tinker-rust/scripts/build-tools.ts` | Exit 0, ordinary arm64 bundle, build script passed its native-QA symbol exclusion gate |
| `bun apps/tinker-rust/scripts/build-tools-native-qa.ts` | Exit 0, separate arm64 QA bundle |
| `git diff --check` | Passed on implementation commits and final documentation delta |

Coverage includes the real FormalHost/original preload mutation lane and original ChannelForm DOM, exact receipt replay, revision conflict, unknown identity rejection, compacted drafts, compatible old snapshots, corrupt/future overlay rejection before writes, write failure/uncertainty, two-model selection, all-disabled backend state, accepted queues, Stop/close, reopen on a new port, discovery bounds/timeout/cancellation and no secret persistence. The I1 repair has four actual RED-to-GREEN regressions, followed by 144 unit, five channel, 20 platform and eight queue covering tests and the complete final suite.

Earlier passing suites before I1 are historical evidence only. One earlier complete Rust run was interrupted by transport loss and was not labeled successful. The final code was freshly checked after the repair. A synchronized probe-cleanup fixture replaced an earlier test race without relaxing its assertions.

## Actual native acceptance

The ordinary bundle and QA bundle are separate. Native operations used a fresh copied QA bundle with identifier `com.tinker.tools-native-qa`, app-local synthetic paths and the same original React workbench. All UI actions used normal CUA APIs. Read-only QA request metadata and synthetic log inspections corroborated the observations, and no scripted JavaScript UI driver was used.

| Step | Observed result |
| --- | --- |
| Open original settings and edit existing channel | Original form loaded current owned URL and synthetic key compatibility, without component/layout changes |
| English Test connection | Displayed “Connection and model catalog validated. No model turn was executed.” |
| Save Unicode name `Native channel — café 你好` and reopen form | List/form immediately showed exact saved name |
| Toggle the only model off | Existing form disabled Save and requested at least one enabled model. Re-enabled without changing that UI policy |
| Disable the channel | Durable overlay disabled, selected channel/model cleared together, original Send disabled and “No models available” shown. Zero recorded chat POSTs |
| Re-enable channel | Original known model selection restored |
| Switch to zh/dark and test/refresh | Correct Chinese success copy, dark form, one known catalog model and zero new models |
| Send synthetic conversation after settings changes | Actual original renderer → preload → Tauri → Rust → owned HTTP/tool chain completed after separate workspace_list/workspace_read approvals |
| Synthetic transport failure | Partial output and localized error remained visible. Restore Draft filled input without resending |
| Stream and Stop | Partial text retained with cancelled terminal status |
| Normal Cmd+Q | Owned process exited, verified independently by PID |
| Explicit reopen | Exact Unicode unsent draft, three-run history, metadata, selection, zh/dark restored. Zero automatic chat requests in the new process |
| Focused first paint after bootstrap | History visibly rendered without scrolling. Earlier baseline blank-paint observation not reproduced in this bounded recheck |
| New owned port after restart | Port changed, current derived connection test passed, no URL/port/key field persisted |
| Wrong loopback endpoint | Test failed, Save stayed disabled. Restoring owned endpoint passed |
| Final Quit and cleanup | QA process gone. Temporary system/display keep-awake assertions released after identity check |

Durable final native runs:

| Run ID | Status | Evidence |
| --- | --- | --- |
| `8201468a-272c-43d1-9222-3b14efd08f27` | completed | Two read-only tool approvals, successful synthetic reply |
| `5b45cb3d-a227-49e2-9fdb-de1494709da7` | failed / httpProtocol | Partial content retained |
| `08e01486-9f21-494c-a745-2837be4f94df` | cancelled | 256 JSONL records including terminal cancellation, partial output retained |

The separately tested immutable baseline is not relabeled as final-code acceptance. Its native queued interrupt/reload checks supplement the new exact-code automatic queue tests. Native forced crash, storage-fault injection, stalled-probe races, two-model GUI selection and every feature/window size were not run. No pixel-exact equivalence, complete product parity, true provider success or memory reduction is claimed. Native screenshots are in the execution conversation, not committed artifacts.

## Build identity and signing

| Bundle | Identifier | Architecture | Executable SHA-256 |
| --- | --- | --- | --- |
| Ordinary preview | `com.tinker.tools-preview` | arm64 | `d2e91da9c0e41cf39ed45c39712ab865d537d8c35aa4d3b4df47f2dc74e8c63a` |
| QA source bundle | `com.tinker.tools-native-qa` | arm64 | `984ec99a5241a48a3d41e6982b44550a4c24f0bdae6d7f40f77e2cfca9f3fbcf` |
| QA copied bundle with app-local test environment and renewed signature | `com.tinker.tools-native-qa` | arm64 | `a17003de82be414a797b4e5fc54af27705f17ac04f080e559371353b69543696` |

Both build bundles passed strict deep signature verification. They use ad-hoc signatures and have no stapled Apple notarization ticket. The QA copy matched its source executable before app-local Info.plist configuration and resigning. This is local development acceptance, not a distributable signed release or a new installer. No system security warning was bypassed.

## Review, protection and rollback

Independent whole-branch review found I1, then independently re-reviewed its committed repair. Final source verdict: zero Critical, Important or Minor findings, simplify/reuse/readability pass. Recovery uncertainty remains separate from resettable validation state. Test fault injection exists only beneath cfg(test), with no production fault IPC.

Baseline-to-implementation audit confirmed zero changes to production Electron main/preload, original React components/styles, production Vite/package entry, electron-builder configuration, dependency declarations/lockfiles, README, CLAUDE, hooks and GitHub workflows. The three package.json changes are automatic version-only hook changes. Native-specific transport and en/zh coded messages are intentional. The original dirty developer checkouts, independent Tinker 2, previous bundles, installed apps, real data and credentials were left untouched. Stale/prunable Git worktree registrations were not cleaned.

The synthetic overlay uses the existing private atomic platform store and receipts. Old snapshots without an overlay still open. Older readers fail closed on the new overlay rather than silently downgrade it. Preserve synthetic data and receipts if reverting, or launch a fresh synthetic root with the older preview. Do not rewrite a new snapshot into an old schema. Production rollback remains the unchanged Electron/SDK default and existing installed application. Revert this branch's commits through a normal reviewed change if necessary, without force-pushing or deleting user data.

## Remaining migration boundaries

General channel creation/deletion, secure real credential lifecycle, authorized real-provider smoke, images/attachments/general tools, legacy-data cutover, production rollout and measured performance remain separate milestones. No additional feature implementation is started by this report. Safe branch publication is Draft-only with exact remote head/base/check/status/Actions verification. A lack of CI records is not CI success. Do not merge, auto-merge, deploy or install from this task.
