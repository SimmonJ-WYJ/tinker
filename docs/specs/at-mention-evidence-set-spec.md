<a id="agent-对话框-&#45;引用证据集at-mention-evidence-set"></a>

# At-Mention Evidence Sets in the Agent Conversation Input

| Item | Value |
|---|---|
| Status | Draft · awaiting review |
| Related issue | #449 ([ops-feedback] support evidence-set @references in Agent input; P1 / ready-for-agent; source: 0601 test feedback item 27 / yannik) |
| Related PR | To be opened (feat/capability-pack-v4) |
| Integration | Reuse existing @mention stack navigation (`at-mention-helpers.ts`) and Zotero context injection (`zotero-context-block.ts`); evidence-set workspace isolation in #457 |
| Domain language source of truth | `CONTEXT.md`; terminology: evidence set, at-mention panel, mention item, pending mention, mention chip, evidence-set context block, quote (`snapshotText`) |

---

<a id="1-背景与动机"></a>

## 1. Background and Motivation

The Agent input's `@` at-mention panel currently supports four mentionable objects: **files / Zotero collections / Zotero items / library**. After typing `@`, users drill down through stack navigation; selections insert as chips and return to the Agent as structured references when sent.

yannik's feedback (#449, item 27) requests @references to **Evidence Sets**, bringing saved named evidence sets into conversation context for the Agent to read in subsequent tasks.

Evidence sets are existing ASCI first-class objects: a topic-centered collection of multiple `EvidenceRef`s (paper/review/conversation quotes) + a 1:1 bound Note, stored in local SQLite. Users currently can view them only in detail panels and cannot feed them to the Agent. This spec completes that path.

---

<a id="2-范围与非目标"></a>

## 2. Scope and Non-goals

**Scope**:
- Add an “Evidence sets” category to `@`, alongside file / zotero-col / zotero-item / library, supporting browsing/search/selection in `@`.
- Insert consistent chips and send structured references to the Agent.
- Main process expands evidence-set contents before the user message so the Agent can read them.

**Non-goals**:
- No conversation-based evidence-set **creation/editing/deletion** (reference existing named sets only).
- No temporary-set references (`persisted=false`); unnamed temporary sets stay out of the picker.
- No evidence-set Agent tools (MCP/SDK tool): §6 chooses inline injection now, tools later.
- No changes to evidence-set data model / storage / existing IPC semantics.

---

<a id="3-现状事实源已读源码确认"></a>

## 3. Current Sources of Truth (Verified in Source)

<a id="31-&#45;提及链路渲染侧"></a>

### 3.1 @Mention Path (Renderer)

| Stage | Location |
|---|---|
| Stack navigation (`AtMentionLevelKind` / `enterLevel` / `goBack` / `isLeaf` / `toDrillTarget` / `isLegalTransition`) | `apps/electron/src/renderer/components/agent/at-mention-helpers.ts` |
| `AtMentionItem` types + rendering + keyboard navigation | `apps/electron/src/renderer/components/agent/AtMentionPanel.tsx` |
| Per-level `buildItems(level, query)` + `insertChip` + Enter/→/← semantics | `apps/electron/src/renderer/components/agent/at-mention-suggestion.tsx` |
| `AgentPendingMention` (`kind: 'file' \| 'zotero-item' \| 'zotero-col'`) + deduplicated atom writes | `apps/electron/src/renderer/atoms/agent-atoms.ts` |
| Token formatting + `AgentSendInput` assembly | `apps/electron/src/renderer/components/agent/AgentView.tsx` (`handleSend`) |
| Token regex extraction | `apps/electron/src/renderer/components/agent/at-mention-parse.ts` |

Existing tokens: `@file:<path>`, `@zotero-item:<key>|<encodedLabel>`, `@zotero-col:<key>|<encodedLabel>`.

Root-level items are category entries (`buildItems` root branch in `at-mention-suggestion.tsx`), currently two `category` items (project-files / library-root).

<a id="32-agent-侧消费主进程"></a>

### 3.2 Agent Consumption (Main Process)

