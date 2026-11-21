# Credentialed text preview acceptance and rollback

**Status:** Source and supported automatic gates passed. Native-window acceptance is partial. Suitable for a Draft PR, not production cutover or a claim of full product parity.

**Base:** `6c333ccb735b28d87f5310d006d959b9877bb1d8` from merged PR #26.

**Tested source:** `20a225bb04eee0c8ce6c75fbb62d186fb883193d`, tree `3451e00b87fca31a4d0d9e778c96c59e18990207`.

## Delivered path

- The original React workbench and channel controls use the native preload adapter, Tauri dispatch, Rust platform/catalog authority, immutable runtime revisions and existing streaming codecs.
- A distinct opt-in credentialed host owns configuration and opaque credential references. The ordinary host uses the macOS helper adapter. The QA host accepts only two finite fake slots and its exact owned localhost service.
- Catalog probes are explicit authenticated GET operations. They never use model inference as a connection test. Rotation keeps an accepted run on its original lease while fresh sends acquire the current binding.
- Managed saved keys remain hidden. Blank retains the same binding, a changed endpoint/protocol requires replacement, and Show Key reveals only newly typed input. Unknown stage/final acknowledgements fail closed with bounded exact reconciliation and a narrow close/reload draft-capture path.
- The private same-image helper validates its parent and operation scope. A single bounded metadata worker keeps actor cancellation responsive. A stalled OS metadata call is not claimed to be forcibly terminated.
- New native reasoning defaults omit an explicit effort field. The managed Default label does not mean reasoning is disabled. Existing Electron defaults remain unchanged.

## Automatic evidence

| Source | Check | Observed result |
| --- | --- | --- |
| `dbe2fe642103396ea6486a50c994711471bc2133` | `cargo fmt --manifest-path apps/tinker-rust/src-tauri/Cargo.toml -- --check` | Passed |
| Same | `cargo test --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --all-features -- --test-threads=1` | 453 top-level passed, 0 failed, 2 dedicated child entries ignored at top level and invoked by parent tests, 45 targets |
| Same | `cargo clippy --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --all-features --all-targets -- -D warnings` | Passed |
| Same | `bun test` | 3,570 passed, 0 failed, 4 existing rg-integration skips, 424 files |
| Same | `bun run typecheck` | All six workspace checks passed |
| Same | Configured ESLint for 24 affected TS/JS files | Passed |
| Same | `bun run electron:build` | Passed |
| `20a225b` | Native-entry marker projection, 118 focused checks, six type checks, entry lint and normal commit hooks | Passed |
| `20a225b` | `channels:desktop:build` and `channels:qa:desktop:build` | Both completed with exit 0, arm64 bundles, correct distinct identifiers, ad-hoc deep/strict signature checks passed |

The full-suite controller exited 0. Its source is not relabeled as a full rerun on the final marker-only delta. The final delta projects `{ hydrated }` on the marker and updates two documents. Existing full and focused evidence is preserved under `migration-work/secure-channel-checks-20261117/`.

An earlier default-parallel Rust run had five formal-agent failures. No controlled comparison establishes their cause. The supported serial package command passed. Parallel execution remains unproven. Existing Jotai deprecation notices remain. The expected lost-ack test error is captured, asserted and restored.

## Additional publication-hook checkpoint

The first normal push hook at documentation head `a3a5b0f920466265227c68f2bc6152ab079511fa` passed all six type checks but failed one unchanged Python-packaging wrapper test at its existing 5-second timeout. Observed totals were 3,568 passed, 5 skipped and 1 failed across 424 files. `spawnSync` returned a null status after the runner killed the timed-out test. The hook stopped the push with exit 1. No hook was skipped.

Both `optional-python-payload.ts` and its test are byte-identical to the base. A focused diagnostic using the same synthetic config/runtime environment as the earlier supported full check passed both tests with the original timeout, including the wrapper case in about 2.84 seconds. This does not prove the full-run failure's cause or make every timing configuration green. No timeout, assertion, hook or implementation was changed.

