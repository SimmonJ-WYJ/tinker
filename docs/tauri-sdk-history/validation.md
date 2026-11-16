<a id="tauri-sdk-历史接线验证与回滚"></a>

# Tauri SDK Historical Wiring Validation and Rollback

Baseline main: `fdf92f3bb758d04c6f469fe8915d62e41a15f36b`. This phase wires only history reading in isolated Rust Lab, without production Electron, models, tools, or background tasks.

<a id="生产不变与实际范围"></a>

## Unchanged Production and Actual Scope

Additional user request (English translation): "After this change, make sure the interface, functionality, and UI have no changes, right?"

- Production `apps/electron`, `packages/shared`, `packages/core`, `packages/ui`, and `bun.lock` have 0 differences from baseline and no new files
- New reading area, styles, copy, and commands belong only to experimental `apps/tinker-rust`, outside Electron entry/installed app
- Fingerprints of all 89 uncommitted files in the original development directory remain unchanged; no user work overwritten or cleaned
- Commit hooks may update root and Rust Lab package versions; otherwise no production dependency/version changes
- Passing existing production-related tests does not mean every installed-app interaction received itemized on-device acceptance, and cannot guarantee untested flows or pixel equivalence

<a id="调用链"></a>

## Call Chain

React HistoryPanel → `window.__TAURI__.core.invoke('read_session_history')` → separate Rust command → `spawn_blocking` → HistoryLibrary → bounded SDK/legacy scanner → strict frontend response decoding → safe text reading.

The command accepts only `sessionId`, `beforeLine`, and `limit`, never file paths. Backend reads only its own `app_local_data_dir()/history-v1/<sessionId>.jsonl`. Default 64 records, max 256, 1MiB per line, 8MiB source-line budget per page, retaining source-line cursors. Shared try_lock gating returns a fixed error when busy, without stacking decoders.

Raw SDK and legacy messages can mix. Original JSON is fully retained, including uuid, parent_tool_use_id, tool inputs/results, thinking signatures, image references, model metadata, and unknown future types. text extracts only top-level text blocks/string bodies, never tool_result internal text as user body. SDK user allows valid missing message/content; malformed shapes are explicitly rejected. UI provides safe text preview only, with structured-record notices; no tool execution, raw-file loading, or HTML rendering.

<a id="已通过"></a>

## Passed Checks

| Check | Actual result |
| --- | --- |
| All Rust tests | 63 passed, 0 failed, including existing draft/history/lifecycle and SDK/host/IPC regressions |
| Tauri InvokeRequest chain | Actual-handler parameter decoding, async service, JSON response serialization, and fixed error codes verified through mock runtime |
| New SDK tests | 12 passed; original 14 legacy-reader tests retained and passing |
| Frontend src tests | 15 passed, including original contract and new parser/UI tests |
| Repository-wide Bun | 3211 passed, 0 failed, 362 files, 44.64 seconds |
| Focused production regressions | 42 passed, 0 failed, 11 files, covering session navigation/message rendering/images/tool display/attachments |
| Types and builds | Full-project typecheck, Rust Lab Vite build, Electron build passed |
| Rust quality | fmt check, clippy all-targets -D warnings passed |
| Frontend lint | Temporarily extended existing ESLint rules read-only to 7 relevant Rust Lab TS/TSX files; max-warnings=0 passed, production configuration unchanged |
| Complete native build | Separate-QA-configuration Tauri release `.app` built successfully, without release or installed-app replacement |
| Actual native interaction | Described below, using actual Tauri bridge rather than mocked frontend invoke |

Failing tests preceded implementation. Initial compilation failed because frontendDist was missing; after building the frontend, expected SDK/host absence failures appeared. Missing/string user compatibility also has separate red-then-green records.

<a id="独立原生验收"></a>

## Independent Native Acceptance

QA identifier `com.tinker.rustlab.historyqa.20261108`; verified both bundle identifier and compiled-binary identifier before launch. New QA directories separate from active apps contain only 150 synthetic SDK records. No active Tinker/real Rust Lab history reads or copied user logs.

- Native UI shows Rust connected
- Expanding read-only history returns source lines 87–150, 64 records
- Earlier page reads 23–86; latest page returns 87–150
- Switching to missing session shows localized missing-file notice
- Restoring history session allows reading again
- Switching parent UI to English updates history labels/buttons/explanations
- Synthetic JSONL SHA-256 identical before/after reading
- This batch cleaned up its QA process without affecting current Tinker

![Native reading position for synthetic SDK history](native-history.png)

![Same synthetic history in the English interface](native-history-en.png)

Screenshots contain synthetic data only, from a separate QA app; they do not establish production-UI acceptance.

<a id="失败恢复与未运行"></a>

## Failures, Recovery, and Unrun Scope

Initial debug QA build failed with ENOSPC; concurrent repository tests had 3178 passed, 33 failed, with logs proving insufficient space for temporary files. This was not treated as passing. After releasing only this batch's failed QA build cache and regenerable synthetic large inputs verified against established digests, retaining source, measurements, fingerprints, and generators, existing release cache completed QA building. A full Bun rerun then had 3211 passed, 0 failed. No user directories, installation, or real data cleaned.

Not run/implemented: Installed-app full-flow on-device regression, real-user log import, actual SDK/tool execution, background cancellation/reconnection/rewind, rich image interaction migration into Rust Lab, Windows/Linux native operation, complete defense against malicious same-system concurrent file replacement, stable cursors across file rewrites.

This phase did not quantify SDK-adapter or whole-app peak memory. Source-line budgets are not parsed-heap limits, and prior reader measurements cannot establish whole-machine improvement. Every page still scans the file prefix.

<a id="使用与回退"></a>

## Usage and Rollback

The prototype never automatically seeks production history. Only with existing authorization may a user place copies of selected logs in Rust Lab's separate `history-v1` directory, named with a restricted ID plus `.jsonl`, and enter that ID in the reader. Never commit original user logs to Git or overwrite original app files. Current acceptance uses synthetic copies only.

- Before merge: Keep/close this Draft; main and current installation remain unchanged
- Post-merge code rollback: Review and revert this PR's merge commit on a separate branch, test normally, use a PR; no reset/clean in the user's development repository
- Precise disablement: Remove history state/command registration from main.rs and React HistoryPanel mounting, restoring prior draft-only Rust Lab validation; old snapshot/save_draft/submit_draft/recover_draft commands and draft schema remain
- History is read-only, without migration, rewriting, repair, or deletion; rollback needs no reverse data-format conversion and should not delete history copies
- Actual Tinker installation and original user workspace were never replaced in this phase

<a id="复现主要检查"></a>

## Reproducing Main Checks

```sh
bun run --cwd apps/tinker-rust build
CARGO_TARGET_DIR=/tmp/tinker-history-check cargo test --offline --locked --manifest-path apps/tinker-rust/src-tauri/Cargo.toml
CARGO_TARGET_DIR=/tmp/tinker-history-check cargo clippy --offline --locked --all-targets --manifest-path apps/tinker-rust/src-tauri/Cargo.toml -- -D warnings
cargo fmt --check --manifest-path apps/tinker-rust/src-tauri/Cargo.toml
bun run typecheck
bun test
bun run electron:build
```

Offline Cargo checks require cached dependencies. Native QA needs a separate identifier, never current app data for smoke testing. Original command logs, detailed reports, environment failures, and production-unchanged assertions stay in local Tinker-A diagnostics; do not commit local paths/logs/build artifacts.
