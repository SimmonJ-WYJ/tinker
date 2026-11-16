<a id="助手输出反馈按钮-specoutput-feedback-buttons-specification"></a>

# Assistant Output Feedback Buttons Specification

> **Status**: draft · awaiting review
> **Related issue**: #477 (feat(conversation): add 👍/👎 feedback buttons to assistant output)
> **Related PR**: — (to be opened)
> **Domain language source of truth**: §3 data model; terminology consolidation into `CONTEXT.md` pending
> **Changed packages**: `@asci/shared` (IPC channels + types), `apps/electron` (renderer + main + preload)

---

<a id="1-概述与目的"></a>

## 1. Overview and Purpose

Add “👍 Agree / 👎 Disagree” buttons to the action toolbar beneath each assistant message, allowing users to express their **immediate impression** in one click and persist each click. This is ASCI's first user-feedback entry focused on output quality, supplying firsthand data for later quality evaluation and analysis by model / capability-pack scenario.

**Design criteria**: zero learning cost (self-explanatory icons), one-click expression, uninterrupted conversation; backend turns each click into a structured analyzable event.

<a id="11-不做的事non-scope"></a>

### 1.1 Non-scope

- Feedback aggregation / dashboards / export (later issue).
- Additional reason input for disagreement (one-click signals first, secondary input in phase two).
- Feedback influencing subsequent Agent generation (collection only, no closed loop).
- Cross-device synchronization / cloud reporting (local persistence first).

---

<a id="2-交互规格"></a>

## 2. Interaction Specification

<a id="21-位置与顺序"></a>

### 2.1 Position and Order

Render in `<MessageActions>` in `apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx` (approximately lines 666–700), **after `<CopyButton>`**, shifting subsequent buttons:

| Order | Button | Component / icon | Note |
|------|------|------------|------|
| 1 | Copy | `CopyButton` | Unchanged |
| **2** | **Agree** | **`MessageAction` + lucide `ThumbsUp`** | **New** |
| **3** | **Disagree** | **`MessageAction` + lucide `ThumbsDown`** | **New** |
| 4 | Add to evidence set | `AddToEvidenceSetButton` | Shift later |
| 5 | Debug copy | `DebugCopyButton` (dev-only) | Shift later |
| 6 | Branch | `MessageAction` + `Split` | Shift later |
| 7 | Withdraw | `MessageAction` + `Undo2` | Shift later |

> Retain existing `className="size-4"`; both new icons **must** come from lucide <https://lucide.dev/icons/> ([`thumbs-up`](https://lucide.dev/icons/thumbs-up) / [`thumbs-down`](https://lucide.dev/icons/thumbs-down)), imported through `lucide-react`; no custom drawing or other icon libraries.

<a id="22-状态机单条消息"></a>

### 2.2 State Machine (Per Message)

Three mutually exclusive states: `none` (default, no feedback) → `up` / `down`.

| Current | Click agree | Click disagree |
|--------|---------|-----------|
| `none` | → `up` | → `down` |
| `up` | → `none` (cancel) | → `down` (switch) |
| `down` | → `up` (switch) | → `none` (cancel) |

- **Selected highlight**: semantic tokens (e.g. `text-primary` / `text-foreground` + filled state); unselected uses toolbar `text-muted-foreground`; **no hardcoded Tailwind palette** such as `text-green-500`.
- **Optimistic update**: update UI immediately, persist asynchronously; rollback on write failure and show existing toast (errors must be visible and actionable).
- **Restoration**: on session switch / application reopening, retrieve feedback by `sessionId` and populate message selections.
- **Granularity**: each assistant message is independent.

---

<a id="3-数据模型"></a>

## 3. Data Model

<a id="31-落盘事件append-only-jsonl一行一事件"></a>

### 3.1 Persistent Events (Append-Only JSONL, One Event per Line)

Location: `~/.asci/feedback/<sessionId>.jsonl` (dev: `~/.asci-dev/feedback/<sessionId>.jsonl`), matching conversation-per-file storage at `~/.asci/conversations/<id>.jsonl`. **Append** every change, including switching / cancellation (`none`), retaining full history; restore by folding on `messageUuid` and taking the **last event**.

Original type comments describe messageUuid as the last-event fold key; optional paired user-message UUID, workspace/model/scenario dimensions; none as cancellation; ISO 8601 write time; and a restoration map excluding none.

