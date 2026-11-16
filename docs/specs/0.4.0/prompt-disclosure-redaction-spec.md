<a id="prompt数据披露分级与脱敏-&#45;实现-spec"></a>

# Prompt/data disclosure classification and redaction · Implementation Spec

> **Status**: Draft · Review pending (under `docs/specs/0.4.0/`)
> **Author**: Huang Jia
> **Related milestone**: [`docs/milestones/0.4/north-star.md`](../../milestones/0.4/north-star.md) §3 (P3 security boundary = Epic3): This spec **P0 → SB1 release gate / P1 → SB2 (observation)**; P2 → 0.5+
> **Related issue**: [#710](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/710)
> **Related PR**: (none)
> **Domain-language source of truth**: This file; root `CONTEXT.md` terminology backfill pending
> **Upstream decision**: (Original desktop draft referenced `prompt-visibility-classification-spec.md`; confirmed self-contained, independent of that file, and usable as a complete standalone plan)
> **Related architecture**: `docs/adr/ADR-011-telemetry-architecture.md` · `docs/specs/telemetry-spec.md`
> **Date**: 2026-06-18 (moved into repository 2026-06-22)
> **Working drafts**: `prompt治理/ASCI Prompt Exposure Inventory.md` · `prompt治理/Prompt Disclosure Policy v0.3` (filename remains `Prompt Disclosure Policy v0.1.md`) · `prompt治理/上线前改造清单 v0.4` (prelaunch modification list) · `prompt治理/竞品调研矩阵 v0.3` (competitor research matrix)
> **Implementation path**: `docs/specs/0.4.0/prompt-disclosure-redaction-spec.md`

---

## 0. TL;DR

1. **This spec governs disclosure caused by ASCI itself, not prompts entering model-provider request bodies.** With BYO-key / direct SDK connections, master/capability/subagent prompts in provider requests are vendor-agreement/future-gateway concerns; this spec covers debug copy, permission IPC, capability UI, exports, logs, and third-party telemetry outlets.
2. **Default: Users see actions and evidence, not complete internal prompts.** Research workflows show query strategy, sources, filters, counts, screening/exclusion, citations, and high-level plans; omit full orchestrator/subagent/judge/ranking prompts, hidden chain-of-thought, raw tool payloads, secrets.
3. **Unified L0-L4 classification, layered implementation rather than one all-purpose redactor.** shared supplies synchronous redaction primitives, classification, placeholder formatting; main owns toolPreview/export/debug formatters, hashes/fingerprints, audit persistence; renderer only self-scrubs Sentry/telemetry and renders redacted DTOs.
4. **Reuse existing telemetry redaction infrastructure, no parallel path.** `packages/shared/src/telemetry/redact.ts`, `event-registry`, Zod strip schemas, Sentry/PostHog senders remain sources of truth; extend to secrets, metadata, error context, third-party payloads, without coupling UI-summary formatting and telemetry regex redaction into one function.
5. **Clear release-gate priorities.** P0 first delivers minimal redaction foundation, minimal prompt fingerprint helper, DebugCopy/Permission/AskUser/ExitPlan/Capability UI/telemetry/errors/exports; P1 adds complete registry, release-artifact scans, SDK/plugin injection verification, stderr redaction, and governance.

---

<a id="1-背景与目标"></a>

## 1. Background and goals

ASCI is approaching public availability. Prompt governance should distinguish five data surfaces instead of collapsing them into “prompt leakage”:

| Data surface | Governed here? | Notes |
|---|---:|---|
| Provider request / model-provider request body | No | DPA, ZDR, retention, future prompt gateway governance. |
| Product user surface | Yes | Chat UI, capability configuration, permission dialogs, debug copy, ordinary exports. |
| Local diagnostics | Yes | App logs, session stderr, trace/debug payloads, local JSONL. |
| Client resources | Yes | Electron resources, default packs/skills, manifests, prompt `.md`. |
| Third-party telemetry | Yes | Analytics, observability, session replay, error monitoring, LLM request analytics. |

<a id="11-设计目标"></a>

### 1.1 Design goals

| Goal | Criterion |
|---|---|
| Restrict product user outlets | Ordinary UI / debug copy / exports contain no master/subagent prompt bodies, raw tool I/O, thinking, secrets. |
| Restrict IPC boundary | Renderer no longer receives raw `PermissionRequest.toolInput`, `AskUserRequest.toolInput`, `ExitPlanModeRequest.toolInput`. |
| Minimize third-party payloads | Allowlisted fields only; no raw prompts/user prompts, complete search queries, raw tool I/O, thinking, paths, secrets. |
| Auditability | Main orchestration emits `hash`, `bytes`, `redactionMatches`, throttling persistence of `{ route, ruleName, category, action, runId, ts }`; shared pure functions never write disk. |
| Preserve research transparency | Users still see research goals, query strategy, sources/filters, screening/exclusion, citations, method summaries, risks. |

### 1.2 Non-scope

- Does not address provider visibility of prompts in request bodies.
- Does not promise prompt-IP secrecy through client hardening, ASAR, or obfuscation.
- Does not rely on models refusing to repeat prompts as a security guarantee.
- Does not design server-side prompt gateways; if chosen, create separate `prompt-gateway-impl-spec.md`.
- Does not refactor telemetry architecture; extends existing redaction / allowlists / schemas only.

---

<a id="2-根本原则"></a>

## 2. Fundamental principles

1. **Hiding prompts is not a security boundary.** Real boundaries are sandboxing, approval, secret isolation, network/filesystem policy, log redaction, access control.
2. **Truly sensitive information should never enter prompts.** Isolate API keys, tokens, cookies, Authorization, env values, internal endpoints, and complete permission-bypass rules through code/secret stores.
3. **Users need to understand AI actions, not full internal motivations.** Show actions, evidence, plans, sources, risks, screening reasons; hide complete prompt bodies, judge rubrics, ranking/scoring details.
4. **Anything sent to renderer is user-visible.** Never send raw payloads and rely on components not displaying them.
5. **Third-party platforms are external systems.** Govern dashboards, exports, alerts, replay, and support workflows as external disclosure surfaces.
6. **Redact before crossing boundaries.** Apply appropriate layered redaction/formatters before renderer IPC, UI payloads, debug copy, exports, telemetry, error monitoring; never merge product summaries, diagnostic formatting, and telemetry regexes into one large mode function.
7. **Redaction is not silent deletion.** Use `[REDACTED]`, `[[REDACTED:path]]`, `[[PROMPT:sha256:abcd@v7]]` to indicate why content is hidden.
8. **Client resources are readable by default.** Electron-packaged capability/skill prompts and manifests cannot carry L3 IP requiring secrecy.
9. **SDK/plugin injection needs separate empirical validation.** ASCI inventory covers only owned prompts; SDKs/plugins/skills may inject additional context.

---

<a id="3-分级定义"></a>

## 3. Classification definitions

| Level | Meaning | ASCI content | Default behavior |
|---|---|---|---|
| **L0 User-visible** | User content and final outputs | Inputs, final answers, evidence, actionable plan summaries, tool-action summaries, permission choices, capability `summaryI18n` | Display, copy, ordinary export |
| **L1 Explanatory summary** | Intent-level explanations of internal actions | Capability name, one-sentence subagent role, tool-use reason, risks, source availability presence/status | Show summary, never original prompt |
| **L2 Controlled diagnostics** | Execution detail for debugging/support | Redacted tool I/O previews, route reason, dispatch-prompt preview, prompt hash/version, latency/token, query/source diagnostic summaries, error class | Diagnostic/admin only, redacted; third parties allowlist only |
| **L3 Internal** | Full policies and prompt IP | Master/scenario/subagent prompts, `scenarioAgent.description` routing text, judge rubric, ranking/scoring prompts, anti-injection red lines, full SKILL.md prompt | No display/ordinary debug/export/telemetry; id/version/hash only |
| **L4 Never recorded** | Credentials and high-risk private content | API key, token, cookie, Authorization, env values, secret files, private paths, raw identity identifiers | Never display/export/upload; mandatory redaction |

Cross-level rules:

- Use stricter classification when uncertain.
- L3 may produce L1 summaries, but they must not reversibly reconstruct originals.
- One object has different classifications by surface: Tool I/O becomes L0/L1 action summaries in UI, redacted L2 diagnostics, and only allowlisted summary/hash/stat in third-party telemetry.

---

<a id="4-默认行为矩阵"></a>

## 4. Default behavior matrix

| Disclosure surface | L0 | L1 | L2 | L3 | L4 |
|---|---|---|---|---|---|
| Chat UI | Display | Summary | Hidden | Hidden | Hidden |
| Plan/action summaries | Display | Display | No raw payload | Hidden | Hidden |
| Research provenance panel | Goals, sources, filters, counts, citations, exclusion | Method summary | Redacted query/hash/stat only | No ranking prompt | Hidden |
| Capability configuration | `summaryI18n` / public summary | Role summary | No raw metadata | No full `scenarioAgent.description` / promptPath | Hidden |
| Permission dialogs | Action summary | Risk/reason summary | Redacted parameter preview | No internal rules/prompts | Hidden |
| AskUser / ExitPlan | Questions, allowed choices | High-level plan | No raw `toolInput` | No routing prompt | Hidden |
| Ordinary debug copy | Copyable | Copyable | No raw values | Not copied | Not copied |
| Diagnostic debug copy | Copyable | Copyable | Redacted preview/hash | Hash/version only | Redacted |
| Ordinary session export | Display | Summary | No L2 raw | No L3 | No L4 |
| Third-party telemetry | Anonymous event fields | Allowlisted summaries | Redacted/hash/stat only | Never sent | Never sent |
| Session replay | Page-level events | Optional UI-region information | Text regions masked by default | Not recorded | Not recorded |
| Error monitoring | Error class / stack hash | Redacted context | Redacted diagnostics | No prompt bodies | No secrets |

---

<a id="5-已确认暴露面与目标改造"></a>

## 5. Confirmed exposure surfaces and target changes

Full inventory: Working draft `ASCI Prompt Exposure Inventory.md`. Only release-related anchors appear here.

| Source | Current state | Target |
|---|---|---|
| `DebugCopyButton` / `format-turn-debug-content.ts` | Copies thinking/tool inputs/results directly, without redactor. | Separate `user-safe summary` from `redacted diagnostic`; ordinary mode excludes L2 raw/L3/L4. |
| `PermissionRequest.toolInput` | Raw object sent by IPC; unknown-tool fallback shows full JSON. | Main generates `toolPreview`; renderer holds no raw `toolInput`. |
| `AskUserRequest.toolInput` / `ExitPlanModeRequest.toolInput` | Raw inputs in renderer DTO. | Renderer receives UI-essential fields only; raw stays in main pending state. |
| `CapabilityPackPanel` | Displays full `scenarioAgent.description` routing prompt. | Production UI shows `summaryI18n` / public summary only; description restricted to LLM/diagnostics. |
| `default-capability-packs` / `default-skills` | Electron build packages resources. | Scan actual release artifacts; client resources are no secrecy boundary. |
| `agent-session-diagnostics.ts` | Persists raw stderr chunks. | Redact before append; retention and disable switch. |
| Third-party telemetry | Team instrumentation may send query/tool/error/replay data. | Event-schema allowlists + redaction + DPA/retention/region/RBAC/opt-out/delete. |
| SDK/plugin skill injection | Full SKILL.md / description injection not tested. | Test markers verify provider/debug/export/telemetry surfaces. |
| `zotero-article-generator` prompt version | Existing positive `PROMPT_VERSION` example. | Generalize into registry / fingerprint helper. |

---

<a id="6-关键数据流与插入点"></a>

## 6. Key data flows and insertion points

<a id="流-aprompt-&#45;provider-requestout-of-scope"></a>

### Flow A: prompt → provider request (out of scope)

```text
buildSystemPrompt(ctx)
→ agent-orchestrator systemPrompt append
→ claude-agent-adapter sdkOptions.systemPrompt
→ sdk.query()
→ provider request
```

Treatment: ASCI records only `promptId/version/hash/configFingerprint`; no prompt bodies in debug/export/telemetry. Vendor agreements or future gateway govern provider-body visibility.

<a id="流-bcapabilitysubagent-prompt-&#45;runtime-context"></a>

### Flow B: capability/subagent prompt → runtime context

```text
manifest.json promptPath
→ capability-pack-loader resolvePromptFile()
→ expandPromptTemplates()
→ buildSubAgentOutputLanguageSection()
→ SubagentRegistry
→ Task(subagent_type, prompt)
```

Treatment: L3 prompts; scan readability of packaged default resources before release. Hard IP control requires server-side injection or controlled registry; otherwise explicitly document client readability.

<a id="流-ccapability-manifest-&#45;配置-ui"></a>

### Flow C: capability manifest → configuration UI

```text
manifest.json scenarioAgent.description
→ capability-pack-service list()
→ capability-pack IPC DTO
→ CapabilityPackPanel
```

Treatment: Remove full routing prompts from production UI; use `summaryI18n` / public summaries; built-in packs missing summaries fail validation.

<a id="流-dtool-&#45;permission-&#45;debug-copy"></a>

### Flow D: tool / permission / debug copy

```text
tool_use input/result
→ DebugCopyButton
→ PermissionRequest
→ AskUserRequest / ExitPlanModeRequest
```

Treatment: Debug copy uses formatters; main generates redacted permission/ask/exit previews; renderer receives no raw input.

<a id="流-e产品埋点-&#45;第三方平台"></a>

### Flow E: product instrumentation → third-party platforms

```text
workflow/tool/error/latency/source status
→ telemetry event builder
→ allowlist + redaction
→ analytics / observability / replay / error monitoring
```

Treatment: Allowlisted third-party fields only, each labeled L0-L4, purpose, retention, exportability, alert inclusion.

---

<a id="7-与现有-telemetry-架构的关系"></a>

## 7. Relationship to existing telemetry architecture

Extend, do not replace, ADR-011 / `telemetry-spec.md`.

| Existing capability | Location | Extension |
|---|---|---|
| Text redaction primitives | `packages/shared/src/telemetry/redact.ts` `redactText` | Add secret/token/cookie/Authorization/private key/env/path/query/prompt-marker categories; remain synchronous pure functions. |
| Deep-object redaction | `redactDeep` | String-leaf fallback for arbitrary nested objects only; no semantic tool summaries, export formatting, or prompt fingerprints. |
| Sentry event redaction | `scrubSentryEvent` | Shared main/renderer beforeSend; extend secrets/tool args/prompt markers/error context. Renderer envelopes bypass main beforeSend and must self-scrub. |
| Event allowlist | `event-registry.ts` | Add L0-L4, purpose, retention, exportable, alertable annotations. |
| Zod strip schema | `schema/telemetry/*.schema.json` | New prompt/agent fields permit id/version/hash only, never bodies. |
| Consent / region | `consent.ts` | Reuse; consent disables replay by default. |
| Local JSONL buffer | `apps/electron/src/main/lib/telemetry/jsonl-buffer.ts` | Reusable redaction audit sink; main orchestration writes only, no renderer disk writes. |

Preserve telemetry red lines: Never collect full papers / PDFs / original notes / conversations / search terms / API keys / emails / usernames / paths containing usernames.

Additional red lines: No master/subagent prompt bodies, raw `toolInput`/results, assistant thinking, complete queries, unredacted paths, scenario routing text, or complete SDK/plugin-injected skill prompts.

---

<a id="8-redaction-&#45;formatter-分层设计"></a>

## 8. Layered Redaction / Formatter design

<a id="81-分层边界"></a>

### 8.1 Layer boundaries

Do not put product summarization and telemetry string redaction into one function. Three layers:

| Layer | Location | Responsibility | Exclusions |
|---|---|---|---|
| Shared redaction primitives | `packages/shared/src/telemetry/redact.ts` | Synchronous pure text/object fallback, sensitive classification, placeholders, Sentry scrub helpers | No hashes/JSONL/tool semantics/UI DTO generation |
| Main disclosure formatter | `apps/electron/src/main/lib/...` | `toolPreview`, safe AskUser/ExitPlan DTOs, export/debug diagnostic formatters, prompt fingerprints, hash/bytes, audit sink | No raw renderer payloads or formatter logic inside telemetry regexes |
| Renderer safety net | `apps/electron/src/renderer/...` | Render redacted main DTOs; self-scrub renderer Sentry `beforeSend` / `beforeBreadcrumb`; user-safe debug summary as needed | No raw Permission/AskUser/ExitPlan `toolInput`; no production diagnostic hashes |

Evidence-based constraints:

- `@asci/shared` `tsconfig` inherits root `lib:["ESNext"]`; shared types/pure functions must not introduce `node:crypto`.
- `redactText` / `redactDeep` are synchronous pure functions; WebCrypto would make callers async, unsuitable for current Sentry/telemetry beforeSend paths.
- Main already uses `node:crypto` / `createHash`, including `trace/trace-redactor.ts`; generate prompt/content hashes in main orchestration or caller.
- Renderer Sentry has its own `beforeSend` because envelopes bypass main beforeSend; shared redaction remains necessary only as telemetry/error safety net.

<a id="82-shared-原语输出"></a>

### 8.2 Shared primitive outputs

```typescript
type RedactionCategory =
  | 'credential'
  | 'prompt-body'
  | 'tool-payload'
  | 'query'
  | 'home-path'
  | 'file-content'
  | 'pii'
  | 'thinking'
  | 'env-value'
  | 'unknown'

interface RedactionPrimitiveResult<T> {
  value: T
  redactionMatches: RedactionMatch[]
}

interface RedactionMatch {
  path: string
  category: RedactionCategory
  action: 'replace' | 'mark' | 'drop'
  ruleName: string
}

function formatPromptPlaceholder(input: {
  promptId: string
  version: string
  hash: string
}): string
```

shared generates neither `hash` nor `bytes`; main callers generate hashes before invoking `formatPromptPlaceholder()`.

<a id="83-main-编排输出"></a>

### 8.3 Main orchestration outputs

```typescript
interface DisclosureFormatted<T> {
  value: T
  hash?: string
  bytes?: number
  redactionMatches: RedactionMatch[]
}

interface RedactionAuditEvent {
  route: string
  ruleName: string
  category: RedactionCategory
  action: string
  runId?: string
  ts: string
}
```

Audit sink:

- Only main orchestration writes; no renderer fs.
- Reuse `JsonlBuffer` or equivalent append buffer, e.g. `redaction-audit.jsonl`.
- Throttle/sample high-frequency product formatters; record match summaries only, never raw sensitive values.
- Shared pure functions only return `redactionMatches`, without side effects.

Placeholders:

| Category | Placeholder |
|---|---|
| Prompt body | `[[PROMPT:sha256:<first16>@<version>]]` |
| Credential / env value | `[[REDACTED:credential]]` |
| Home path / private path | `[[REDACTED:path]]` |
| Tool payload | `[[REDACTED:tool-payload:<hash>]]` |
| Query | `[[REDACTED:query:<hash>]]` |
| File content | `[[REDACTED:file-content:<hash>]]` |
| PII | `[[REDACTED:pii]]` |
| Assistant thinking | `[[REDACTED:thinking]]` |
| Unknown sensitive | `[REDACTED]` |

<a id="84-formatter-模式"></a>

### 8.4 Formatter modes

| Mode | Availability | Content |
|---|---|---|
| User-safe summary | Default everywhere | User-message/final-answer summaries, tool-action list, error summary, event id. |
| Redacted diagnostic | Controlled diagnostic switch | Redacted L2 previews, hashes, bytes, tool/action timing, redactionMatches. |
| Full diagnostic dump | Forbidden in default production path | Even explicitly enabled, L3 only hash/version; L4 never appears. |

---

## 9. Prompt Registry

Every prompt source requires a registry entry. Record the **maximum sensitivity of the prompt-body source itself**, not user-visible summaries; use separate `summaryDisclosure` for those.

```typescript
interface PromptRegistryEntry {
  promptId: string
  kind: 'master' | 'capability-scenario' | 'subagent' | 'skill' | 'judge' | 'article-generator'
  version: string
  hash: string
  label: 'production' | 'canary' | 'experiment'
  owner: string
  /** prompt body 源本身的最高敏感级；master/subagent/judge/完整 SKILL.md 通常都是 L3 */
  sourceMaxLevel: 'L2' | 'L3'
  /** 允许派生给用户或诊断面的摘要等级；不代表 body 可见 */
  summaryDisclosure: 'none' | 'L1-summary' | 'L2-redacted-preview'
  debugPolicy: 'summary-only' | 'hash-only' | 'redacted-preview'
  telemetryPolicy: 'id-version-hash-only' | 'redacted-summary-only' | 'never'
  configFingerprint?: string
}
```

Requirements:

- Third-party telemetry/debug copy/ordinary exports reference only `promptId/version/hash/label/configFingerprint`.
- Registry may resolve `hash@version` to controlled prompt sources, never through ordinary client UI.
- Existing `zotero-article-generator` `PROMPT_VERSION` is a positive example; extract helper covering master, dynamic context, capability scenarios, subagents, judge/audit, article generator, SDK/plugin skill context.
- Where SDK/plugin injection cannot be fully enumerated, test markers must at least establish whether it enters provider / debug copy / ordinary export / third-party telemetry.

P0 requires only a **minimal fingerprint helper**: Main generates `promptId/version/hash/configFingerprint` for known sources; all outlets reference only these fields. Full registry administration, owners/labels, rollback/canary belong to P1.

---

<a id="10-实现计划"></a>

## 10. Implementation plan

> Follow repository version rules: Increment patch in each changed package's `package.json`. IPC changes synchronize shared constants/types → main handlers/services → preload → renderer.

<a id="p0-&#45;上线门禁"></a>

### P0 · Release gate

| # | Change | Main locations | Acceptance |
|---|---|---|---|
| P0-0 | Minimal redaction foundation: Extend shared synchronous primitives/categories/placeholders; main minimal fingerprint helper, hash/bytes, throttled audit sink. | `packages/shared/src/telemetry/redact.ts` · main formatter/fingerprint helper · `JsonlBuffer`-equivalent audit buffer | Independently usable by P0-1/2/5/7/8; no shared `node:crypto`, async, disk writes; main emits hash/bytes/redactionMatches. |
| P0-1 | Split user-safe/redacted-diagnostic debug formatters; reuse shared primitives; main generates diagnostic hashes. | `apps/electron/src/renderer/components/agent/DebugCopyButton.tsx` · `format-turn-debug-content.ts` · main debug/export formatter | Ordinary copy excludes full thinking, raw tool input/result, system/subagent prompts, tokens/cookies/home paths. |
| P0-2 | Add `toolPreview` to `PermissionRequest`; remove renderer-facing raw `toolInput`. | `apps/electron/src/main/lib/agent-permission-service.ts` · `packages/shared/src/types/agent.ts` · `PreviewFormatters.ts` | No raw `toolInput` in IPC; unknown MCP tools show main hash/bytes/redacted summary; approval resumes SDK using main's internal raw input. |
| P0-3 | Remove renderer-facing raw `toolInput` from `AskUserRequest` / `ExitPlanModeRequest` DTOs. | `agent-ask-user-service.ts` · `agent-exit-plan-service.ts` · `packages/shared/src/types/agent.ts` | No raw AskUser/ExitPlan inputs in renderer state/debug copy/ordinary exports; SDK resume unaffected. |
| P0-4 | Capability details no longer show `scenarioAgent.description` routing prompts; production built-ins require `summaryI18n` / public summary, no description fallback. | `CapabilityPackPanel.tsx` · `capability-pack-utils.ts` · capability schema/loader | No raw description rendering in configuration source/UI; built-ins missing summaries fail validation or hide as experimental. |
| P0-5 | Label telemetry fields L0-L4, purpose, retention, exportable, alertable; redact before sending. | `packages/shared/src/telemetry/event-registry.ts` · `redact.ts` · telemetry sender | Packet capture/SDK hooks prove no raw prompts/tool I/O/thinking/full queries/paths/secrets in third-party payloads. |
| P0-6 | If replay enabled, mask sensitive areas by default and disable with consent. | Third-party replay configuration · Data Collection settings | Replay samples contain no raw user input/prompts/paper excerpts/permission parameters/terminal/stdout/stderr. |
| P0-7 | Error monitoring sends only error class, stack hash, build version, redacted context; main/renderer Sentry beforeSend reuse shared scrubber. | Sentry beforeSend/breadcrumb · `redact.ts` | Synthetic tokens/cookies/paths/queries/tool inputs appear only redacted/hashed in third-party backend; renderer beforeSend independent of main rescrubbing. |
| P0-8 | Separate ordinary and diagnostic exports. | export formatter | Ordinary exports exclude system/subagent/ranking prompts, raw tool I/O, thinking, secrets. |

<a id="p1-&#45;上线前应改"></a>

### P1 · Recommended before launch

| # | Change | Main locations | Acceptance |
|---|---|---|---|
| P1-1 | Full prompt registry: Owner, label, canary/rollback, debug/telemetry policies. | registry types · `apps/electron/src/main/lib/*prompt*` | Only id/version/hash in telemetry/debug/export; controlled version lookup. |
| P1-2 | Scan release default packs/skills/manifests/prompt `.md` readability. | `apps/electron/electron-builder.yml` · release script | Artifact inventory records paths; no assumption clients cannot read sensitive prompts. |
| P1-3 | Register `redLines` / `evidenceSchema` / `auditChecklist`, expose hash/version only. | `agent-prompt-builder.ts` | No full rubric in debug/export/third-party payloads. |
| P1-4 | Inject source availability presence/status only. | `capability-pack-loader.ts` | Visible source status, no keys/secrets/accounts/internal endpoints. |
| P1-5 | Empirically test SDK/plugin skill injection. | orchestrator plugin injection | Report whether SKILL.md/description enters provider/debug/export/telemetry; retain hash/version only where entering. |
| P1-6 | Redact session stderr before append; retention/disable switch. | `agent-session-diagnostics.ts` | No keys/tokens/cookies/home paths in stderr; third-party errors contain summaries only. |
| P1-7 | Reduce permission/hard-rule copy to L0/L1. | `hard-permission-rules.ts` · i18n | Users see action/risk/parameter preview, not full rule library. |
| P1-8 | Stronger audit governance: Sampling, retention, query entry, alert thresholds. | main audit sink / local diagnostics | Auditable redaction without raw sensitive values or high-frequency log growth. |
| P1-9 | Add `redactionPolicyVersion` to prompt/result cache keys. | prompt/result cache namespace | Changed policy version prevents old-cache reuse. |

<a id="p2-&#45;上线后治理"></a>

### P2 · Postlaunch governance

| # | Goal | Action |
|---|---|---|
| P2-1 | Day-2 competitor follow-up tests. | Claude Code, Codex CLI, Gemini CLI, Cursor, OpenHands, Devin: Export transcripts, inspect debug logs, ask for system prompts, observe tool UI, inspect permission prompts. |
| P2-2 | Productize Research provenance panel. | Show queries/sources/filters/counts/screening/exclusion/citation links; raw payloads still redacted. |
| P2-3 | Recurring telemetry-minimization inspection. | Sample dashboard/export/alert payloads periodically. |
| P2-4 | Productize RBAC/team permissions. | Six §13 roles: ordinary users, support, admins, developer diagnostics, registry operations, third-party accounts. |
| P2-5 | Simplify routing snapshot. | Review minimum necessary scenario/subagent fields in master prompt. |

---

<a id="11-第三方-telemetry-字段边界"></a>

## 11. Third-party telemetry field boundaries

| Category | Allowed | Forbidden |
|---|---|---|
| Session/user IDs | Anonymous user/session IDs, tenant/workspace hashes, version, platform, coarse region | Email, name, institution, exact paths, unhashed workspace names, identifying project names |
| Research workflow | Workflow type, step, status, latency, token count, source name/status, result count, error class | Full research question/query/paper excerpts, unredacted seed titles, full source metadata |
| Prompt / agent | promptId, promptVersion, promptHash, capability id, subagent id | Master/system/subagent bodies, judge rubric, ranking prompt, full SDK-injected skill prompt |
| Tool / MCP | Tool name, operation class, success/failure, duration, bytes/hash, redacted preview | Raw `toolInput`/results, secrets/queries/paths in MCP args/urls, file content, complete shell output |
| Debug / reasoning | redactionMatches, error class, stack-frame hash, diagnostic flag | Assistant thinking, hidden chain-of-thought, full debug dumps, raw runtime metadata |
| Secrets / credentials | Presence/status, e.g. `configured: true` | API keys, tokens, cookies, Authorization, private keys, env values, secret-file paths |
| Session replay | Disabled by default or masked text inputs; click/page events only | Raw chat inputs, prompt editors, paper excerpts, permission parameters, terminal/stdout/stderr |

Redaction category alignment:

| Forbidden content | `RedactionCategory` | Default placeholder / treatment |
|---|---|---|
| API key、token、cookie、Authorization、private key | `credential` | `[[REDACTED:credential]]` |
| env value / `ANTHROPIC_*` / cloud provider env | `env-value` | `[[REDACTED:credential]]` |
| master/subagent/judge/ranking prompt body | `prompt-body` | `[[PROMPT:sha256:<first16>@<version>]]` |
| raw `toolInput` / tool result / shell output | `tool-payload` | `[[REDACTED:tool-payload:<hash>]]` |
| Complete dynamic search query / research question | `query` | `[[REDACTED:query:<hash>]]` |
| home/private path / secret file path | `home-path` | `[[REDACTED:path]]` |
| Full papers / PDFs / notes / file content | `file-content` | `[[REDACTED:file-content:<hash>]]` |
| Email, usernames, identifying information | `pii` | `[[REDACTED:pii]]` |
| assistant thinking / hidden chain-of-thought | `thinking` | `[[REDACTED:thinking]]` |
| Unclassified but suspected sensitive | `unknown` | `[REDACTED]` |

---

<a id="12-权限debug导出规范"></a>

## 12. Permission, debug, and export standards

<a id="121-权限提示"></a>

### 12.1 Permission prompts

Permission dialogs show:

- Tool name and action type.
- Risk level.
- Short reason for the matched rule.
- Redacted parameter previews: Path/command summaries, domains, write scope.

Permission dialogs omit:

- Complete internal prompts.
- Entire hard-rule library.
- Full raw `toolInput` JSON.
- env、token、cookie、Authorization、secret value。

### 12.2 Debug copy

Ordinary mode defaults to L0/L1 only. Diagnostic mode outputs redacted L2, hashes, bytes, timing, `redactionMatches`. No one-click full dump in production; debug-copy contents never automatically enter third-party telemetry.

<a id="123-普通导出"></a>

### 12.3 Ordinary exports

Ordinary exports include only:

- User questions and final answers.
- Method/step summaries.
- Query-strategy summaries.
- source/filter/counts。
- screening/exclusion decisions。
- citations / evidence links。

Ordinary exports exclude:

- raw tool input/output。
- thinking / hidden CoT。
- master/subagent/judge/ranking prompt body。
- secret/path/env。
- Complete SDK/plugin-injected skill prompts.

<a id="124-用户直接索要-system-prompt-时的回复策略"></a>

### 12.4 Response policy for direct system-prompt requests

Allowed:

- Explain ASCI's high-level behavior principles.
- Describe capabilities, tools, evidence, and permission boundaries.
- Provide capability/subagent role summaries.
- Describe high-level source availability, e.g. enabled/unconfigured.

Forbidden:

- Full master/subagent prompts, judge rubrics, anti-injection rules.
- Hidden prompt strategies, bypass rules, scoring/ranking details.
- Any secrets/env/tokens/paths.
- Full `scenarioAgent.description` routing prompts, promptPath file bodies, complete SDK/plugin skill prompts.

Suggested wording (English translation):

> I cannot provide complete internal prompts, but can explain the current task's high-level strategy, capabilities, permission risks, and evidence requirements.

---

<a id="13-角色可见性-&#45;rbac"></a>

## 13. Role visibility / RBAC

| Role | Maximum visibility | Notes |
|---|---|---|
| Ordinary user | L0 + L1 | Actions, evidence, plans, summaries. |
| Support | L0 + L1 + event id | No raw payloads. |
| Administrator | Redacted L0-L2 | Redacted diagnostics, hash/version, redaction audits. |
| Controlled developer diagnostics | Redacted L0-L2 | L3 hash/version only; L4 hidden. |
| Prompt registry operations | Manage L3 sources | Separate controlled backend/audit, outside client disclosure surfaces. |
| Third-party account | Minimal L0/L1 + redacted L2 | No L3/L4 or raw-text replay. |

L4 is invisible to every role.

---

<a id="14-竞品对标结论"></a>

## 14. Competitor benchmarking conclusions

`竞品调研矩阵.md` (competitor research matrix) supports this product stance:

- Agent harness consensus: Show plans/actions/evidence/risks; hide full system/developer prompts.
- Research-product consensus: Transparent reports, not backend payloads; show methods/results/sources/citations/screening criteria/exclusion decisions; hide prompts/model payloads/ranking prompts/hidden chain-of-thought.
- Observability products standardize hidden I/O, hidden metadata, masking functions, fixed placeholders, and decoupled prompt versions/labels.
- ASCI should provide reviewable research logs and redacted raw-payload diagnostics rather than promise all raw tool calls/payloads visible.

---

<a id="15-测试与验收"></a>

## 15. Tests and acceptance

| Test | Purpose | Acceptance |
|---|---|---|
| Prompt exposure regression | Whether master/subagent prompts, tool I/O, metadata enter debug copy/ordinary exports/telemetry | Explicit present/absent evidence per item; separate debug-copy/telemetry acceptance. |
| Permission fallback | Whether unknown input displays full JSON | Unknown tools show hash/bytes/redacted summary only. |
| Capability UI exposure | Whether `scenarioAgent.description` remains visible | No full routing prompt in production UI. |
| Redaction L4 | API key, Bearer token, cookie, home path, private-key path, env key | All redacted, auditable `redactionMatches`. |
| Packaged artifact scan | Installed readability of `default-capability-packs`, `default-skills`, manifests, prompt `.md` | Inventory records paths; document client readability is no secrecy boundary. |
| SDK/plugin skill injection | Whether SKILL.md/description enters provider/debug/export/telemetry | Explicit enters/does-not-enter findings. |
| Third-party telemetry payload | Intercept analytics/observability/replay/errors | Allowlisted fields only, others redacted/hashed. |
| Cache-policy version | Policy changes prevent old-cache reuse | Cache key includes `redactionPolicyVersion`. |

Release gate:

- [ ] Ordinary debug copy contains no L2 raw / L3 / L4.
- [ ] Ordinary exports contain no L2 raw / L3 / L4.
- [ ] Permission / AskUser / ExitPlan IPC sends no raw `toolInput` to renderer.
- [ ] Capability configuration omits full `scenarioAgent.description` routing prompts.
- [ ] Third-party telemetry allowlist only, no raw prompts/tool I/O/thinking/full queries/paths/secrets.
- [ ] If replay enabled, mask chat inputs/prompt editors/paper text/permission parameters/terminal.
- [ ] Error monitoring sends only error class, stack hash, build version, redacted context.
- [ ] Artifact scan complete, `default-capability-packs` / `default-skills` readability explicit.
- [ ] SDK/plugin injection tests complete; no full skill prompts in debug copy/ordinary exports/telemetry.
- [ ] Combined scan of debug copy / ordinary exports / stderr / permission / third-party payloads yields 0 master/subagent prompt fragments, credentials, private paths.

---

<a id="16-受影响包与版本号"></a>

## 16. Affected packages and versions

| Package | Change surface | Version |
|---|---|---|
| `packages/shared` | Synchronous `redact.ts` primitives/categories/placeholders, event annotations, permission/AskUser/ExitPlan DTOs, hard-permission copy types | Patch +1 in implementation PR |
| `apps/electron` | Main permission/ask/exit services, capability loader, diagnostics, fingerprints, registry, debug/export/toolPreview formatters, audit sink, renderer Sentry/config UI | Patch +1 in implementation PR |
| `packages/ui` | Only if extracting shared redacted-preview components/export UI | Patch +1 if touched |

Four-part synchronization for IPC changes:

1. `packages/shared/src/...`: Channel constants + request/response types.
2. `apps/electron/src/main/ipc.ts` / main service: Handler and service logic.
3. `apps/electron/src/preload/index.ts`：context bridge。
4. `apps/electron/src/renderer/...`: Atom/hook/component calls.

---

<a id="17-后续文档同步"></a>

## 17. Subsequent documentation synchronization

If this spec enters the repository and implements behavior changes, confirm with maintainers whether to update:

- `CONTEXT.md`: L0-L4, redaction, prompt-registry terms.
- `README.md`: Disclosure, local-first, third-party telemetry red lines.
- `AGENTS.md`: Only when adding lasting hard constraints; user permission required before changes.
