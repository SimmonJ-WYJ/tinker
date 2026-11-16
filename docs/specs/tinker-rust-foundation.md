<a id="tinker-rust-重建阶段-1-规格与实施记录"></a>

# Tinker Rust Rebuild: Phase 1 Specification and Implementation Record

Status: historical record of phase one; see the [subsequent specification](./tinker-rust-session-persistence.md) for current draft persistence. Baseline: 8c1a8e046c0b792d543b01e06a93746f49c33039, Electron 0.1.604.
The original phase used an independent experimental skeleton; the user has now authorized integrating the foundation and persistence implementations into the latest main, committing, and pushing, without releasing or replacing the installed app.

<a id="选型"></a>

## Technology Options
- Tauri 2 + Rust main process + React/TypeScript frontend: recommended. Uses the system WebView without bundling Electron; makes it easier to retain the current interface language. Not entirely Rust.
- Slint + Rust: a viable native UI candidate, but requires rebuilding existing HTML/React editors, Markdown, image components, etc., and independently checking licenses.
- Rust service + Electron: low migration risk, but cannot remove the Electron host in phase one; not used for this skeleton.
References: https://v2.tauri.app/concept/architecture/ , https://v2.tauri.app/security/capabilities/ , https://www.slint.dev/

<a id="第一阶段范围与接口"></a>

## Phase One Scope and Interfaces
New app apps/tinker-rust; retain both original apps/electron and apps/tauri-prototype.
Independent identifier com.tinker.rustlab; do not read or write .asci, Tinker Candidate, Electron Key, or history.
Expose only snapshot, save_draft, and submit_draft. Workspace holds only an in-memory draft; no disk, network, shell, or model access.
Drafts are limited to 65536 UTF-8 bytes; reject oversized input while retaining the old draft. Submitting whitespace returns emptyInput; nonempty input is saved in memory before returning modelNotMigrated, and the UI retains the text.
The frontend English/Chinese dictionary translates JSON error codes; unknown communication failures also display visible feedback. Disable editing and buttons during operations to avoid overwriting newer input.
Retain the design direction of the current branding, sidebar, centered heading, and rounded input. Disable and clearly label unmigrated projects, search, and channels, without pretending to offer the full old interface.
CSP restricts local resources; no shell, fs, or http plugins, and window capability permissions are empty. Future commands require separate permission review.

<a id="来源与权利边界"></a>

## Sources and Rights Boundaries
This phase was developed in the existing repository and cannot be described as an independent clean-room implementation or entirely owned copyright.
Cargo configuration/lockfile/build.rs start from the existing tauri-prototype; the Rust draft domain and IPC/React pages were added under this specification without copying old orchestrator/storage logic.
Reuse the user-selected Tinker VI v4-A assets; source records are in tinker-logo-a-integration.md.
Retain root LICENSE, NOTICE, and old modules. Third-party licenses for Tauri, Serde, React, Vite, etc. still apply.
This specification records implementation sources and does not guarantee ownership of code, Logo, or third-party rights.

<a id="逐阶段路线与验收门槛"></a>

## Phased Roadmap and Acceptance Gates
1. Skeleton: Rust tests, frontend typechecking, packaging compilation; desktop checks for IPC, draft recovery, input retention on failure, light/dark themes, and English/Chinese.
2. Local storage: Tinker-owned versioned JSON/JSONL structures, atomic writes, and corruption recovery; test using custom fixtures, import old data read-only, and support rollback.
3. Channels: independent endpoint/capability/error protocols, support user relay root URLs without forcing /v1; keys use platform credential services without directly importing old encrypted content.
4. Model execution: first complete text streaming, cancellation, timeouts, 429/401, permissions, and request idempotency; prioritize offline simulation and separately confirm budgets for paid end-to-end tests.
5. Images: accurate references, version parent-child relationships, missing files, saving, and continuous editing; verify no duplicate charges or lost drafts.
6. Projects, retrieval, attachments, and tools: define each old feature baseline; Rust adapters provide real capabilities, and unmigrated states must not report success.
7. Migration cutover: decide whether to replace Electron only after historical data/shortcuts/permissions/updates/signing/cross-platform testing are complete. This phase promises no timing or size benefits.

<a id="实施计划"></a>

## Implementation Plan
- [x] Verify a clean workspace and existing prototype; create codex/tinker-rust-foundation.
- [x] First run draft behavior tests to confirm missing behavior fails, then implement the Rust draft domain.
- [x] Create isolated Tauri configuration and three IPC commands; add an English/Chinese frontend and light/dark themes.
- [ ] Run Rust fmt/test/clippy, frontend typechecking/build, and desktop compilation.
- [ ] Actually launch and check core flows; record unfinished items and runtime limitations.
- [ ] Verify old code, licenses, and data entry points are unchanged; do not commit or push this phase.
