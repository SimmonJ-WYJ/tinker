<a id="rust-会话回放验证测量与回滚"></a>

# Rust Session Replay: Validation, Measurement, and Rollback

Baseline main `a371b7f409f1e34a88bba4411694c95af923c86c`, separate branch `feat/rust-session-replay`. The user-scheduled implementation window was Beijing time 2026-11-08 00:00–02:00; this phase started after 00:00 and wrote no source code into the old workspace.

<a id="交付范围"></a>

## Delivery Scope

- `session_history.rs`: reads simplified AgentMessage JSONL read-only, paginating by source line number; default 64 entries, maximum 256, at most 1MiB per line, and at most 8MiB total retained source lines per page. Large-message pages may return fewer than requested, continuing by cursor without record loss
- Unknown metadata retains JSON semantics. Blank lines retain cursor positions; valid final lines without newline remain readable; unfinished JSON/UTF-8 tail lines are flagged separately. Invalid JSON, invalid UTF-8, raw SDK message shapes, invalid fields, and read failures reject the entire page rather than becoming empty history
- `session_lifecycle.rs`: pure queued/running/waitingInput/completed/failed/cancelled/interrupted contract, validating runId and legal transitions. Recovering incomplete execution only marks it interrupted without automatic replay
- The same synthetic JSONL is accepted jointly by TypeScript AgentMessage type tests and Rust parsing tests
- No new Tauri commands, UI, or production-storage entry points; existing draft schema and four commands stay unchanged. This is not a full SDK or background-execution migration

<a id="检查证据"></a>

## Check Evidence

| Check | Result |
| --- | --- |
| All Rust tests | 44 passed, 0 failed, including 25 existing draft tests, 14 history tests, and 5 lifecycle tests |
| Rust fmt | Passed |
| Rust clippy all-targets -D warnings | Passed |
| Rust Lab frontend build | Passed |
| Project-wide TypeScript typecheck | Passed |
| Repository-wide Bun tests | 3200 passed, 0 failed, 359 files |
| Electron build | Passed |
| Tauri/Rust desktop executable compilation | Passed, without launch or installation |
| Python measurement script | Syntax check and real offline execution at both scales passed |
| ESLint | Existing configuration does not cover Rust Lab test files and reported ignored; no lint-pass claim. Rust is guarded by clippy and TS by project-wide typecheck |

Tests first confirmed failure from missing modules, then passed after implementation. UTF-8 truncation and invalid-JSON-prefix counterexamples found in review also failed before fixes. Regressions cover every byte truncation position of complete Chinese/emoji records, the stop position for oversized-line reads, and faithful pagination of large messages.

<a id="内存与耗时"></a>

## Memory and Duration

Same release Rust binary, parser, synthetic files, and 64-entry result pages. streaming uses BufReader; buffered reads the entire file into Vec before using the same parser. Each strategy runs 3 times in alternating order; page digest, count, and cursor must match. macOS `/usr/bin/time -l` maximum RSS is measured in bytes; the table shows medians.

| Records | Input size | Strategy | Median maximum RSS | Median parsing duration |
| --- | --- | --- | --- | --- |
| 10,000 | 11.85 MiB | streaming | 2.11 MiB | 14.38 ms |
| 10,000 | 11.85 MiB | buffered | 13.97 MiB | 14.91 ms |
| 100,000 | 118.58 MiB | streaming | 2.20 MiB | 135.36 ms |
| 100,000 | 118.58 MiB | buffered | 120.81 MiB | 144.48 ms |

This compares reader input strategies, **not whole-machine Electron versus Tauri memory**, app cold starts, idle usage, concurrent sessions, or window-close measurements. Neither strategy starts WebView or a model. OS caches were not forcibly cleared, so timing is not a cold-cache performance conclusion. Page budgets limit source-line bytes; parsed Values/unknown arrays add overhead, so this is not a strict 8MiB heap limit.

Result JSON records every observation, input/binary SHA-256, rustc, system, architecture, and Python version. Raw time logs remain in local project diagnostics; neither the 124MB synthetic file nor build artifacts are committed. The first time call in the restricted sandbox could not query kern.clockrate; only results rerun with required permissions were accepted.

<a id="复现"></a>

### Reproduction

```sh
bun run --cwd apps/tinker-rust build
CARGO_TARGET_DIR=/tmp/tinker-replay-repro cargo build --offline --locked --release --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --example session_history_memory
python3 apps/tinker-rust/scripts/measure-session-history.py --binary /tmp/tinker-replay-repro/release/examples/session_history_memory --output /tmp/tinker-replay-results --messages 100000
```

Offline builds require cached Cargo dependencies. Output directories must be new to avoid overwriting old observations. Scheduled tasks may additionally pass `--stop-at-utc` with a timezone-qualified ISO time; no further measurement starts after the deadline. Changes to build profile/toolchain require rerecording the binary fingerprint; do not combine comparisons across binaries.

<a id="兼容与回滚"></a>

## Compatibility and Rollback

- New code contains only library exports, tests, and measurement tools; Electron, Tauri main.rs, draft storage, and React UI are unchanged
- Rollback removes only these two modules and lib.rs exports plus associated test/measurement files, or reverts this PR; do not reset the entire user repository
- No real history files were passed to the adapter, so no migrated user data needs writeback; the current installation remains usable
- Supports only standard simplified message fields: nonempty id, four roles, string content, JS-safe nonnegative integer createdAt, retaining other JSON fields. Oversized lines or unsupported shapes are explicitly rejected; do not claim compatibility with all old files
- Cursors are stable only within the same append-only file; cross-snapshot pagination after rewriting is not guaranteed. Each page still scans its prefix; no persistent index or full-pagination CPU improvement is promised
- No SDK logs, permissions, actual cancellation/reconnection/rewind, tool idempotency, or model execution are wired; this is not complete session migration, and later wiring needs separate acceptance
- Windows/Linux execution, physical power loss, full native end-to-end acceptance, and controlled application-level memory comparison were not performed
