# Tauri queued turns: final automated validation and native acceptance gap

Date: 2026-11-16. Status: **DONE_WITH_CONCERNS** for final automated validation/reporting. Native original-editor acceptance is **unrun**, and whole-branch review/publication remain with Root. Builds and headless tests do not establish GUI or product acceptance.

## Source and evidence scope

All fresh commands below ran against `3375d15b81dbf000835729d4195f2bc6a5d2a2ed` on `feat/tauri-queued-turns`, in `/Users/simmonj/Documents/ChatGPT/Tinker/migration-work/tools-native-acceptance-20261116`. The worktree was clean before and after validation, before this documentation-only report. No implementation correction was needed. Task 1/2 independent approvals are prior evidence in `task-1-rereview.md` and `task-2-rereview-r2.md`, not fresh review by this task.

The supplied remote-main observation is `450df3a86ca9cfc64d4b8777c98a1311f5230d57`, with open PRs `[]`, verified by Root before handoff. This task performed no fetch, merge, remote change, push, PR, Actions run or branch/worktree switch. Root owns subsequent whole-branch review, final minor triage, mainline integration, normal publication hooks and Draft PR/check verification. Those steps are not complete in this report.

Local evidence directory: `/Users/simmonj/Documents/ChatGPT/Tinker/migration-work/queue-checks-20261116`. Command logs and status JSON record actual argv, start/end epoch, exit, wrapper/child PID and unique synthetic root; this report identifies the fixed source worktree and SHA. The source association is this fixed SHA; no code changed while commands ran. Build/source/process audits are `task3-artifact-audit.json`, `task3-source-audit.json`, and `task3-final-process-audit.json`.

## Fresh final checks

Every command used `python3 /tmp/tinker-queue-check.py <task3-name> <argv>` from the worktree, `/bin/zsh`, `login=false`. The wrapper retains only PATH/HOME/TMPDIR/SHELL/LANG, creates a fresh synthetic ASCI_CONFIG_HOME/ASCI_RUNTIMES_HOME, disables signing identity discovery and uses `CARGO_NET_OFFLINE=true` plus the known `migration-work/tools-native-target` cache. No real credentials were copied into the environment. Rust dependencies were offline/locked for tests/clippy; existing build scripts use offline Cargo. No dependency installation occurred.

| Check | Exact wrapped argv | Exit | Wall time | Evidence |
|---|---|---:|---:|---|
| rust | `cargo test --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --all-features --offline --locked -- --test-threads=1` | 0 | 207.51s | `task3-rust.log` / `task3-rust-status.json` |
| fmt | `cargo fmt --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --check` | 0 | 0.28s | `task3-fmt.log` / `task3-fmt-status.json` |
| clippy | `cargo clippy --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --all-features --all-targets --offline --locked -- -D warnings` | 0 | 7.04s | `task3-clippy.log` / `task3-clippy-status.json` |
| typecheck | `bun run typecheck` | 0 | 10.12s | `task3-typecheck.log` / `task3-typecheck-status.json` |
| lint | `bun run lint` | 0 | 11.56s | `task3-lint.log` / `task3-lint-status.json` |
| bun | `bun test` | 0 | 56.61s | `task3-bun.log` / `task3-bun-status.json` |
| electron-build | `bun run electron:build` | 0 | 8.29s | `task3-electron-build.log` / `task3-electron-build-status.json` |
| ordinary-build | `bun apps/tinker-rust/scripts/build-tools.ts` | 0 | 20.73s | `task3-ordinary-build.log` / `task3-ordinary-build-status.json` |
| qa-build | `bun apps/tinker-rust/scripts/build-tools-native-qa.ts` | 0 | 19.63s | `task3-qa-build.log` / `task3-qa-build-status.json` |

Rust: **378 passed, 0 failed**, comprising 133 library tests and 245 integration tests; zero-test binary/doc targets also passed. Counts use each Cargo target's final summary and exclude duplicate summaries from nested subprocess tests. `desktop_process` passed 5 tests in 45.16s; its output pause was normal slow-fixture work. Headless runtime subprocesses were permitted and no native GUI was launched.

Bun: **3537 passed, 4 skipped, 0 failed**, 13124 assertions, 3541 tests across 416 files. Four real-ripgrep integration cases are skipped (keyword/offset, case handling, paper-ID restriction, no-match behavior); these are not passes. Repeated skip lines inside the log are not extra skips. Monorepo typecheck and lint passed. Tool versions: Bun 1.3.12, Cargo 1.94.0, rustc 1.94.0, Claude Code 2.1.318.

The fresh Rust tests include actual core/actor queue FIFO, exact UUID retry/identity, redirect lineage, durable stop/close, stale control, capacity, recovery, zero automatic execution and fallible-persistence cases. The seven `queue_formal` tests use the real host/actor and synthetic loopback, while Bun covers actual client transport, ownership and original component projections. These are automated host/component tests, not recorded editor UI actions. The test logs remain the authority for individual assertions.