```typescript
// packages/shared/src/types/output-feedback.ts
export type OutputFeedbackValue = 'up' | 'down' | 'none'

/** 落盘的单条反馈事件（append-only JSONL，一行一条） */
export interface OutputFeedbackEvent {
  /** 助手消息 uuid（折叠键；同一 uuid 取最后一条为当前态） */
  messageUuid: string
  /** 对应用户提问消息 uuid（可空：极端历史消息无配对提问） */
  userMessageUuid?: string
  /** Agent session id */
  sessionId: string
  /** workspace id（按 workspace 切分分析用，可空） */
  workspaceId?: string
  /** 反馈值；'none' 表示取消表态 */
  value: OutputFeedbackValue
  /** 事件写入时间，ISO 8601 */
  createdAt: string
  /** 可选维度：产出该消息的模型 id */
  model?: string
  /** 可选维度：能力包 scenario 标识 */
  scenario?: string
}

/** 回显：sessionId → { messageUuid → 当前态(up/down) }，none 不返回 */
export type SessionFeedbackMap = Record<string, Exclude<OutputFeedbackValue, 'none'>>
```

> Rationale: feedback is an **append-only event log**, matching CLAUDE.md's JSONL convention; it is not relational / large structured data, so do not introduce SQLite. Per-session files make restoration read one small file rather than scanning all data.

---

<a id="4-ipc-通道契约"></a>

## 4. IPC Channel Contract

Add constants and request/response types in `packages/shared/src/types/output-feedback.ts` (after §3 types). Original comments define SET as write/switch/cancel returning current folded state, GET_FOR_SESSION as restoration-map retrieval, and none → null in results for renderer highlighting.

```typescript
export const OUTPUT_FEEDBACK_IPC_CHANNELS = {
  /** 写入/切换/取消一条反馈，返回折叠后的当前态 */
  SET: 'outputFeedback:set',
  /** 拉取某 session 的回显 map */
  GET_FOR_SESSION: 'outputFeedback:getForSession',
} as const

export interface OutputFeedbackSetInput {
  sessionId: string
  messageUuid: string
  userMessageUuid?: string
  workspaceId?: string
  value: OutputFeedbackValue
  model?: string
  scenario?: string
}
/** 返回折叠后的当前态（none → null，便于渲染端判断高亮） */
export interface OutputFeedbackSetResult {
  value: Exclude<OutputFeedbackValue, 'none'> | null
}

export interface OutputFeedbackGetForSessionInput {
  sessionId: string
}
export type OutputFeedbackGetForSessionResult = SessionFeedbackMap
```

Re-export the module in `packages/shared/src/types/index.ts`.

---

<a id="5-四联同步落点照文件改"></a>

## 5. Four-Layer Synchronization Locations (By File)

| # | Layer | File | Change |
|---|----|------|------|
| 1 | shared | `packages/shared/src/types/output-feedback.ts` **(new)** | §3 types + §4 constants and request/response types |
| 1' | shared | `packages/shared/src/types/index.ts` | `export * from './output-feedback.ts'` |
| 2 | main | `apps/electron/src/main/lib/output-feedback-service.ts` **(new)** | `appendEvent(event)` appends JSONL; `getSessionMap(sessionId)` reads and folds to `SessionFeedbackMap`; lazily create missing directory |
| 2' | main | `apps/electron/src/main/lib/config-paths.ts` | Add `getOutputFeedbackDir()` → `~/.asci/feedback/`, `getOutputFeedbackPath(sessionId)` → `~/.asci/feedback/<sessionId>.jsonl` (follow `getConversationMessagesPath`) |
| 2'' | main | `apps/electron/src/main/ipc.ts` | Register two `ipcMain.handle` channels calling service; external calls use try/catch and propagate failures |
| 3 | preload | `apps/electron/src/preload/index.ts` | Expose `outputFeedback: { set, getForSession }` through `contextBridge` (follow `evidenceSets`; update both implementation + type declaration near lines 752 / 1523) |
| 4 | renderer | `apps/electron/src/renderer/atoms/session-feedback-atoms.ts` **(new)** | Atom holding `SessionFeedbackMap` + fetch/update actions (follow `session-evidence-atoms.ts`) |
| 4' | renderer | `SDKMessageRenderer.tsx` | §6 renderer changes |

---

<a id="6-渲染层改动sdkmessagerenderertsx"></a>

## 6. Renderer Changes (SDKMessageRenderer.tsx)

`import { ThumbsUp, ThumbsDown } from 'lucide-react'` (merge into existing lucide import on line 21). After line 673's `{textContent && <CopyButton content={textContent} />}`, insert:

```tsx
{textContent && lastUuid && (
  <OutputFeedbackButtons
    sessionId={agentSessionId}
    messageUuid={lastUuid}
    userMessageUuid={userMessageUuid}
    messageTimestamp={messageTimestamp}
  />
)}
```

