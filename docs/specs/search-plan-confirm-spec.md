> Historical research specification: preserves old design/data semantics and does not require new features or restored runtime wiring. Proactive research features are being wound down in batches under the [retirement specification](./2026-11-10-research-retirement.md); corresponding execution records govern completed and unaccepted scope.

<a id="检索方案确认组件-specsearch-plan-confirmation"></a>

# Search Plan Confirmation Component Spec

> **Status**: draft · awaiting review
> **Related issue**: #435 ([ops-feedback] Search plan confirmation component · 0601 feedback item 10 · Xuwu)
> **Related PR**: TBD
> **Domain language source of truth**: terminology in §2; aligned with `CONTEXT.md`
> **Reference dependency**: lit-review "Choose review direction" full chain (present_directions); this spec mirrors it 1:1

---

<a id="1-背景与问题"></a>

## 1. Background and Problem

Current lit-search retrieval flow: the scenario Agent produces `## SEARCH PLAN` in its planning turn (intent / keywords / sources / method_terms / object_terms / steps…), but **the plan is only fenced JSON text in the conversation**. The Agent then immediately dispatches a `searcher` subagent to call `mcp__paper-search__retrieve` and begin.

User feedback (Xuwu, translated):
1. **The plan is buried in text with a hidden entry point and poor readability**;
2. **No intervention point before execution**: users cannot clearly see the proposed strategy or confirm/fine-tune it before retrieval begins.

> Source prompt section: `apps/electron/default-capability-packs/lit-search/scenario/system-prompt.md` §"Planning turn — output format" (around L29-80).

<a id="2-目标与术语"></a>

## 2. Goals and Terminology

**Goal**: before lit-search actually retrieves, the Agent presents its structured plan through an **in-conversation confirmation component**; users **confirm / adjust / cancel**, and the Agent acts accordingly.

**Key criteria (from issue AC)**:
- Reuse existing `ChoiceCard` / `choice-tokens`; **do not change right-side WorkspacePanel**; use semantic color tokens without hardcoded palettes;
- Complete Agent → frontend "plan awaiting confirmation" → response-and-continue chain (synchronize all four IPC layers if involved);
- Clearly display **individual plan sections**, rather than one text block;
- Use `useT`, synchronize en + zh, pass `key-parity`; increment affected package patches; pass `typecheck` + `bun test`.

**Terminology**:
| Term | Meaning |
|------|------|
| Search Plan | Structured Agent retrieval strategy: research question + keywords + target sources + method/object terms + time range + target count |
| Search plan confirmation component | ChoiceCard in conversation displaying plan sections + [Confirm and run / Adjust myself / Cancel] |
| Plan confirmation chain | Agent emits pending plan → frontend renders → user acts → tool_result returned → Agent continues |

<a id="3-设计决策已拍板"></a>

## 3. Design Decisions (Settled)

<a id="31-调整交互粒度mvp-&#45;自然语言调整"></a>

### 3.1 Adjustment Granularity: MVP — Natural-Language Adjustment

**Reuse lit-review present_directions 1:1**, without a new editable form component:

- ChoiceCard `body` renders read-only plan sections; `options` = `confirm` / `adjust` / `cancel`;
- Choose **`confirm`** → execute original plan;
- Choose **`adjust`** → free-text input (same interaction as present_directions `custom`); users describe changes in a sentence ("search arxiv only," "after 2020," "remove keyword X"). On receiving `adjust` + text, the Agent **produces a revised plan for confirmation again**;
- Choose **`cancel`** (including Esc) → abandon this retrieval.

> Inline editable forms (add/remove chips / multi-source selection / range fields → structured adjustments) are **outside this spec**, reserved for later issues. Rationale: ship the confirmation chain quickly and refine editing later. The issue notes endorse this phased approach.

<a id="32-复用-vs-新建"></a>

### 3.2 Reuse vs New

| Reuse (unchanged) | New (mirroring litreview files) |
|------|------|
| `ChoiceCard` / `ChoiceCardShell` / `choice-tokens` | `SearchPlanCard` (ChoiceCard wrapper rendering sectional plan body) |
| `useActiveBannerSlot` (**add only 1 slot**) | `SearchPlanBanner` (atom → banner → card → IPC response) |
| `AgentEventBus` emit mechanism | `agent-search-plan-service.ts` (Promise + Map async waiting) |
| Orchestrator SDK MCP registration (beside L727-739) | `search-plan-sdk-mcp.ts` (`present_search_plan` tool) |
| — | `packages/shared/.../search-plan-ipc.ts` (channels + types) |

<a id="4-数据契约"></a>

## 4. Data Contract

<a id="41-方案-schemapackagessharedsrctypessearch-plan-ipcts新建"></a>

### 4.1 Plan Schema (`packages/shared/src/types/search-plan-ipc.ts`, New)