Publication remains conditional on a fresh complete normal hook. Its final outcome belongs to the PR's exact-head validation record. An unpassed hook must leave the branch local. The supported serial Rust and earlier full Bun evidence above retain their own source/run identities.

## Actual native-window observations

The tested app was an independent `com.tinker.channels-native-qa` arm64 copy, with a fresh strictly marked QA root and no installed-app replacement. Its input binary before environment preparation was SHA-256 `d14d70ff25a8b9508e4187f5893ae06508140ab92522b8022cad07e20b0943ef`. The configured and ad-hoc re-signed executable was SHA-256 `9b8fe5a6b4ab6b09edd8c8587340fd57d6ab839d399e6d766f70815f0fce6835`. The ordinary preview was assembled and structurally audited, not launched against a real vault.

| Native step | Observed outcome |
| --- | --- |
| Fresh startup | Original workbench rendered. No configured models. Send disabled. GET 0 and POST 0 |
| OpenAI channel | Original form, exact owned loopback URL, finite fake key, explicit Test/Refresh, enable returned model, final Test, explicit Save |
| Probe scope | Three explicit GETs before first save, no model POST. Opening/editing/saving did not add an automatic inference request |
| Saved credential display | Reopened edit showed stored-presence placeholder and blank input. No stored-key reveal was used |
| First and continued OpenAI sends | Visible incremental text followed by completion in the same conversation. Chinese input preserved. Byte-split UTF-8 output is automated coverage, not claimed from this ASCII fixture response |
| Rotation during active A | Sequence 6 accepted POST with key version 1. While A remained active, sequence 7 explicit GET used version 2 and a new channel revision was saved. A completed on version 1. Fresh C, sequence 8, used version 2 |
| Stop | Sequence 9 cancelled. UI retained the visible partial response and showed user-aborted status |
| Abnormal disconnect | Sequence 10 recorded partial disconnect. UI kept the text and a static recoverable error |
| Restore draft | Restored the failed draft into the editor without another POST. The following failure scenario was an explicit new send |
| Controlled HTTP failure | Sequence 11 returned the controlled failure. UI retained conversation and recovery controls without displaying a raw response body |
| Disable old channel | Original switch showed disabled. Model selector dropped the disabled selection and Send stayed disabled until another model was chosen |
| Anthropic channel | Original form and explicit catalog GET/Test, explicit Save, original model menu, streamed request completed as sequence 14 |
| Language and appearance | English/light workbench and Chinese/dark channel form were visually observed. New safety text resolved in Chinese with no raw translation keys in inspected controls |
| Quit and reopen | Normal Cmd-Q ended the original owned PID. Unsent draft was found in the isolated snapshot. Reopen restored exact draft, selected channel, current history, two recent sessions, Chinese and dark appearance |
| No replay on reopen | GET remained 6 and POST remained 8 through reopen and final quit. Unsent draft was not sent |
| Cleanup | Final normal Quit, no owned QA PID, no active mock handler, bounded display/system keep-awake PID released and both owned assertions absent |

Final parsed HTTP counters were GET 6, POST 8, key-version-1 POST 3, key-version-2 POST 5, unauthorized 0, cancelled 1, partial disconnect 1, completed 12 and active handlers 0. These counters describe parsed owned HTTP requests, not every socket arrival. The bounded nonsecret event log and preparation/signature/lease records remain in the external evidence directory.

Screenshots of the original light workbench and Chinese dark form were observed through CUA in the development conversation. The tool did not provide a reusable local screenshot file or public image URL. No screenshot URL or attachment has been invented.

## Native gaps and tool limitations