- While assembling `enrichedMessage`, `agent-orchestrator.ts` calls `buildZoteroContextBlock(mentionedZoteroItems, mentionedZoteroCollections)` (`apps/electron/src/main/lib/zotero-context-block.ts`, pure and unit-tested), injecting `<zotero-context>` before the user message.
- Zotero blocks **inject reference metadata only**; Zotero MCP tools retrieve full text on demand.

<a id="33-证据集体系"></a>

### 3.3 Evidence-Set System

| Stage | Location |
|---|---|
| `EvidenceSet` / `EvidenceSetDetail` / `EvidenceSetSummary` types | `packages/shared/src/types/objects/evidence-set.ts`, `packages/shared/src/types/evidence-sets.ts` |
| Storage | Local SQLite `~/.asci/asci.db` (dev: `~/.asci-dev/asci.db`) |
| Services / aggregate query `queryEvidenceSetDetail` | `apps/electron/src/main/lib/evidence-set-service.ts`, `apps/electron/src/main/lib/objects/query-service.ts` |
| `EVIDENCE_SETS_IPC_CHANNELS` (including `LIST_SUMMARY` by workspaceId + persistedOnly, `GET_DETAIL`) | `packages/shared/src/types/evidence-sets.ts`, `apps/electron/src/main/ipc.ts` |
| Preload bridge `window.electronAPI.evidenceSets.*` | `apps/electron/src/preload/index.ts` |

`EvidenceSetDetail` = `{ set, note, refs, memberPapers, memberReviews, memberConversations, sourceReview }`; each `EvidenceRef` anchor embeds verbatim `snapshotText`; `memberPapers` includes `zoteroKey`.

**Key fact**: evidence sets **currently have no Agent-callable MCP/tools** (no evidence definitions under main/lib mcp/tools).

---

<a id="4-关键设计决策"></a>

## 4. Key Design Decisions

> **D1 — Main process must inject content inline, rather than copying Zotero's reference-only + MCP-full-text pattern.**
> Evidence sets lack Agent retrieval tools. Main already has synchronous DB access (`getObjectsDb()`) + `queryEvidenceSetDetail`; expanding there avoids large IPC payloads and fits existing architecture.

> **D2 — Return only `{ id, name }`; main expands content.**
> Renderer does not prefetch detail or put large contents in `AgentSendInput`; keep renderer thin, main the source of truth.

> **D3 — List named persisted sets only (`persistedOnly: true`).**
> Temporary sets are unnamed byproducts of conversation/selection and do not belong in pickers.

> **D4 — Fully reuse @panel interaction/styles** (acceptance item 4 is mandatory).
> New kind joins existing stack navigation + keyboard + insertChip + chip row.

> **D5 — Evidence-set content = note motivation + each `snapshotText` quote + member paper/review/conversation snapshots.**
> This is the evidence the Agent needs. Member papers' `zoteroKey` can reuse `zoteroAttachments` to supply PDFs (optional enhancement §5.4).

---

<a id="5-方案"></a>

## 5. Approach

<a id="51-面板侧新增-evidence-set-可提及-kind"></a>

### 5.1 Panel: New `evidence-set` Mention Kind

**Navigation model** `at-mention-helpers.ts`:
- Add `'evidence-set-list'` to `AtMentionLevelKind` (leaf level).
- Add `{ kind: 'evidence-set-list' }` to `AtMentionEnterTarget`.
- Make `root → evidence-set-list` legal in `isLegalTransition`.
- Add `{ kind: 'evidence-set' }` to `AtMentionItemLike`; `isLeaf` returns `true`; `toDrillTarget` returns the target for `category(target: 'evidence-set-list')`.

**Panel item type** `AtMentionPanel.tsx`:
- Add `{ kind: 'evidence-set'; set: EvidenceSetSummary }` to `AtMentionItem`.
- Add `'evidence-set-list'` to root `category` target union.
- Rendering uses an icon (suggest `Layers` / `FolderTree`, semantic color tokens), `set.name`, and optional secondary `paperCount` / `notePreview`.