```ts
export const SEARCH_PLAN_IPC_CHANNELS = {
  /** renderer → main：用户已确认/调整/取消，回填 tool result */
  RESPOND: 'search-plan:confirm-respond',
} as const

/** 单项检索方案（UI 友好裁剪自 lit-search SEARCH PLAN） */
export interface SearchPlanProposal {
  /** 研究问题（一句话，卡片头/副标题） */
  researchQuestion: string
  /** 关键词（核心概念 + 同义词），分项 chips 展示 */
  keywords: string[]
  /** 目标源：openalex / crossref / arxiv ... */
  sources: string[]
  /** 方法词（可选，分项展示） */
  methodTerms?: string[]
  /** 对象词（可选，分项展示） */
  objectTerms?: string[]
  /** 时间范围（可选） */
  timeRange?: { from?: number; to?: number }
  /** 目标数量（可选，对应 retrieve top_k / stop_conditions 概数） */
  targetCount?: number
}

/** present_search_plan 请求（main → renderer，走 agent event stream） */
export interface SearchPlanConfirmRequest {
  requestId: string
  sessionId: string
  plan: SearchPlanProposal
  /** "我来调整" 按钮文案（默认 zh/en 由前端 i18n 提供，可被 prompt 覆盖） */
  adjustLabel?: string
}

/** present_search_plan 响应（renderer → main） */
export type SearchPlanConfirmResponse =
  | { requestId: string; choice: 'confirm' }
  | { requestId: string; choice: 'adjust'; adjustment: string }
  | { requestId: string; choice: 'cancel' }
```

<a id="42-tool_result-回给-agent"></a>

### 4.2 tool_result Returned to Agent

`search-plan-sdk-mcp.ts` serializes results as `{ content: [{ type: 'text', text: JSON }] }` (mirrors litreview `resultToContent`):
- `confirm` → `{ "choice": "confirm" }`
- `adjust` → `{ "choice": "adjust", "adjustment": "<用户自由文本>" }` (placeholder means user free text)
- `cancel` → `{ "choice": "cancel" }`

<a id="5-端到端链路与-present_directions-逐层对称"></a>

## 5. End-to-End Chain (Mirrors Each Layer of present_directions)

```
lit-search planning: SEARCH PLAN → mcp__searchplan__present_search_plan
  → search-plan-sdk-mcp.ts tool handler (closure holds sessionId / sendToRenderer)
  → searchPlanService.handlePresentSearchPlan()  ── await Promise + Map<requestId>
  → eventBus.emit('search_plan_request')          ── new AgentStreamEvent type
  → useGlobalAgentListeners → allPendingSearchPlanRequestsAtom（Map<sessionId, req[]>）
  → useActiveBannerSlot arbitration (new 'searchPlan' slot)
  → SearchPlanBanner → SearchPlanCard (ChoiceCard: body=plan sections, options=confirm/adjust/cancel)
  → user action → window.electronAPI.respondSearchPlan(response)
  → ipcMain.handle(SEARCH_PLAN_IPC_CHANNELS.RESPOND) → searchPlanService.respondConfirm()
  → Promise resolve → tool_result to Agent → emit('search_plan_resolved')
  → Agent: confirm→dispatch searcher; adjust→revise/reconfirm; cancel→close without retrieval
```

<a id="6-实现清单按依赖顺序"></a>

## 6. Implementation Checklist (Dependency Order)

### 6.1 shared（`packages/shared`，patch++）
- [ ] Add `src/types/search-plan-ipc.ts` (all §4.1 types + channel constants), export from `index.ts`;
- [ ] Add to the `AgentStreamEvent` union in `src/types/agent.ts`:
  `{ type: 'search_plan_request'; request: SearchPlanConfirmRequest }`、
  `{ type: 'search_plan_resolved'; requestId: string }`。

### 6.2 main（`apps/electron`，patch++）
- [ ] Add `src/main/lib/agent-search-plan-service.ts` (follow `agent-litreview-directions-service.ts`: Promise+Map, `handlePresentSearchPlan` / `respondConfirm` / `getPendingRequests` / `clearSessionPending`, exporting singleton `searchPlanService`);
- [ ] Add `src/main/lib/search-plan-sdk-mcp.ts` (follow `litreview-sdk-mcp.ts`: `present_search_plan` tool + zod input schema + `resultToContent`; server name `searchplan`, exposed tool `mcp__searchplan__present_search_plan`);
- [ ] Register beside `agent-orchestrator.ts` L727-739: `mcpServers['searchplan'] = createSearchPlanSdkMcpServer(sessionId, (request) => eventBus.emit(sessionId, { kind:'asci_event', event:{ type:'search_plan_request', request } }))`;
- [ ] Add `ipcMain.handle(SEARCH_PLAN_IPC_CHANNELS.RESPOND, ...)` in `ipc.ts` (follow litreview L1328-1341, emit `search_plan_resolved` after response);
- [ ] Call `searchPlanService.clearSessionPending(sessionId)` on session cancellation/cleanup (same locations as litreview).