Add internal `OutputFeedbackButtons` component (same file, colocated like `AddToEvidenceSetButton`):
- Read current `messageUuid` state (`up` / `down` / absent) from `session-feedback-atoms`.
- Render two `<MessageAction tooltip={tConv('feedback.thumbsUp.tooltip' | 'feedback.thumbsDown.tooltip')} onClick={...}>`, containing `ThumbsUp` / `ThumbsDown`; highlight selection with semantic tokens.
- `onClick`: calculate `next` through §2.2 → optimistic atom update → `window.electronAPI.outputFeedback.set({...})`; catch rolls back + toast.
- Session restoration calls `outputFeedback.getForSession(sessionId)` once in the parent session-loading layer to populate the atom; components only read.

---

<a id="7-i18n硬约束"></a>

## 7. i18n (Hard Constraint)

Namespace `conversation`, file `locales/{en,zh}/conversation/panels.json`; add `feedback` after `fork`, synchronized en / zh keys under `key-parity`. Original Chinese literals translate to “Good response,” “Bad response,” and “Couldn't save your feedback, please try again.”

```jsonc
// en
"feedback": {
  "thumbsUp": { "tooltip": "Good response" },
  "thumbsDown": { "tooltip": "Bad response" },
  "saveFailed": "Couldn't save your feedback — please try again"
}
// zh
"feedback": {
  "thumbsUp": { "tooltip": "回答不错" },
  "thumbsDown": { "tooltip": "回答不行" },
  "saveFailed": "反馈未能保存，请重试"
}
```

All component copy uses `tConv('feedback.*')` from `useT('conversation')`; no inline hardcoding in either language.

---

<a id="8-存储与服务行为"></a>

## 8. Storage and Service Behavior

- `appendEvent`: `appendFileSync(getOutputFeedbackPath(sessionId), JSON.stringify(event) + '\n')`; create directory lazily.
- `getSessionMap`: missing file → `{}`; parse each line (skip corrupt lines and `console.warn`), fold by overwriting per `messageUuid`, delete entries with `value==='none'`, retaining only `up`/`down`.
- **Main process** generates timestamps with `new Date().toISOString()` (renderer sends no time, avoiding inconsistent clocks).
- try/catch throughout; propagate write failures through IPC as renderer rejection, triggering optimistic rollback + toast.

---

<a id="9-版本号递增"></a>

## 9. Version Increments

| Package | Current | Target |
|----|------|------|
| `@asci/shared` | 0.1.92 | 0.1.93 |
| `apps/electron` | 0.1.410 | 0.1.411 |

(`@asci/core` / `@asci/ui` are unaffected and unchanged.)

---

<a id="10-测试计划"></a>

## 10. Test Plan

- **shared**: compile-time checks for `OutputFeedbackEvent` types + channel constants (`typecheck`).
- **main**: `output-feedback-service.test.ts` (follow `evidence-set-service.test.ts`, redirect to tmp through `setConfigDirForTesting`): append multiple events and fold to last, delete on `none`, skip corrupt lines, missing file returns `{}`.
- **i18n**: `key-parity.test.ts` checks aligned new en/zh keys automatically.
- **Manual golden path** (`bun run dev`): thumbs-up highlights; repeat cancels; thumbs-down switches; reopen restores; switch zh↔en in settings with no raw tooltip keys.

---

## 11. Done When

- [ ] Toolbar order is Copy → Agree → Disagree → Add to evidence set → (Debug) → Branch → Withdraw, consistently in dev / prod.
- [ ] Both new icons are lucide (`ThumbsUp` / `ThumbsDown`), `size-4`, matching existing icons.
- [ ] Mutually exclusive three-state selection + cancellation + semantic highlighting; optimistic updates + rollback + toast.
- [ ] Complete events persist at `~/.asci/feedback/<sessionId>.jsonl`; reopening restores selections.
- [ ] Four IPC layers synchronized (shared → main → preload → renderer).
- [ ] en + zh copy synchronized, no raw keys.
- [ ] `bun run typecheck` / `bun test` (service + `key-parity`) pass.
- [ ] `@asci/shared` 0.1.93, `apps/electron` 0.1.411.

---

<a id="12-开放问题"></a>

## 12. Open Questions

1. Files by `sessionId` or `conversationId`? This spec chooses `sessionId` (directly available in components, same identity key as evidence-set preview); if future analysis needs conversations, add `conversationId` to events compatibly, treating missing old fields as unknown.
2. Can renderer reliably obtain `model` / `scenario` now? Leave empty if unavailable, without blocking core functionality; populate from turn metadata later.