Known nonfatal output is retained: Jotai atomFamily/loadable deprecations, a React key warning in CodeBlock's nested-children fixture, intentional listener/serialization diagnostics, and Vite chunk-size warnings. Lint reported no errors. The prior scoped persistence/doctype fixes are retained; no blanket suppression, dependency migration or optional cleanup was added.

## Serial build and artifact audits

`/tmp/tinker-task3-final.py` serialized all remaining checks after Rust completed and checked disk/active compiler process names before each command. Preflights are `task3-<check>-preflight.json`; all had no active competing compiler and well above 4GiB available. Initial free space was 41.2GiB; final audit recorded 42344542208 bytes (39.4GiB). One compiler/build command ran at a time. No user or unknown-cache cleanup was performed.

The Electron build compiled main/preload/renderer/resources only; it neither packaged nor launched Electron. Both Tauri commands built the original formal React workbench with their dedicated configured entry and fresh 0700 owned staging. These are independent debug preview bundles, not installers or releases.

### Ordinary bundle

- Path: `/private/tmp/tinker-tauri-tools-package-2P6bQ7/Tinker Tools Preview.app`.
- Entry: `tinker-tools-preview`; identifier `com.tinker.tools-preview`, version 0.0.1, minimum macOS 11.0; exactly one executable in Contents/MacOS. `lipo -archs` returned arm64 and `nm` found the expected main entry symbol.
- Signed executable SHA-256: `3879641f400be8401bea1609a1bdd3a8d6484a71ef7d14419e5700921af4e00f`.
- `codesign --verify --deep --strict --verbose=2` passed; `codesign --display --verbose=4` reports **Signature=adhoc**, flags 0x2, no TeamIdentifier. No Developer ID signing or hardened-runtime assurance is claimed.
- `xcrun stapler validate` returned 65: **no stapled ticket**. No notarization submission occurred. Gatekeeper assessment, installation and launch were unrun; no claim of notarized distribution is made.
- LICENSE, NOTICE and icon hashes match repository sources. Per-file bundle and renderer hashes, plist, exact audit argv/exit/output and entitlements inspection are in `task3-artifact-audit.json`. Renderer assets are embedded by Tauri from the dedicated build directory; the external Resources directory contains the three intended attribution/icon files.
- QA native symbol/string markers: False/False; renderer `__NATIVE_QA_ATOMS__` probe present: False.

### Qa bundle

- Path: `/private/tmp/tinker-tauri-tools-package-AZA55H/Tinker Tools Native QA.app`.
- Entry: `tinker-tools-native-qa`; identifier `com.tinker.tools-native-qa`, version 0.0.1, minimum macOS 11.0; exactly one executable in Contents/MacOS. `lipo -archs` returned arm64 and `nm` found the expected main entry symbol.
- Signed executable SHA-256: `1a2d7cafb385f77402383a24161f6fa81367a5cad494493c755a89b619d6405f`.
- `codesign --verify --deep --strict --verbose=2` passed; `codesign --display --verbose=4` reports **Signature=adhoc**, flags 0x2, no TeamIdentifier. No Developer ID signing or hardened-runtime assurance is claimed.
- `xcrun stapler validate` returned 65: **no stapled ticket**. No notarization submission occurred. Gatekeeper assessment, installation and launch were unrun; no claim of notarized distribution is made.
- LICENSE, NOTICE and icon hashes match repository sources. Per-file bundle and renderer hashes, plist, exact audit argv/exit/output and entitlements inspection are in `task3-artifact-audit.json`. Renderer assets are embedded by Tauri from the dedicated build directory; the external Resources directory contains the three intended attribution/icon files.
- QA native symbol/string markers: True/True; renderer `__NATIVE_QA_ATOMS__` probe present: True.

The ordinary bundle has no selected QA native symbols/strings or renderer atom probe, while the dedicated QA build has them. This is a measured build-separation audit, not proof of all runtime behavior or absence of arbitrary instrumentation. No new endpoint, app entry or harness modification was introduced. Old bundles/synthetic roots were not reused or modified.

## Native acceptance: all steps unrun

Root's supplied readonly native preflight at 2026-11-16T16:19:44Z found console OnConsole=true, **CGSSessionScreenIsLocked=true**, root IOConsoleLocked=false. The session lock marker governs; no password state was inferred. Root had one user unlock request pending. No new unlock response was conveyed to this task. The lock was not bypassed, GUI state was not rechecked without that response, and no alternate UI/control route was attempted.

