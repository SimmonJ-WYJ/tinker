<a id="rust-http-chat-completions流式适配"></a>

# Rust HTTP Chat Completions Streaming Adapter

Status: scoped implementation and automated validation complete, all 4 P2 findings from independent review closed, preparing safe-branch Draft delivery. Real-model and native-window acceptance are excluded from this round. Baseline b61ee1a8b7a04053643eb8da63dc43afee738459. Isolated Rust Lab paths only; production Electron/UI and existing QA acceptance data remain unchanged.

<a id="协议及接线"></a>

## Protocol and Wiring

Based on existing packages/core/src/providers/openai-adapter.ts and apps/electron/src/main/lib/openai-bridge.ts, use OpenAI-compatible POST chat/completions, model/messages/stream=true, SSE choices[0].delta.content, finish_reason, and [DONE]. Official protocol: https://developers.openai.com/api/reference/resources/chat . Text only; explicitly unsupported tools/multimodality must not be presented as a complete MVP.

A reusable HTTP provider implements RunProvider, constructible and injectable by a real host using trusted Rust configuration; unvalidated frontend parameters do not select endpoints, keys, or models. The default app remains offline; external commands/DTOs/old logs stay compatible. Do not switch current production/QA windows; prove the full path through a real Tauri handler + controlled local HTTP/SSE server, beyond parser/trait tests.

<a id="边界和验收"></a>

## Boundaries and Acceptance

All execution tests allow numeric loopback services only, using fake credentials and synthetic messages with no external-model requests. Disable HTTP client proxies/redirects/automatic retries. Numeric IPs do not resolve DNS; HTTPS domains require explicit address pins from the trusted host, rejecting system-resolver fallback while retaining TLS validation for the original domain. Pin resolution/updates are outside this round; all execution tests remain loopback-only. Configuration rejects URL userinfo/query/fragment, and sensitive fields must not implement leaking Debug output. Errors return fixed codes only, without storing response error bodies, URLs/headers, keys, or raw reqwest exceptions. Controlled HTTP/protocol/timeout errors preserve committed partial output.

Incremental parsing crosses network chunk/UTF8/SSE boundaries, ignoring valid comments/blank lines/trailing usage chunks; normal termination requires a protocol completion marker, and a broken stream must not count as success. Accept nullable text metadata, initial BOM, and LF/CRLF/CR line endings; reject actual tool output. Define resource budgets for bodies/single frames/total output/total duration/connection duration; cancellation must interrupt network I/O waiting for headers/body, release connections, prevent late output, and avoid retries with billing side effects. Stop when budgets are exceeded. Network deadlines do not claim to preempt synchronous storage or arbitrary blocking host logic.

Start with failing behavioral tests covering normal output, chunks/UTF8, broken streams/invalid JSON, 401/429/5xx and body sanitization, redirect/proxy restrictions, cancellation/late output/duplicates, timeout cleanup, partial retention, real IPC, and logs/restarts. Retain the previous 96 Rust tests and frontend regressions. Finish with fmt/test/clippy, type/lint checks, repository-wide Bun, Vite/Electron/native compilation, and independent review; commit a safe branch and Draft through normal hooks, without merging/installing/deploying.

New dependencies reuse only cached reqwest0.13.2/tokio1.51; necessary Cargo declaration/lockfile changes are limited to Rust Lab, with production bun.lock/dependencies untouched. Reuse caches without parallel contention; stop new builds at space <4GiB and do not clean user files.

The main conversation coordinates native UI acceptance separately; do not operate on it or write its simulated data this round. Do not claim local HTTP proves real online integration, complete native/product acceptance, or memory benefits. A real online smoke test separately requires approval of the specific service, model, one-time credential use, synthetic request, and spending cap.

Rollback by reverting this batch of commits; retain old default fixtures and draft/history/event data, without reverse migration or deletion.

Current evidence and recovery steps are in the [status report](../reports/2026-11-09-rust-chat-http-status.md).
