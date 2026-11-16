<a id="rust-httpsse迁移阶段报告"></a>

# Rust HTTP/SSE migration stage report

Status: Scoped local HTTP/IPC automated validation and independent review are complete; ready to submit a safe branch and Draft PR through normal hooks. This is not full product/native-window acceptance.

<a id="范围及基线"></a>

## Scope and baseline

- Baseline: main `b61ee1a8b7a04053643eb8da63dc43afee738459`
- Worktree: `/private/tmp/tinker-chat-http-20261109`
- Branch: `feat/rust-chat-http-stream`
- Specification: [HTTP/SSE adaptation](../specs/2026-11-09-rust-chat-http-stream.md)
- Basis: [Official Chat Completions protocol](https://developers.openai.com/api/reference/resources/chat) and existing production OpenAI-compatible adapter source

This batch implements single-turn text Chat Completions HTTP/SSE adaptation, connecting existing RunProvider, RunController, and real Tauri command handlers. A trusted Rust host can inject configuration through `RunHostState::with_chat_http`; the renderer cannot arbitrarily choose endpoints, models, or credentials. The default desktop entry still uses the offline provider; this batch adds no model-configuration UI and does not switch the production execution path. Multi-turn context, tools, image generation, projects, and full product switching remain unimplemented. The old DTO's providerKind/offlineScenario fields remain compatibility metadata and cannot indicate network provenance or that online models are enabled; actual provenance depends on trusted-host injection, and formal integration still requires separate configuration/display contracts.

<a id="实现与边界"></a>

## Implementation and boundaries

- Supports fragmented UTF-8, LF/CRLF/CR, initial stream BOM, nullable metadata, trailing usage chunks, and completion markers
- Controlled errors, broken streams, and cancellation retain persisted fragments, preserving deduplication, late-event isolation, and restart recovery semantics
- HTTP allows numeric loopback only; HTTPS domains require explicit trusted-host address pins, with system DNS fallback disabled
- Original domains remain in TLS certificate validation; future separately authorized hosts must resolve/update addresses; this batch makes no external TLS or DNS requests
- Disables proxies, redirects, and automatic retries; bounds network waits, total execution budget, body, frames, and output sizes
- Fixed error codes; retain no upstream error body, URL, headers, or raw reqwest exceptions; configuration does not implement Debug
- Buffers and blocks configured fake-key reflections across frames; tests check that IPC and all JSONL contain no complete fake key

<a id="本轮验证"></a>

## Validation in this round

| Check | Current result |
|---|---|
| Repository-wide `bun run typecheck` | 6 workspaces passed |
| Repository-wide `bun run lint` | Passed |
| Repository-wide `bun test` (synthetic loopback tests allowed) | 3376 passed, 4 skipped, 0 failed, 380 files |
| Rust Lab Vite build | Passed, 32 modules |
| `git diff --check` | Passed |
| Full Rust `cargo test --offline --locked` | 118 passed, 0 failed; repeated subprocess-helper counts separate |
| Rust `cargo fmt --check` | Passed |
| Rust `cargo clippy --all-targets -- -D warnings` | Passed, no suppressed warnings |
| Native Rust binary build | Passed; compiled only, GUI not launched |
| `bun run electron:build` | Passed, application not launched or installed |
| Independent review and simplify | Original 3 findings and added output-budget P2 closed; no confirmed remaining P1/P2 |
| Native UI/real model/product acceptance | Not performed this round |

Logs are in `/private/tmp/tinker-chat-http-checks-20261109`. Final Rust counts: 53 library, 7 protocol, 10 transport, 2 history IPC, 4 history library, 11 execution IPC, 12 SDK history, 14 session history, 5 lifecycle, totaling 118; the two subprocess helpers are not counted twice. Strict lint found a boolean expression and a test helper ignoring read length; both were corrected and rerun without allow attributes or skipped rules. The first Bun run in the default sandbox had 14 local-listening failures; the same suite passed after elevating to tool-supported loopback-test permissions. All HTTP execution tests listen only on `127.0.0.1:0`, using fake credentials and synthetic content, sending no real user data, using no real keys, and incurring no model costs.

Final HTTP-specific coverage includes 7 protocol tests, 10 transport tests, and HTTP wiring/error redaction/cancellation/duplication/history recovery cases among 11 IPC tests. Local server EOF/Reset verifies connection release for cancellation during headers/body and timeouts. History reopens after HTTP subprocess exit; the entire JSONL tree is checked for persisted fake keys. These tests are not described as online or native-window acceptance.

Initial independent static review found three P2 issues: rejection of nullable fields, lost BOM/CR frames, and blocking DNS potentially delaying runtime exit after cancellation. New BOM/newline regressions failed before fixes. Explicit pins and a rejecting resolver close DNS fallback; numeric-loopback results cannot establish real HTTPS acceptance. Final review found another P2: large upstream text fragments, JSON escaping, and SecretGuard prefix merging could exceed the full JSONL event budget. Safe output and completion flush now consistently split on UTF8 boundaries: raw text ≤2048 bytes per fragment, worst-case JSON escaping ≤12288 bytes, leaving 4096 bytes for existing metadata. Real IPC regressions failed then passed, covering 16KiB Chinese text, long key prefixes and control characters, and final flush after an 8191-quote prefix; final output matches and is completed.

<a id="保护与验证限制"></a>

## Protection and validation limits

Production `apps/electron`, `packages`, `bun.lock`, Rust frontend, and run_store implementation have zero differences from baseline. No writes to the old main repository, source, other worktrees, user data, or installed version; no changes to the other QA synthetic data. No DMG, GUI launch, deployment, or installation. Zero production differences prove only that production source was unchanged in this batch, not complete replication of product UI or all features in the new stack.

This batch uses real HTTP sockets and Tauri handlers, with Tauri MockRuntime providing the WebView; it cannot be called native-window testing. Real online models, TLS handshakes, account authentication, model compatibility, and costs remain unverified. Future online smoke tests require explicit service, model, one-time credential purpose, synthetic requests, and cost caps. Network I/O timers do not forcibly preempt synchronous local persistence; the network budget is not a hard real-time cap for the entire process.

<a id="资源与审批历史"></a>

## Resources and approval history

Free space of 3.27GiB triggered the 4GiB stop threshold; builds paused without clearing caches or user files. Work resumed only after the user freed space and sufficient capacity was rechecked. One Cargo builder was maintained throughout, reusing `/private/tmp/tinker-rust-night-target`. The shared cache is not exclusive to this batch and is not cleaned wholesale.

Initial loopback binding returned `PermissionDenied / Operation not permitted` in the default sandbox, not an approval rejection. A subsequent combined command was rejected by automatic approval because development authorization was unclear; work stopped after confirming no execution. Coordination supplied continued-migration authorization verified against the user's original message; the original command, target, and permission route were retried only once. Session22046 ran: 5 tests, 4 passed, 1 expected failure. No command splitting or tool switching bypassed rejection. Later loopback validation used the normal supported permission process.

<a id="回滚及下一步"></a>

## Rollback and next steps

Before commit, this isolated branch can remain disconnected from production entry points. After publication, revert this batch's commit or continue using the baseline default offline path, without deleting or reverse-migrating data. Existing external commands, DTOs, draft/event schemas, and read-only history stay compatible. Normal pre-commit automatically increments root and Rust Lab patch versions; these are version metadata only, without production dependency or UI changes.

This report accompanies the safe branch commit. See its PR and final delivery response for exact commit SHA, Draft PR, and remote CI queries. Without checks/status/Actions records, report no records; do not claim CI passed.

<a id="可复现检查命令"></a>

## Reproducible check commands

Run from the repository root; Cargo consistently uses existing `CARGO_TARGET_DIR=/private/tmp/tinker-rust-night-target` with offline locked dependencies. Loopback tests use the tool-supported narrow permission process; Bun tests use temporary ASCI_CONFIG_HOME/ASCI_RUNTIMES_HOME and a sanitized environment.

```sh
cargo fmt --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --check
cargo test --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --offline --locked
cargo clippy --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --offline --locked --all-targets -- -D warnings
cargo build --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --offline --locked --bin tinker-rust-foundation
bun run typecheck
bun run lint
bun test
bun run --filter=@tinker/rust-desktop build
bun run electron:build
git diff --check
```
