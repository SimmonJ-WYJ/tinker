<a id="rust-会话回放阶段实施计划"></a>

# Rust Session Replay Phase Implementation Plan

Status: local implementation and validation complete, preparing an independent Draft PR. An isolated technical migration batch authorized by the user. Baseline main `a371b7f409f1e34a88bba4411694c95af923c86c`. Domain sources of truth: existing `tinker-rust-session-persistence.md`, Electron `AgentMessage` JSONL, and this specification. Related PR: create only a Draft after validation, without merging.

<a id="目标与边界"></a>

## Goals and Boundaries

Reuse the Rust/Tauri/React foundation to provide verifiable read-only historical replay and an execution-state model for later session migration, without connecting real user data or models. Existing draft commands, schema, production Electron, image interactions, and permission policies remain unchanged.

Approach: this batch uses a streaming read-only Rust adapter and a pure state machine. Directly importing real history or replacing Electron storage requires full SDK/permission/tool compatibility, for which evidence is currently insufficient, so these are excluded. This phase adds no Tauri commands, frontend features, or data paths.

<a id="全局约束"></a>

## Global Constraints

- Do not read or migrate `.asci`, Tinker Candidate, real sessions, or keys
- Do not replace the installed version, restart user tasks, or change old worktrees
- Add no dependencies; retain the Rust 1.89 floor, Tauri 2, serde/serde_json lockfile, and React/TypeScript
- Implement after 00:00 local Beijing time; stop starting new work at 02:00
- JSONL is read-only: do not repair, truncate, or append source files; errors contain no user content
- Support only simplified `AgentMessage` JSONL; do not claim compatibility with raw SDK logs or all Electron capabilities

<a id="task-1有界历史回放"></a>

## Task 1: Bounded Historical Replay

Files: add `src-tauri/src/session_history.rs`, `src-tauri/tests/session_history.rs`, and export the module in `lib.rs`.

Interface: `read_history(reader: impl BufRead, options: HistoryOptions) -> Result<HistoryPage, HistoryError>`. `HistoryOptions { limit, before_line }`, default 64 entries, maximum 256, maximum line 1MiB, retaining at most 8MiB total source lines per page. Pages of large messages may be shorter and continue through a cursor. Cursors are one-based source line numbers, returning the line before the next page without copying the whole file. The caller must use the same append-only file; cross-snapshot cursors after source rewrites are outside this phase's guarantees.

- [x] Tests first: empty files, Unicode, all four roles, model and unknown fields, pagination order/no duplicates, bad lines/future shapes, incomplete trailing lines, oversized lines, and read errors
- [x] Verify the expected missing-module failure, then implement a queue retaining only the latest limit entries, bounding line bytes before parsing
- [x] Read valid entries without final newlines normally; report `incomplete_tail` for a syntactically unfinished final line; reject the entire page for middle corruption or invalid semantics, without silently skipping
- [x] Preserve unknown JSON-field semantics without rewriting originals. Strictly validate required ID/role/content/createdAt fields; timestamps must fit JS safe integers

<a id="task-2可中断状态模型"></a>

## Task 2: Interruptible State Model

Files: add `src-tauri/src/session_lifecycle.rs`, `src-tauri/tests/session_lifecycle.rs`.

Interfaces: `RunState::queued(run_id)`, `apply(run_id, RunEvent)`, and `restore()`. States queued/running/waitingInput/completed/failed/cancelled/interrupted; events start/waitForInput/continue/complete/fail/cancel/interrupt. Reject mismatched run IDs, invalid transitions, and terminal reentry while retaining the prior state. Restore running/waitingInput as interrupted without automatic execution, charges, or side-effect replay. This model is a migration contract and does not control real background processes.

- [x] First write queued→running→waitingInput→running→completed, cancellation, crash recovery, old-run rejection, and serialization tests, and confirm failure
- [x] Implement pure state transitions, safe decoding/recovery of v1 persisted snapshots, and rejection of future schemas
- [x] Exhaust all state/event combinations to prove failures preserve state and terminal states cannot continue

<a id="task-3可复现测量与兼容检查"></a>

## Task 3: Reproducible Measurements and Compatibility Checks

Files: add an offline measurement example and script; document them in `docs/rust-session-replay/validation.md`.

- [x] Fix synthetic JSONL size/content and release-build the same reader; whole-file buffering and streaming file reads both output the same historical-page digest
- [x] Run each strategy at least 3 times; record maximum RSS and elapsed time with macOS `/usr/bin/time -l`, explicitly comparing parsing paths rather than whole-system Electron/Tauri benefits
- [x] Rust fmt/test/clippy, Rust Lab frontend typecheck/build, repository-wide typecheck/test, and Electron build using isolated fixtures
- [x] Review diff, credential patterns, and licensing boundaries; verify old draft tests still pass and record rollback/unaccepted checks
- [ ] Only after passing, submit a separate branch and Draft PR through the project workflow; verify remote SHA and checks for that SHA without bypassing hooks/branch rules

<a id="回滚与剩余兼容"></a>

## Rollback and Remaining Compatibility

This phase only adds library modules, tests, and measurement tools; modules and exports can be removed file by file without changing draft v1 structures or the current installation. Old workspaces and user uncommitted changes remain untouched. SDK messages, projects, channels, tools, paid confirmations, reconnection, rewind, actual background cancellation, window resource management, and complete native interaction are not migrated; do not claim functional replacement or an overall memory reduction.