### 6.3 preload（`apps/electron`）
- [ ] `src/preload/index.ts`: expose `respondSearchPlan: (r: SearchPlanConfirmResponse) => ipcRenderer.invoke(SEARCH_PLAN_IPC_CHANNELS.RESPOND, r)` and add `respondSearchPlan` to type declarations (follow L450 / L1229).

### 6.4 renderer（`apps/electron`，patch++）
- [ ] `atoms/agent-atoms.ts`: add `allPendingSearchPlanRequestsAtom` (Map<sessionId, SearchPlanConfirmRequest[]>), following `allPendingLitReviewDirectionsRequestsAtom`;
- [ ] `hooks/useGlobalAgentListeners.ts`: enqueue on `search_plan_request`, dequeue on `search_plan_resolved` (follow L76-79 / L533-540);
- [ ] `components/agent/choice/useActiveBannerSlot.ts`: add `'searchPlan'` to `BannerSlot` and insert into arbitration (suggest near the same priority as `litReviewDirections`);
- [ ] Add `components/agent/choice/SearchPlanCard.tsx`: render plan sections in ChoiceCard body (research question / keyword chips / sources / method-object / time range / count), options = confirm/adjust/cancel; `adjust` opens free-text input returning `{ choice:'adjust', adjustment }`;
- [ ] Add `components/agent/SearchPlanBanner.tsx` (follow `LitReviewDirectionsBanner.tsx`: read atom, check slot with `useActiveBannerSlot`, respond through `respondSearchPlan`);
- [ ] `components/agent/AgentView.tsx`: mount `<SearchPlanBanner sessionId={sessionId} />` beside `LitReviewDirectionsBanner`.

### 6.5 i18n（`apps/electron`，patch++）
- [ ] Add `searchPlanConfirm.*` keys under agent namespace: `title` / `subtitle` / section labels (researchQuestion/keywords/sources/methodTerms/objectTerms/timeRange/targetCount) / `action.confirm` / `action.adjust` / `action.cancel` / `adjustPlaceholder`; **synchronize en + zh**, pass `key-parity.test.ts`.

### 6.6 prompt（`apps/electron/default-capability-packs/lit-search`，pack version++）
- [ ] Insert a **mandatory** step at the planning-turn conclusion in `scenario/system-prompt.md`: after SEARCH PLAN and before dispatching `searcher`, **must** call `mcp__searchplan__present_search_plan` with trimmed `SearchPlanProposal`; handle results:
  - `confirm` → dispatch searcher with original plan;
  - `adjust` → rewrite SEARCH PLAN using `adjustment`, call present_search_plan **again** for confirmation (may loop);
  - `cancel` → no retrieval; brief closing response.
- [ ] Decide whether `direct_lookup` (exact-lookup) / citation-tracing also require confirmation (suggest: single-ID exact-lookup **may skip**; only general-query / citation-tracing multi-source retrieval confirms—await review, §8).

<a id="7-验收映射ac-&#45;实现"></a>

## 7. Acceptance Mapping (AC → Implementation)

| Issue AC | Satisfied by |
|------|------|
| Confirmation appears in conversation before retrieval, with clear plan sections | §6.4 SearchPlanCard + §6.6 mandatory prompt call |
| Confirmation executes plan; adjustments execute adjusted result | §3.1 confirm/adjust semantics + §6.6 prompt |
| Reuse ChoiceCard/choice-tokens, no WorkspacePanel changes, semantic tokens | §3.2 reuse table; SearchPlanCard only wraps ChoiceCard |
| Complete Agent↔frontend chain (four IPC layers synchronized) | §6.1-6.4 shared→main→preload→renderer |
| useT, en+zh, key-parity, patch++, typecheck+test | §6.5 + package patches |
| `bun run dev` golden path | Manual pre-delivery validation (§9) |

<a id="8-待-review-拍板的开放问题"></a>

## 8. Open Questions for Review

1. **Which intents require confirmation?** Suggest only general-query / citation-tracing multi-source retrieval; skip single-ID exact-lookup to avoid needless interruption.
2. **Limit adjustment loops?** Suggest a soft cap (e.g. 3), then prompt the user or degrade to direct execution to prevent oscillation.
3. **Slot priority**: searchPlan and litReviewDirections do not appear together (different packs), but still need explicit ordering in `useActiveBannerSlot`.
4. **lit-search SEARCH PLAN → SearchPlanProposal field trimming**: steps / stop_conditions / needs_closing_turn stay out of UI; show only understandable retrieval dimensions—confirm the trimmed set suffices.

<a id="9-自验清单交付前"></a>

## 9. Pre-Delivery Self-Check

- [ ] `bun run typecheck` passes
- [ ] `bun test` passes (including `key-parity.test.ts`)
- [ ] Affected package patches incremented (shared / electron + lit-search pack version)
- [ ] Run `simplify` / `@code-simplifier`
- [ ] `bun run dev`: start retrieval → confirmation component → confirm executes plan; adjust produces revised plan; cancel terminates—walk through zh/en once each without raw keys
- [ ] Confirm no WorkspacePanel changes or hardcoded Tailwind palettes
