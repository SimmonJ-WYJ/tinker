<a id="rust-lab-离线执行闭环验证与回滚"></a>

# Rust Lab offline run-loop validation and rollback

Baseline `94dad45fff5b2220b89d9d5bedce28df9a9590bf`, branch `feat/rust-offline-run-loop`, workspace `/private/tmp/tinker-rust-runloop-20261109`. Only the isolated experimental path is migrated; this does not mean production executor migration is complete.

<a id="本轮实现"></a>

## Implementation this round

- Rust provider interface and sole OfflineFixture adapter; success/failure/slow scenarios involve no model, network, shell, or paid calls.
- One active thread, requestId/runId deduplication, conflicting-parameter rejection, cancellation tokens, and isolation of late fragments after terminal state. Normal ~150ms/fragment, slow ~1 second/fragment, cancellation checks every 5ms.
- Rust Lab's own `app_local_data_dir()/runs-v1`, single-writer lock, restricted IDs, symlink/hardlink rejection, private permissions. Independent JSONL source of truth, atomic snapshot cache, and durable createdOrder prevent selecting the wrong latest run when mtimes coincide.
- Startup metadata header ≤512KiB, input ≤65536 UTF-8 bytes; ordinary events 16KiB, output 256KiB, 4096 events, per-run log 4MiB; all caps apply together. Header-only crashes recover directly as interrupted without inventing provider startup.
- Persist before host acknowledgement; fail explicitly on uncertain storage and block false-success retries. Truncated logs show read-only recovery; corrupt middles/future versions reject overwrites. Restart restores in-flight execution as interrupted and never automatically runs a provider.
- Three independent Tauri commands: start_lab_run, cancel_lab_run, read_lab_run; file work via spawn_blocking; no frontend paths, URLs, or models accepted.
- React offline panel, strict protocol and generation isolation, nonoverlapping 100ms cursor reads, cancellation, failures, stale responses, repeated clicks, and safe retries; after recovery, show original run input and partial output independently, with fixed Chinese/English errors, leaving current draft unchanged.
- Old submit_draft still returns modelNotMigrated; draft schema and read-only history API retained. Production Electron/shared/core/ui/dependency lockfiles unchanged.

<a id="实际通过"></a>

## Actual passing results

| Check | Result |
| --- | --- |
| Original Rust baseline | 63 passed, 0 failed |
| Full Rust tests | 90 passed, 0 failed, including original tests, 22 new core tests, 5 IPC tests/subprocess fixtures |
| Real Tauri handler | Real parameter decoding and response serialization, covering success/pagination/deduplication/failure/cancellation/error codes |
| Real process-crash recovery | Child test process starts a slow run through the real handler, exits without destructors after fragments persist; new host restores interrupted, retains input/fragments, and does not automatically advance sequence |
| Rust quality | cargo fmt --check, clippy --all-targets -D warnings passed |
| Lab frontend | 30 tests, 230 assertions, 0 failed; typecheck, Vite build passed |
| Repository-wide Bun | 3376 passed, 4 skipped, 0 failed, 380 files, 8916 assertions |
| Repository-wide typecheck | 6 workspaces exited 0 |
| Lab ESLint | Temporary configuration reusing original rules covered Lab; max-warnings=0 passed; production eslint configuration unchanged |
| Electron build | electron:build exited 0 |
| Independent review and simplify retrospective | Important findings fixed and rechecked; no remaining confirmed important issues |
| Native QA build | Tauri release arm64 .app built; codesign --verify --deep --strict passed |

The 4 repository-wide skips belong to existing papers-rg-tool bundled-rg binary integration tests; the reused dependency directory lacks that binary. No tests or production dependencies were changed to hide skips. All new tests this round executed.

Behavior tests failed before implementation. Independent review found and fixed nested runs-v1 paths, permanent queued state after failed acknowledgement following header creation, incorrect latest-run recovery on mtime collisions, invisible recovered input, and missing frontend validation of identity/continuous sequence/event semantics/start-response binding. Corresponding regressions were added and passed.

<a id="原生验证的准确边界"></a>

## Exact native-validation boundary

Independent QA artifact `/private/tmp/tinker-rust-night-target/release/bundle/macos/Tinker Rust Run QA.app`; Info.plist and compiled binary both verified identifier `com.tinker.rustlab.runqa.20261109`, arm64, temporary adhoc signing, no Apple notarization. Not copied or installed into Applications, not launched, no real user sessions or credentials read/written.

Desktop-tool preflight explicitly reported a locked Mac, preventing native-app operation. No nighttime unlock request, automatic unlock, password/lock-screen/global-power changes, or presentation of mock-runtime/DOM tests as real WebView acceptance.

**Not run: success, cancellation, failure, restart-recovery flows in native UI and manual bilingual/theme review; corresponding native screenshots are absent.** Only the Rust/Tauri handler loop, frontend automated tests, and native build can currently be considered passed. Draft PR retains these acceptance items; do not claim full native-loop or complete production-compatibility acceptance.

<a id="资源和保护"></a>

## Resources and protection

Reused `/private/tmp/tinker-rust-night-target`, without parallel Cargo cache contention, cargo clean, or user-file deletion. Cache ~3.2GiB→3.7GiB; new workspace ~126MiB (node_modules points only to existing dependencies); observed batch growth ~0.65GiB, within the 3GiB budget. Global free space varied 8.8–10GiB; new builds stop below 4GiB, not triggered this round. No native-app RSS measurement or promise of lower whole-machine memory.

No changes to old source, old ASCI copies, packaging-worktree source, installed version, keys, or real sessions. Original source status remains unknown and is not considered clean; existing hung Git processes were untouched. Temporary caffeinate served only this bounded batch and was released afterward.

<a id="发布判断及回滚"></a>

## Publication decision and rollback

The isolated offline Lab, zero production-code differences, all executable new automated checks, and independent review passed, making this suitable for a **Draft PR for review**, with native UI acceptance still pending. No merge, auto-merge, deployment, DMG creation, or installed-version replacement. Final remote SHA/CI depend on actual verification; a pending state with 0 checks is neither running nor green CI.

Rollback only reverts this batch's commit on the independent branch and runs normal tests. Old draft commands/session files/history-v1 need no reverse migration; runs-v1 is independent experimental data and is not deleted on rollback. For precise disablement, remove RunPanel mounting and run_commands registration, retaining original draft/history capabilities. Real providers, permissions, models/tools, real background tasks, and production switching remain future work outside this round.

Main local logs are in `/private/tmp/tinker-runloop-checks-20261109`: baseline-rust.log, ipc-red.log, rust-final.log, clippy.log, typecheck.log, lint.log, bun-final.log, electron-build.log, native-build.log. Logs are not committed; the report includes no real user records.