| Requested native original-control scenario | Actual result |
|---|---|
| Original editor Send/configured send gesture; ordinary enqueue B/C; queue bar; exact A/B/C bubble UUID and HTTP/journal correlation | UNRUN: known locked session |
| Configured send plus Option interrupt, A→D→B→C; pending permissions remain ungranted; actual execution IDs and badge boundaries | UNRUN: known locked session |
| Failure preserves earlier success and accepted unexecuted text; Stop/resend; late old-chain Stop/grants | UNRUN: known locked session |
| Same-process document reload continues live work without duplicate bubbles | UNRUN: known locked session |
| Close abort/commit and real app-process restart with zero automatic HTTP/tools | UNRUN: known locked session |
| English/Chinese, light/dark, multi-session and backpressure through original controls | UNRUN: known locked session |

No QA app, mock HTTP server, native driver action, app PID, screenshot, exact DOM count, per-scenario native journal/HTTP correlation, focus/hidden/opacity measurement or keep-awake lease exists for this batch. There were zero claimed native UI actions. No old native acceptance was relabeled as current. To resume, Root needs a normal user unlock response, fresh readonly availability verification, the exact new QA bundle above, new trusted synthetic roots and filtered environment, original controls and recorded driver-only inputs; any white-box helper/injected state must be labeled separately. Native acceptance remains a delivery gap.

## Source, defaults and data protection

The fresh source audit compares 450df3a..3375d15: 58 changed files, 5304 insertions/216 deletions. No changed file is under production Electron main/preload, .github or .husky; README/CLAUDE/AGENTS, Electron Vite/packaging defaults, Bun lock and Rust manifests/lock are unchanged in this range. Shared renderer components/hooks and shared API types do change conditionally for the native queue in the previously approved Task 1/2 implementation; this is not a claim that all production source is byte-identical. CSS and locale files have no diff. The four package.json changes are version-only hook metadata (root 0.1.55, Electron 0.1.622, Rust desktop 0.0.12, shared 0.1.149); dependency declarations are unchanged. All implementation changes remain the previously approved Task 1/2 work. `git diff --check` passed. Bounded diff scans found zero private-key block, AWS access-key or long provider-key patterns; this is not an exhaustive secret scan or whole-machine audit.

The trusted tools-native constructor explicitly opts into queueing. Ordinary core/host constructors and production Electron/SDK defaults retain their prior policy. No new application entry, layout/control, general filesystem authority, shell/MCP/image/attachment tool or real provider/channel capability was added by this task. Fake keys/owned numeric-loopback/synthetic tool fixtures were used. No installed app, real channel, credential store or real history was read/migrated/rewritten for acceptance, and no paid provider request was made.

Root's separate readonly protection observation retains `/Users/simmonj/Tinker` at 8c1a8e046c0b792d543b01e06a93746f49c33039 on codex/tinker-rust-foundation with 63 dirty entries. That checkout was untouched by this task; count equality does not prove byte-for-byte equality. The original source checkout had historically timed out during status and is not assumed clean; it was not mutated or repeatedly rescanned.

## Minor triage and remaining delivery

- Task1 M1 remains for Root's whole-branch assessment: generic ToolContext structural validation accepts consecutive User/User-after-tool boundaries beyond an explicit redirect mode; store parent/edge authority still guards actual continuation. Prior review demonstrated no authorization bypass. This validation-only task did not change it or downgrade its severity.
- Task2 M1's scoped expected-persistence/doctype fixes remain; Jotai and intentional diagnostic noise is disclosed above. No broad warning cleanup was authorized.
- Whole-branch independent review, current-main revalidation/integration, normal push hooks, Draft PR, remote head/base/checks/status/Actions verification are pending Root. No safe-push or publication success is claimed here.

## Cleanup and rollback

All final wrapper commands completed normally. Final filtered process audit found no cargo/rustc, headless tinker-runtime, owned tools preview/QA app or caffeinate process. No GUI app or lease had been started, so no app/lease shutdown was needed. The initial sandbox ps denial was resolved by approved narrow readonly process inspection; no rejection or permission operation remains pending. The first shell attempt used the absent ASCI cwd and failed before execution; explicit actual workdir succeeded. No unrelated process was terminated.

Fresh bundles, test-root records, build outputs, wrapper status/logs and audit manifests are retained for review; existing tests may remove their own temporary fixtures normally. No user files, old roots/bundles, installed applications or unknown caches were deleted. No build product, fake/real credential, cache, generated schema or installer is included in the report commit. Only this English report is staged; normal local hooks run without bypass.

Rollback: stop the independent preview and continue the unchanged installed Electron application. Revert the implementation through reviewable commits if required. **Queue-enriched synthetic data requires the new reader**: old binaries must reject unsupported journal/redirect-lineage versions before recovery writes. Do not rewrite/delete those logs or assume an old binary can reopen them. A source rollback does not downgrade the data schema. Retain old checkouts and accepted-but-unexecuted exact UUID text as evidence.

Remaining M2/M3 work includes real channel/credential CRUD, real providers, rich draft/attachment/image parity, general tools/shell/MCP, real project/filesystem authority, legacy-data import/export cutover and measured production rollout. This batch measures neither whole-machine memory nor complete product/real-service parity.