**`buildItems`** `at-mention-suggestion.tsx`:
- Append `{ kind: 'category', target: 'evidence-set-list', labelKey: 'atMention.category.evidenceSet', icon: ... }` to root.
- Add `level.kind === 'evidence-set-list'`: call `window.electronAPI.evidenceSets.listSummary({ workspaceId, persistedOnly: true })`, filter `name` case-insensitively with `includes` (existing filter style), cap via `slice` (e.g. 50).
  - **workspaceId source**: forward through `cfg` (`AgentView` already derives `currentWorkspaceId`). Without a workspace, return [] + empty placeholder.
- Breadcrumb / empty state: add i18n keys following library branch.

**`insertChip` + keyboard**: `evidence-set` takes the leaf path (same branch as file / zotero-item), `cfg.onMentionAdd?.({ kind: 'evidence-set', id: set.id, label: set.name })`.
Reuse existing `onKeyDown` for ↑↓ / → / ← / Enter / Esc; **zero new key logic**.

**Pending mention type** `agent-atoms.ts`:
- Add `'evidence-set'` to `AgentPendingMention.kind` (id=evidence-set ObjectId, label=name). Deduplicating atom writes remain unchanged (already kind+id).

<a id="52-数据回传token-&#45;结构化引用"></a>

### 5.2 Return Data (Token → Structured Reference)

**`AgentView.tsx` `handleSend`** mentionTokens:
```
if (m.kind === 'evidence-set') return `@evidence-set:${m.id}|${encodeURIComponent(m.label)}`
```

**`at-mention-parse.ts`**: add `extractEvidenceSetIds(text)` (reuse `extractUnique`, regex `/@evidence-set:(\S+)/g`, take id before `|`).

**`AgentView.tsx`** assembly: extract ids from `effectiveText`, pair with `pendingMentions` labels, populate `mentionedEvidenceSets: Array<{ id: string; name: string }>`; attach to `AgentSendInput` only when nonempty.

<a id="53-agent-侧消费主进程-inline-序列化"></a>

### 5.3 Agent Consumption (Main-Process Inline Serialization)

**Shared types** `packages/shared/src/types/agent.ts`:
add `mentionedEvidenceSets?: Array<{ id: string; name: string }>` to `AgentSendInput`.

**New pure function** `apps/electron/src/main/lib/evidence-set-context-block.ts` (like `zotero-context-block.ts`, no Electron dependency, unit-testable):
- Input: `EvidenceSetDetail[]`.
- Output: `<evidence-set-context>` string or `null` when empty.
- Each block includes set name / note motivation (`note.body`), member papers (title + zoteroKey), reviews, conversation snapshots, and each ref's `snapshotText` quote.
- **Truncation and disclosure**: cap quotes / members (e.g. ≤N quotes per set), explicitly state “M items omitted” beyond the limit (no silent caps); skip `removed` refs or mark “Source deleted.”

**Orchestrator** `apps/electron/src/main/lib/agent-orchestrator.ts` (near `<zotero-context>` injection, around §11.7):
- Destructure `mentionedEvidenceSets` from `input`.
- Call `queryEvidenceSetDetail(getObjectsDb(), id)` per set, filtering `null`.
- `buildEvidenceSetContextBlock(details)` → prepend to `enrichedMessage` alongside Zotero block.
- `console.log` injected counts (Chinese logs, matching existing style).

<a id="54-增强可选非核心可拆后续"></a>

### 5.4 Enhancement (Optional, Noncore, May Follow Separately)

Merge member `zoteroKey`s into existing `zoteroAttachments` / `mentionedZoteroItems` resolution so the Agent receives absolute PDF full-text paths (reuse §11.6 `<zotero_attachments>` injection).
This round may deliver only §5.3 metadata + quotes; if PDF enhancement exceeds available time, open a separate issue.

### 5.5 i18n

New keys (synchronized en + zh, `key-parity` guard):
- `atMention.category.evidenceSet` (root entry)
- `atMention.breadcrumb.evidenceSet` (breadcrumb)
- Empty evidence-list / no-workspace placeholders
- Built-in injection copy (inside `<evidence-set-context>`) uses **English** (built-in prompt rule, CLAUDE.md core rules; non-UI copy stays out of i18n)

---

<a id="6-ipc-四联同步说明"></a>

## 6. Four-Layer IPC Synchronization

This feature **adds no IPC channels**:

- **Sending**: reuse `sendAgentMessage`, only **adding** `mentionedEvidenceSets` to `AgentSendInput`; the four locations share the same input chain:
  1. Shared definition (`agent.ts`)
  2. Orchestrator consumption (`agent-orchestrator.ts`)
  3. Preload forwarding (`sendAgentMessage` already forwards whole input; usually unchanged)
  4. Renderer construction (`AgentView.tsx`)
- **Listing**: `evidenceSets.listSummary` already has shared constants + main handler + preload bridge + consumers. Call directly from panel, no four-layer changes.

---

<a id="7-验收对照issue-449"></a>

## 7. Acceptance Mapping (Issue #449)

| Acceptance | Coverage |
|---|---|
| New browsable/searchable/selectable Evidence sets category in @panel | §5.1 root category + `evidence-set-list` + `listSummary` filtering |
| Consistent reference insertion + structured Agent return | §5.1 pendingMention/chip + §5.2 `@evidence-set:` token + `mentionedEvidenceSets` |
| Agent reads evidence-set contents | §5.3 `queryEvidenceSetDetail` → `<evidence-set-context>` injection |
| Reuse existing @panel interaction/styles (keyboard/insertion) | §5.1 existing nav / keyboard / insertChip / chip row throughout |
| useT, en+zh, key-parity; four layers for IPC data | §5.5 synchronized keys; §6 field expansion with existing send + listSummary |
| Affected package patches; typecheck + bun test; actual dev run | §8 + §9 |

---

<a id="8-受影响包与版本号"></a>

## 8. Affected Packages and Versions

Increment each patch once when opening PR:
- `apps/electron` (panel / AgentView / parse / orchestrator / context-block / i18n)
- `packages/shared` (`AgentSendInput.mentionedEvidenceSets`)

---

<a id="9-测试计划"></a>

## 9. Test Plan

**Unit (`bun test`)**:
- `evidence-set-context-block.test.ts`: empty → `null`; single/multiple block structure; truncation disclosure; `removed` handling.
- `at-mention-parse.ts`: `extractEvidenceSetIds` extraction + deduplication + `|label` stripping.
- `at-mention-helpers.ts`: legal `root → evidence-set-list` + `evidence-set` leaf classification.
- `key-parity.test.ts`: aligned new en/zh keys (automatic).

**Types**: monorepo `bun run typecheck` passes (no missed union branches for `AgentPendingMention` / `AtMentionItem` / `AgentSendInput`).

**Manual golden path (`bun run dev`)**:
1. Type `@` → Evidence sets entry → enter → current workspace's named sets.
2. Filter by name; ↑↓ select, →/Enter insert, ← back, Esc close.
3. Selection inserts a consistent removable chip.
4. Send → Agent reply reflects evidence contents (quotes/member papers).
5. Boundaries: no workspace / empty list → placeholder without errors.
6. Repeat in zh ↔ en through settings, with no raw keys or untranslated copy.

---

<a id="10-风险与边界"></a>

## 10. Risks and Boundaries

- **Workspace isolation**: always send `workspaceId` to `listSummary` (#457); new sessions / no workspace show empty states, not errors.
- **Prompt size**: large inline sets enlarge prompts → §5.3 mandatory truncation + explicit omitted count.
- **Soft-deleted members**: `queryEvidenceSetDetail` refs may be `removed`; skip or mark “Source deleted.”
- **persistedOnly**: list named sets only; no temporary sets (D3).
- **Label drift**: chip uses selection-time name; after renaming, this turn uses token label while main re-queries authoritative content by stable id.

---

<a id="11-实现顺序建议tracer-bullet"></a>

## 11. Suggested Implementation Order (Tracer Bullet)

1. Shared: `AgentSendInput.mentionedEvidenceSets` + type exports.
2. Main: `evidence-set-context-block.ts` (+ tests) → orchestrator injection.
3. Renderer: `at-mention-helpers` navigation → `AtMentionPanel` types/render → `at-mention-suggestion` buildItems/insertChip → `agent-atoms` pendingMention kind.
4. Renderer: `AgentView` token + extraction + assembly; `at-mention-parse` extraction function (+ tests).
5. i18n en/zh keys.
6. Run typecheck + bun test + dev golden path; `simplify` review.
