<a id="prompt数据披露脱敏-&#45;实现计划pr-拆分与执行口径"></a>

# Prompt/Data Disclosure Redaction · Implementation Plan (PR Breakdown and Execution Rules)

> **Status**: In progress · Implementation plan
> **Design authority**: [`prompt-disclosure-redaction-spec.md`](./prompt-disclosure-redaction-spec.md) in this directory (this file covers implementation/breakdown/acceptance only, without repeating design)
> **Related issue**: [#710](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/710) (P0 = SB1 release gate)
> **Related PRs**: Fill in after PR1–PR5 open
> **Domain source of truth**: `prompt-disclosure-redaction-spec.md`
> **Author**: Huang Jia
> **Date**: 2026-06-24

---

<a id="0-执行口径"></a>

## 0. Execution Rules

- **Single-theme PRs**: Though #710 P0 is one issue, scope spans shared redaction / IPC DTO / debug·export / telemetry·Sentry / capability UI. Split into **5 independent PRs**, **not one large P0 PR** (reviewable; ambiguity in one slice does not block all).
- **Cadence**: Complete a slice → test it (evidence of "0 matches" for relevant §15 items) → submit it; **do not accumulate everything for one final submission**.
- **Closes/Refs**: First 4 slices use `Refs #710`; only the final PR with all release gates green uses `Closes #710`.
- **Versions**: Patch +1 in `package.json` for each changed package, **once when opening the PR**, not per local commit.
- All design details (L0–L4 classification, placeholders, layer boundaries, redaction categories) defer to the spec.

<a id="1-pr-拆分总览"></a>

## 1. PR Breakdown Overview

| PR | Spec tasks | §15 gates closed | Dependencies | Branch | Title | Size |
|---|---|---|---|---|---|---|
| **PR1** | P0-0 | Mechanical baseline + "Redaction L4" | None | `feat/issue-710-prompt-disclosure-redaction` (current mainline) | `feat(telemetry): add prompt disclosure redaction foundation` | M |
| **PR2** | P0-2 / P0-3 | Permission/AskUser/ExitPlan IPC excludes raw `toolInput`; Permission fallback | PR1 | Stacked on PR1 → rebase main after merge | `feat(agent): remove raw tool input from renderer requests` | M |
| **PR3** | P0-1 / P0-8 | Ordinary debug copy/export exclude L2-raw/L3/L4 | PR1 | Stacked on PR1 → rebase main after merge | `fix(agent): redact debug copy and export outputs` | M |
| **PR4** | P0-5 / P0-7 | Third-party telemetry allowlist only; error monitoring class/hash/redacted only | PR1 | Stacked on PR1 → rebase main after merge | `fix(telemetry): redact third-party and sentry payloads` | M |
| **PR5** | P0-4 | Capability configuration hides `scenarioAgent.description` | **None (off main)** | `feat/issue-710-capability-summary-only` (off main, can precede others) | `fix(agent): hide capability routing descriptions` | S |
| **Acceptance** | §15 full scan + P0-6 + packaging/SDK evidence | Combined scan 0 matches; replay no-op; artifact readability and SDK injection conclusions | PR1–PR5 | Open last | `chore(release): prompt disclosure release-gate evidence` (`Closes #710`) | S–M |

<a id="2-分支与合并策略"></a>

## 2. Branch and Merge Strategy

1. **PR5 first**: Off `main`, smallest and most certain, independent of PR1; merge early if possible.
2. **PR1 is mainline foundation**: PR2/3/4 depend on redaction primitives + canary harness; submit independently and merge early.
3. **PR2/3/4**: Before PR1 merges, develop stacked branches on it, labeling PR descriptions "based on PR1". **After PR1 merges, rebase to latest `main`** (ADR-000: rebase latest target before opening PR).
4. Never commit directly to `main`; always use PRs (ADR-000).

<a id="3-各片详情"></a>

## 3. Slice Details

### PR1 · P0-0 Redaction Foundation + Canary Harness
- **Goal**: Reusable redaction foundation + mechanical "0 matches" baseline.
- **Scope**: Extend `RedactionCategory` in `packages/shared/src/telemetry/redact.ts` (credential/env-value/prompt-body/tool-payload/query/home-path/file-content/pii/thinking/unknown) + placeholder formatters (`formatPromptPlaceholder`, etc.) + **new variants with `redactionMatches`**; **preserve old `redactText`/`redactDeep`/`scrubSentryEvent` signatures and synchronous semantics**, extending internal rules only. Main: minimal prompt fingerprint helper (generalize `PROMPT_VERSION` from `zotero-article-generator`) + hash/bytes (`node:crypto` main-only) + throttled audit sink (reuse `JsonlBuffer`). **Canary leak-regression harness** seeds fake token/cookie/Authorization/home-path/prompt-body/thinking, asserting "0 matches" at each output (initially mostly red, progressively green in later PRs).
- **Behavioral tests (BDD)**: Sensitive string → corresponding placeholder + `redactionMatches`; old call chains intact.
- **Acceptance**: "Redaction L4" green; canary harness established.
- **Risk**: Preserve existing synchronous Sentry beforeSend; hashing main-only (spec §8.1).

<a id="pr2-&#45;p0-2-&#45;p0-3-ipc-raw-toolinput-收口"></a>

### PR2 · P0-2 / P0-3 Restrict Raw toolInput in IPC
- **Goal**: Renderer never receives raw `toolInput`, while SDK resume still works.
- **Scope**: Move `formatToolPreview` to main; add redacted `toolPreview` to `PermissionRequest`; remove renderer-facing raw `toolInput` from `PermissionRequest`/`AskUserRequest`/`ExitPlanModeRequest` (`shared/types/agent.ts`); retain raw input in main pending state for SDK resume. **Synchronize four IPC layers** (shared types → main service → preload → renderer). Inspection found renderer consumes `toolInput` only through permission trio (`PermissionBanner`/`PermissionQueueList`/`PreviewFormatters`); AskUser/ExitPlan renderer does not read it → small change.
- **Behavioral tests**: Unknown tools show only hash/bytes/redacted; **approve → SDK resume still carries original input (top regression)**; renderer payload has no raw input.
- **Acceptance**: §15 item 3 + Permission fallback.
- **Risk**: Broken SDK resume (highest-priority regression).

<a id="pr3-&#45;p0-1-&#45;p0-8-debug-copy-&#45;export-出口"></a>

### PR3 · P0-1 / P0-8 Debug Copy + Export Outputs
- **Goal**: Ordinary debug copy/export exclude sensitive content.
- **Scope**: Split `DebugCopyButton.tsx` / `format-turn-debug-content.ts` into user-safe / redacted-diagnostic; separate ordinary vs diagnostic export (**first locate actual ordinary-export code path**, not directly found by grep; confirm in PR); hashing in main.
- **Behavioral tests**: Ordinary mode excludes full thinking / raw tool I/O / prompt body / token·cookie·home-path; diagnostic mode alone includes redacted preview/hash.
- **Acceptance**: §15 items 1, 2.

### PR4 · P0-5 / P0-7 Telemetry + Sentry
- **Goal**: Third-party outputs (analytics / error monitoring) exclude sensitive content.
- **Scope**: Mark `event-registry.ts` fields L0–L4/purpose/retention/exportable/alertable; redact in `posthog-sender.ts` before send; `beforeSend` in main `sentry-init.ts` + renderer `lib/sentry.ts` reuses extended scrubber (renderer envelopes bypass main and must self-scrub).
- **Behavioral tests**: Seed token/path/query/tool-input; third-party payloads contain only allowlist/redacted/hash; renderer self-scrubbing independent of main.
- **Acceptance**: §15 items 5, 7.

<a id="pr5-&#45;p0-4-capability-ui-summary-onlyoff-main可先做"></a>

### PR5 · P0-4 Capability UI Summary-only (Off Main, Can Precede Others)
- **Goal**: Configuration does not expose routing prompts.
- **Scope**: `CapabilityPackPanel.tsx` stops rendering `scenarioAgent.description`, using `summaryI18n` / public summary instead; loader validation: **production built-in package missing summary → failure**. Both inspected built-ins (`lit-review`/`lit-search`) already have `summaryI18n` → low risk.
- **Behavioral tests**: No original description in configuration source/UI; lit-review/lit-search summaries normal; production built-in without summary fails validation.
- **Acceptance**: §15 item 4.

<a id="4-release-gate-验证证据p0非完整治理"></a>

## 4. Release-gate Evidence (P0, Not Complete Governance)

Issue body includes "packaged artifacts / SDK injection surfaces each show 0 matches" in P0; **do not defer to P1**. Distinguish:

- **Required P0 evidence**: ① Scan packaged artifacts (`default-capability-packs` / `default-skills` / manifest / installed prompt `.md` readability) and state conclusions; ② test SDK/plugin injection, concluding whether it enters provider/debug/export/telemetry.
- **Full registry / long-term governance** (owner/label/canary/rollback, automated artifact scans) remains **P1**.
- **If scanning/testing finds raw prompts / skill prompts / secrets entering debug/export/telemetry → corresponding fix immediately becomes P0.**
- Include as release-gate evidence, either PR1 canary harness (artifact grep) or final acceptance PR.

<a id="5-p0-6-session-replayno-op-声明"></a>

## 5. P0-6 Session Replay: No-op Declaration

- Inspection found session replay **not enabled** (repository grep for `sessionReplay`/`replaysSessionSampleRate`/`rrweb` returned zero matches) → **no P0-6 code**.
- PR4 or final acceptance must state: No current session replay integration; P0-6 code no-op; **future integration must mask by default** conversation inputs / prompt editors / paper excerpts / terminals / permission parameters and disable with consent.

<a id="6-每片提-pr-前自检三问"></a>

## 6. Pre-PR Self-check for Each Slice (Three Questions)

1. Which §15 gate does this close?
2. Does an **automated test** prove it?
3. Is there **"0 matches" evidence** (test / grep / network capture)?

All three → submit; code merely appears changed without zero-match evidence → do not submit yet.

<a id="7-15-上线门禁总清单最后验收-pr-closes-710"></a>

## 7. Complete §15 Release-gate Checklist (Final Acceptance PR `Closes #710`)

- [ ] Ordinary debug copy excludes L2-raw/L3/L4 — **PR3**
- [ ] Ordinary export excludes L2-raw/L3/L4 — **PR3**
- [ ] Permission/AskUser/ExitPlan IPC never sends raw `toolInput` to renderer — **PR2**
- [ ] Capability configuration hides `scenarioAgent.description` routing prompt — **PR5**
- [ ] Third-party telemetry payloads allowlist-only — **PR4**
- [ ] Session replay masked or declared disabled — **P0-6 no-op (acceptance PR)**
- [ ] Error monitoring sends only error class/stack hash/redacted — **PR4**
- [ ] Packaged-artifact scan completed with explicit readability conclusions — **release-gate evidence**
- [ ] SDK/plugin skill injection testing completed — **release-gate evidence**
- [ ] Combined scan: zero prompt-fragment/credential/private-path matches in debug copy/export/stderr/permission/third-party payloads — **acceptance PR (PR1 canary harness)**