- Some AX clicks did not activate controls. Coordinate input repeatedly returned `Computer Use server error -10005: noWindowsAvailable`. One observation also returned ScreenCaptureKit error `-3812`. Reselecting the same running app allowed the model-menu step to complete, but did not make every path reliable.
- The delete-channel button did not show its expected confirmation during attempted UI checks. Source still uses the existing `confirm` path. Without reliable input or a captured confirmation result, neither successful deletion nor a product-code cause is established. Native deletion/history-after-deletion is unaccepted and needs a direct follow-up.
- Switching to the older recent-history row after reopen did not reliably activate through the tool. The current history, previous-session entries and exact unsent draft were visibly restored, but the older-history navigation gate remains unaccepted.
- Native queued B was not tested. This host advertises `queueing: false`. Accepted A/B revision and exact-retry semantics are automated Rust coverage, not native UI evidence. The attempted C send occurred after A completed and is recorded only as a fresh send.
- No crash/forced-kill native recovery, actual Tauri IPC acknowledgement loss, or ordinary real-vault window was exercised. Existing automated fault/process tests retain their own scope.

## Independent review and protection

All three task source reviews and the final whole-branch source/simplification review approved the tested source. The broad review found 0 Critical, 0 Important and 2 Minor items. One is a future reuse opportunity for a duplicated decoded-secret predicate. The other is the explicitly unresolved parallel-test limitation above. No source fix is implied by documenting those items.

The final structural audit found no changed production main entry, preload entry, resources, default configuration, lockfiles, licenses, README or CLAUDE. Three allowed preload boundary files changed and received semantic review. Original renderer components include explicit managed-mode logic changes, so the whole renderer or preload is not described as zero diff. No CSS was changed. The old Electron default runtime and installed application were not switched. Real settings, credentials, sessions and original dirty worktrees were not modified by this stage.

## Unexecuted real-service gates

- No actual Keychain item lookup, write or delete, positive OS item exchange, real ACL/entitlement/denial/lock behavior
- No real user keys, existing credential import, real conversation content or persistent user-access expansion
- No public DNS/TLS/provider interoperability, controlled trusted-TLS service, real model, paid call or provider billing measurement
- No production switch, installation, release, complete product parity or whole-machine memory claim

Before a live smoke test, identify the service and URL, model, exact synthetic request, credential-use method and spending cap. Test OS storage separately from paid inference. Do not treat a general migration request as authorization for those operations.

## Rollback and next gates

1. Quit only the isolated preview and preserve its marked root for inspection. Continue using the unchanged installed Electron application.
2. Before merge, abandon the feature branch or revert this stage on a new safe branch. After a manual merge, use a normal reviewed revert commit, not history rewriting.
3. Do not copy the credentialed root into old roots or the production config directory. Preserve root-marker rejection and historical metadata. Deleting a channel is not proof that its retired vault item was erased.
4. Complete reliable native deletion/old-history navigation and controlled credential-recovery checks. Then perform separately authorized OS-vault and bounded live-service smoke tests before production enablement.

This report records a reviewable isolated migration increment. It does not declare the new stack or full MVP accepted.

### Follow-up on November 22 — channel removal and Recent history

The acceptance run used the macOS arm64 channels QA bundle built from the PR #27 merge tree plus the renderer fix in this change. The fixture used the owned loopback provider, test vault, and two synthetic conversations. A verified copy of that fixture was retained before testing deletion.

- The original window validated the local catalog, saved its provider, and received a streamed reply in each conversation. Selecting the older Recent row restored its distinct prompt and completed reply. The original Delete action did not present an actionable confirmation in this window.
- With the managed-channel fix, Delete opened an accessible dialog naming the provider, initially focused on Cancel. Esc preserved the row and returned focus to its Delete button. Opening the dialog again and confirming removed the row and focused Add provider.
- After quitting and relaunching the fixed bundle with the same fixture, the composer reported no available model. Both synthetic prompts and their completed replies could still be read using Recent.
- The focused component tests cover cancellation, confirmation, focus, and the legacy Electron confirmation path. The full Bun suite finished with 3,571 passes and five skips. Workspace typechecking, the Electron build, and the signed native QA bundle build succeeded. This follow-up changed renderer code and tests only, apart from this report and the normal package-version update.
- The real Keychain, live model calls, abrupt process termination, lost IPC acknowledgments, and secure erasure were outside this native run. The production entry point remains the existing Electron app. This fix can be reverted independently.
