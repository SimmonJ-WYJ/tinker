<a id="rust-lab-离线执行闭环实施规格"></a>

# Rust Lab Offline Execution Loop Implementation Specification

Status: isolated loop implemented, automated checks passed; native UI blocked by the lock screen, awaiting Draft review. Baseline main 94dad45fff5b2220b89d9d5bedce28df9a9590bf. Changes allowed only in apps/tinker-rust, this document, and the validation report; package versions follow hooks. Started at 00:10 Beijing time, implementation wrapped up at 01:25, with no new implementation or long builds after 02:00.

<a id="目标和边界"></a>

## Goals and Boundaries

Reuse the existing Rust Lab without creating a second project. Implement offline execution for the default experimental session, incremental output, request deduplication, cancellation, retention on failure, JSONL events and snapshots, and recovery as interrupted after restart. Do not connect models/tools/networks/keys/real sessions/production Electron/installations. Existing submit_draft remains modelNotMigrated; existing draft schema and read-only history remain unchanged. UI explicitly labels offline testing and does not claim real-model success.

<a id="协议camelcase-jsonprotocolversion1"></a>

## Protocol (camelCase JSON, protocolVersion=1)

- RunSnapshot: runId, requestId (same restricted ASCII ID, 1..64), providerKind='offlineFixture', scenario (success/failure/slow), input, output, status (existing RunStatus), sequence (safe nonnegative integer), errorCode (string|null), recoveryRequired (boolean).
- RunRecord: protocolVersion, runId, sequence, kind (started/delta/completed/failed/cancelled/interrupted), text (string|null), errorCode (string|null); the first persisted entry is a separate metadata header (input/requestId/scenario, capped at 512KiB and included in the total 4MiB log budget). It is not a public RunRecord and is not emitted externally. Normal started begins at sequence 1; header-only crash recovery records interrupted directly at sequence 1 without inventing a start, enabling independent recovery and compatibility with 64KiB input.
- RunEventPage: protocolVersion, snapshot, events, nextAfterSequence, hasMore. Default page size 64, maximum 256; cursors cannot exceed the snapshot sequence; reject unknown protocols/invalid shapes.
- start_lab_run(requestId,input,scenario)→RunSnapshot. scenario permits only success/failure/slow; clients cannot supply addresses/paths/models. Identical requestId and parameters return the same run without rerunning; same ID with different parameters conflicts. Retain the input limit of 65536 UTF-8 bytes.
- cancel_lab_run(runId)→RunSnapshot; repeated cancellation is idempotent, and late deltas cannot overwrite a terminal state.
- read_lab_run(runId?,afterSequence?,limit?)→RunEventPage; omitting runId reads the latest run; absent runs return runNotFound.

The frontend uses existing invoke for bounded cursor reads, about every 100ms while running, with only one read at a time; stop at terminal state or unmount. This is not real-model SSE. Reuse the existing bridge with no new JS dependencies; preserve input and partial output on failure, and isolate late responses from old runs by request generation.

<a id="rust核心"></a>

## Rust Core

- run_provider.rs: replaceable provider trait, with OfflineFixture as its only implementation; no network or shell access. Normal output, failure after deltas, and cancellable slow scenarios are all explicitly offline.
- run_store.rs: fixed Rust Lab app_local_data_dir()/runs-v1, single-writer lock, restricted IDs, and symlink checks; append-only JSONL is the source of truth, and snapshots can be rebuilt atomically. Separate from session-store-v1/history-v1; do not insert it into old draft records.
- run_controller.rs: one active run, bounded queues/output memory, cancellation token, persist before acknowledging events; never pretend completion on storage failure. Recover old inflight runs as interrupted on startup without calling the provider automatically. runId binds a unique requestId; repeated clicks and resubmission after restart do not generate a second run.
- Maximum event size 16KiB, output 256KiB, 4096 events, and 4MiB log per run (stop on reaching any limit). Pages are capped at 256; never send all historical events to the frontend at once.

<a id="实施清单与文件所有权"></a>

## Implementation Checklist and File Ownership

- [x] Implement provider/store/controller after Rust behavior red tests, reusing session_lifecycle. Add these modules, run_types.rs, and independent tests; lib.rs only exports modules.
- [x] Wire real Tauri handlers and InvokeRequest regression: run_commands.rs, main.rs; preserve old command semantics.
- [x] React strict decoding, one-read-at-a-time polling, stale-response handling, bilingual RunPanel, and tests. main.tsx mounts only the isolated experimental panel, retaining existing drafts and history.
- [x] Failure regressions: normal/failure/cancel/duplicate/cancel race/old-run isolation/storage failure/corrupt middle and truncated tail/future version/restart recovery, independent of real user files.
- [x] Final fmt/test/clippy, frontend types/tests/build, repository typecheck/test, Electron build, independent review, and zero differences in production directories.
- [ ] Native QA with an independent identifier, validating success/cancel/failure/restart recovery with synthetic data. Do not bypass the lock screen; state unrun checks explicitly.
- [ ] Commit to a safe branch with normal hooks; push a Draft PR only after all checks pass. No force-push/merge/deploy/install; verify the specific SHA and actual CI count.

<a id="资源与回滚"></a>

## Resources and Rollback

Reuse /private/tmp/tinker-rust-night-target after confirming no concurrent use; Cargo dependencies remain offline and locked. Keep new growth ≤3GiB where possible; stop new builds below 4GiB free space. Do not clean user directories or create a DMG. Do not run commands concurrently against the same Cargo cache. Temporary caffeinate covers only this batch and is released afterward.

Rollback only reverts this batch's commits or removes experimental panel/command registrations; current Electron and installation remain unchanged. runs-v1 is independent new experimental data and is neither deleted on rollback nor used to migrate user history. Unmigrated capabilities remain labeled unmigrated. Do not promise lower whole-machine memory use; resource measurements describe only this offline Rust Lab.

Actual evidence, native-UI checks not run, resource use, and rollback are in the [validation report](../reports/2026-11-09-rust-offline-run-loop-validation.md).
