<a id="mvp-图片授权与登录品牌修复"></a>

# MVP image authorization and login branding fixes

Status: Implementation and local acceptance complete, draft PR review pending. Scope follows product requirements confirmed this round and UX-20261107-01, UX-20261108-01. Baseline main 0cbdd72. One commit for the whole batch; no production stack migration.

<a id="目标与边界"></a>

## Goals and boundaries

- Explicit image-generation, reference-image editing, and continuation requests no longer trigger permission or payment cards merely because of the host image-generation tool.
- Authorization binds only to the current user turn, defaults to one image, and expands only with an explicit count. Existing request-ledger reuse handles duplicate executions without a second API call. Cancellation, other sessions, and later turns cannot inherit authorization.
- Images attached to the current session may serve as references; an explicitly selected version cannot be substituted. Image authorization must not automatically send arbitrary other project files externally; existing path, type, size, and version-chain checks continue.
- Ambiguous intent or out-of-scope requests retain per-call confirmation; do not globally allowlist the entire image tool. Dangerous terminal operations, write scope, plan mode, and other service permissions remain unchanged.
- Change only branding and bilingual copy on owned login UI and local OAuth callback pages; regress login start, cancellation, return, and repeated clicks. External Google consent screen, client configuration, tokens, protocol names, and existing data paths remain unchanged.
- Do not overwrite latest main with an old development-directory snapshot or transplant Tinker 2 with unrelated history. No new Rust/Tauri production features this round.

<a id="实施选择"></a>

## Implementation choice

Unconditionally allowing the entire tool loses authorization scope; changing prompts alone does not remove the block. Use a shared pure-logic turn authorization object, with Electron supplying the current user message and session reference-image set, reused at permission hook, canUseTool, and image execution boundaries. SDK/filesystem dependencies stay in Electron adapters, allowing reuse of rule tests and contracts during migration.

## Implementation Plan

> For agentic workers: execute task-by-task with TDD and review. Implementation is authorized on the current isolated branch; do not create a duplicate project. Submit together at the end as requested by the user.

**Goal:** Fix ordinary consecutive image generation and old-brand login experiences in the current Electron MVP.

**Architecture:** Shared pure authorization rules receive only the current request and referenceable asset IDs/paths, without reading files, keys, or SDK. Electron builds and wires session context, preserving existing deduplication ledger and native validation.

**Tech Stack:** Existing React/TypeScript, Electron, Bun, Claude Agent SDK. No Rust/Tauri changes.

<a id="task-1核对并保护现状"></a>

### Task 1: Check and protect current state

- [x] Check origin, latest main, PR #1–#8 merge status, and isolated clone.
- [x] Save hashes for 89 original development-directory files and compare each with main: 61 identical, 28 different, none missing.
- [x] Initial Tinker 2 cloud-placeholder reads timed out; subsequent read-only branch/root commit/origin checks plus parent-conversation status confirmed uncommitted Rust/Tauri/React work in an independent project. Preserve in place; do not merge unrelated histories.
- [x] Classify 28 differences by later PR versions: 20 historical old blobs, 8 reviewed by functionality; simplified image cards are an uncommitted requirement to implement this round.

<a id="task-2当前回合图片授权"></a>

### Task 2: Current-turn image authorization

- [x] Write failing regressions in packages/shared/src/agent/image-request-authorization.test.ts: explicit generation, screenshot continuation, selected-image editing, discussion/negation, count scope, reference scope, duplicate call IDs, cancellation, and new-turn isolation.
- [x] Run bun test packages/shared/src/agent/image-request-authorization.test.ts and confirm failure due to missing new behavior.
- [x] Implement image-request-authorization.ts alongside it, export from shared, and accept only strings, reference sets, and current-turn state.
- [x] Build the reference set in the Electron session-attachment adapter, preserving realpath and symlink boundaries.
- [x] Wire the same authorization object into agent-permission-service, orchestrator, and image-generation-tool without changing generic hard rules.
- [x] Update image-permission-flow.test.ts to cover duplicate hook/canUseTool notifications, retained approval for unclear intent, subtasks, cancellation, dangerous tools, and plan mode.
- [x] Run image-ledger, reference-image, version-selection, and permission regressions using synthetic data and fake generators, without real model calls.

<a id="task-3登录品牌取消竞态与图片署名"></a>

### Task 3: Login branding, cancellation races, and image attribution

- [x] Independent task first writes failing LoginPage tests for bilingual branding and start/cancel/repeated clicks.
- [x] Minimally change owned-page copy and callback resources, preserving compatible IDs, paths, legal links, and layout.
- [x] Verify bilingual login, waiting, cancellation, return, and errors; real loopback uses local synthetic authorization callbacks only, without Google access.
- [x] Image attribution failing tests reproduce main still showing cost details; simplify to bilingual Generated by model, preserving preview/edit/save/compare, missing-content prompts, and underlying references; component regression 7 pass.

<a id="task-4验收与一次交付"></a>

### Task 4: Acceptance and single delivery

- [x] Review final diff, sensitive information, and source-directory hash conservation; classify old stack/reusable layer/unchanged Rust scope.
- [x] Run applicable ESLint, full monorepo typecheck, full Bun tests, and Electron build; distinguish baseline failures from new failures.
- [x] Verify actual renderer bilingual and consecutive flows with isolated data, without real keys, sessions, paid calls, or the user's installed version.
- [x] Perform simplify/review checks and fix important findings based on actual results.
- [ ] Fetch and merge latest main; submit together, push safe branch, create draft PR; no merge or deployment.
- [ ] Check full remote SHA, checks/status/Actions; distinguish local passing results from remote checks not run.

<a id="后续每日迁移候选"></a>

## Candidates for subsequent daily migration

- After these fixes stabilize and merge, convert pure authorization-rule synthetic input/output vectors to cross-language contracts; add only Rust Lab tests without switching production calls. Depends on frozen semantics from this round.
- Keep the independent read-only history adapter compatible with SDK logs, reusing PR #8 fixtures; do not simultaneously modify production session orchestration and this round's image service.
- Separately record startup/idle/session resource baselines with identical data and builds; do not infer benefits from language changes.
- Files occupied this round: agent-permission-service.ts, agent-orchestrator.ts, image-generation-tool.ts, image authorization module and tests, auth components and locales, auth-google-client.ts. Scheduled tasks should avoid these paths and full-suite test/build resources.

<a id="回滚"></a>

## Rollback

Revert this single commit to restore previous approval behavior and copy, without migrating or rolling back user data. New authorization state exists only in current-turn memory; old image ledgers, version records, keys, and session formats remain unchanged. Application not installed.

See the [validation record](../reports/2026-11-08-mvp-validation.md) for final local checks and known boundaries. GitHub publication follows commit; final status depends on the actual branch, draft PR, and delivery results.
