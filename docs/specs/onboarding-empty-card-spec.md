<a id="note-&#45;证据集-首次使用-onboarding-空状态教学卡-spec"></a>

# First-use onboarding empty-state teaching cards for notes / evidence sets Spec

> **Status**: Draft · Review pending
> **Related issue**: [#438](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/438) — `[ops-feedback] note / 证据集首次使用 onboarding 引导（降低新人门槛）` (First-use onboarding for notes / evidence sets, lowering the barrier for newcomers)
> **Related PR**: TBD
> **Domain-language source of truth**: [CONTEXT.md](../../CONTEXT.md) (note / evidence set / library terminology)
> **Dependency inputs**: Existing `SpotlightOverlay V2` state machine (mechanism comparison only, no state-field reuse); existing `EvidenceSetCard` visual language (shared card styling)

---

<a id="1-背景与目标"></a>

## 1. Background and goals

<a id="11-问题"></a>

### 1.1 Problem

Notes and Evidence Sets are core ASCI research objects, but the product has no first-use guidance/demo. Newcomers do not know what they are, how to use them, or their relationship to the library/conversations, raising the learning barrier (source: 0601 test feedback item 17, Xuwu).

Existing `SpotlightOverlay V2` is a genuine first-install, one-time walkthrough covering LLM/Zotero/task actions, **not conceptual guidance for notes / evidence sets**. Spotlight's directed-action semantics also differ from explaining these concepts.

<a id="12-目标"></a>

### 1.2 Goals

Add **in-view empty-state teaching cards** to **NotesView** (“All evidence sets” list) and **PaperNotesPanel** (paper notes section):

- **Trigger**: Empty data list + not dismissed → display naturally
- **Content**: Each card contains 1 primary SVG diagram + 4 text steps (what it is / how to create / where to view / typical use)
- **Close**: Top-right `×` actively dismisses → persists → never reappears even while empty
- **Replay**: View-top `HelpCircle` icon → clear dismiss flag → card reappears

<a id="13-非目标yagni"></a>

### 1.3 Non-goals (YAGNI)

- ❌ Do not show in `EvidenceSetDetailSheet` (created empty set); existing evidence-set users need no conceptual guidance
- ❌ Do not show in `PaperContainingEvidenceSetsPanel` (inclusion hint); reverse hint is self-explanatory
- ❌ Do not join the `SpotlightOverlay` state machine; one-time walkthrough and independent per-view dismissal have different semantics, mixing pollutes spotlight
- ❌ No automatic reappearance after days; dismissal is permanent (but `dismissedAt: number` leaves room for this future feature)
- ❌ No demo GIF / screenshot; pure SVG diagram, zero image-asset maintenance

---

<a id="2-架构与组件边界"></a>

## 2. Architecture and component boundaries

<a id="21-新增文件清单"></a>

### 2.1 New file inventory

```
apps/electron/src/renderer/components/onboarding/
  OnboardingEmptyCard.tsx                    # General teaching card (props-driven)
  illustrations/
    EvidenceSetIntro.tsx                     # Primary SVG #1 (what an evidence set is)
    PaperNotesIntro.tsx                      # Primary SVG #2 (PDF selection→note)

apps/electron/src/renderer/atoms/
  onboarding-empty-card-atoms.ts             # State atom + hydration

apps/electron/src/renderer/hooks/
  useOnboardingEmptyCard.ts                  # Convenience hook for host views

apps/electron/src/main/lib/
  onboarding-empty-card-service.ts           # settings.json read/write + subscribe
  onboarding-empty-card-service.test.ts      # Main-process unit tests

packages/shared/src/types/
  onboarding-empty-card.ts                   # OnboardingEmptyCardKey + State types
  # Add 4 channel constants in ipc-channels.ts

apps/electron/src/renderer/locales/<lang>/onboarding.json
  # Add root emptyCard subtree (no new ns)
```

<a id="22-通用组件契约"></a>

### 2.2 General component contract

```ts
// OnboardingEmptyCard.tsx
import type { LucideIcon } from 'lucide-react'

export type OnboardingEmptyCardKey = 'notesView' | 'paperNotes'

export interface OnboardingEmptyCardProps {
  /** 持久化 dismiss 的 key（哪张卡被关） */
  cardKey: OnboardingEmptyCardKey
  /** SVG 主示意（120×120，跟随 currentColor） */
  illustration: React.ReactElement
  /** i18n key：标题 */
  titleKey: string
  /** i18n key：一句话定义 */
  introKey: string
  /** 4 段步骤（"是什么/怎么建/在哪看/典型用法"），每段含 lucide 图标 */
  steps: ReadonlyArray<{ icon: LucideIcon; labelKey: string }>
}
```

- **Visual contract**: `border + shadow-sm + bg-card`, sharing `EvidenceSetCard` visuals; top-right `×`; top-to-bottom layout `主示意 → 标题 → intro → 4 段步骤` (diagram → title → intro → 4 steps).
- **Dependencies**: Only `useT('onboarding')` + `useOnboardingEmptyCard(cardKey)` (dismiss through internal hook IPC).
- **No business dependencies**: Component neither queries data nor checks emptiness; host combines its data state + `dismissed` to decide visibility.

<a id="23-关键边界与取舍"></a>

### 2.3 Key boundaries and tradeoffs

| Decision | Tradeoff |
|---|---|
| **Independent service instead of merging into spotlight** | Spotlight is a one-time walkthrough; empty-card is independent per-view dismissal; mixing their state semantics pollutes the state machine |
| **Use `dismissedAt: number`, not `boolean`** | Supports future automatic reappearance after days + debugging timestamp audits |
| **i18n under root emptyCard subtree of `onboarding.json`** | `onboarding` is currently a single-file ns; a new sub-ns requires `locales/index.ts` merge changes, not worth the cost; existing key-parity guards root subtree |
| **No component-render tests** | Visual component, same strategy as `EvidenceSetCard` / `SpotlightTooltip`: manual `bun run dev` acceptance |
| **`replay` = clear dismissedAt** | Simpler than adding shouldReplay; consistent with natural display rule (`空 && !dismissed`, meaning empty && !dismissed) |

---

<a id="3-数据流与持久化"></a>

## 3. Data flow and persistence

<a id="31-settingsjson-字段扩展"></a>

### 3.1 settings.json field extension

`packages/shared/src/types/settings.ts`：

```ts
interface AppSettings {
  // ...已有字段
  onboardingSpotlight?: OnboardingSpotlightState  // 已有
  onboardingEmptyCard?: {
    notesView?:  { dismissedAt: number }
    paperNotes?: { dismissedAt: number }
  }
}
```

**Existing-user compatibility**: Missing field → empty state object `{}` → no dismissed keys → show cards normally for empty lists. No migration logic needed.

<a id="32-ipc-四联通道"></a>

### 3.2 Four-part IPC channels

| Channel (shared constant) | Direction | Parameters | Return |
|---|---|---|---|
| `IPC_ONBOARDING_EMPTY_CARD_GET_STATE` | invoke | — | `OnboardingEmptyCardState` |
| `IPC_ONBOARDING_EMPTY_CARD_DISMISS` | invoke | `{ key: OnboardingEmptyCardKey }` | Updated `OnboardingEmptyCardState` |
| `IPC_ONBOARDING_EMPTY_CARD_REPLAY` | invoke | `{ key: OnboardingEmptyCardKey }` | Updated `OnboardingEmptyCardState` |
| `IPC_ONBOARDING_EMPTY_CARD_ON_CHANGED` | event | broadcast | `OnboardingEmptyCardState` |

Four-part synchronization checklist (CLAUDE.md §5):
- [ ] `packages/shared/src/ipc-channels.ts` — Channel constants + request/response types
- [ ] `apps/electron/src/main/ipc.ts` — `ipcMain.handle` registration, calling `onboardingEmptyCardService`
- [ ] `apps/electron/src/preload/index.ts` — `window.electronAPI.onboardingEmptyCard.*` bridge
- [ ] renderer — `useOnboardingEmptyCard` hook calls

<a id="33-renderer-状态流"></a>

### 3.3 Renderer state flow

```ts
// atoms/onboarding-empty-card-atoms.ts
export const onboardingEmptyCardAtom = atom<OnboardingEmptyCardState>({})

// hooks/useOnboardingEmptyCard.ts
export function useOnboardingEmptyCard(key: OnboardingEmptyCardKey) {
  const state = useAtomValue(onboardingEmptyCardAtom)
  const dismissed = state[key]?.dismissedAt != null
  return {
    dismissed,
    dismiss: () => window.electronAPI.onboardingEmptyCard.dismiss({ key }),
    replay:  () => window.electronAPI.onboardingEmptyCard.replay({ key }),
  }
}
```

**Hydrate + subscribe** (App.tsx initialization, following existing `onboardingSpotlight` hydration):
1. App mount → `get-state()` → write `onboardingEmptyCardAtom`
2. Subscribe to `on-changed` → overwrite atom on broadcast (multi-window consistency)

<a id="34-显示判定host-侧组合"></a>

### 3.4 Visibility decision (host composition)

**NotesView**（`apps/electron/src/renderer/components/library/NotesView.tsx`）：
```ts
const { dismissed, replay } = useOnboardingEmptyCard('notesView')
const showOnboardingCard = filtered.length === 0 && !query && !dismissed
// search query 有值时不显示 — "搜了没结果"和"还没建过"是两种语义
```

**PaperNotesPanel**（`apps/electron/src/renderer/components/library/PaperNotesPanel.tsx`）：
```ts
const { dismissed, replay } = useOnboardingEmptyCard('paperNotes')
const showOnboardingCard = notes.length === 0 && !dismissed
```

<a id="35-重看演示-入口"></a>

### 3.5 Replay-demo entry

- **NotesView**: Persistent `<HelpCircle />` icon button in top bar (right of “All evidence sets”) + tooltip `t('emptyCard.replayTooltip')`; click → `replay()`
- **PaperNotesPanel**: Same-position `<HelpCircle />` in notes header; click → `replay()`

Always show the icon button regardless of card visibility, allowing replay at any time.

---

<a id="4-svg-主示意120120"></a>

## 4. Primary SVG diagrams (120×120)

<a id="41-evidencesetintronotesview-卡"></a>

### 4.1 EvidenceSetIntro (NotesView card)

**Meaning**: N papers → extract fragments → gather into one set.

**Sketch**:
```
  ┌─────────┐ ┌─────────┐ ┌─────────┐
  │ paper A │ │ paper B │ │ paper C │     ← Three paper cards (rectangles + lines)
  └────┬────┘ └────┬────┘ └────┬────┘
       └───────────┼───────────┘
              ┌────▼────┐
              │Evidence │                  ← Gathering container (stack shadow)
              │  ▤  ▤   │                  ← Two internal evidence bars
              └─────────┘
```

<a id="42-papernotesintropapernotespanel-卡"></a>

### 4.2 PaperNotesIntro (PaperNotesPanel card)

**Meaning**: Select text in PDF → bubble appears → save as a note.

**Sketch**:
```
  ┌──────────────────────┐
  │ Lorem ipsum [▒▒▒▒] ─ │       ← PDF page with highlighted passage
  │ dolor sit amet...    │
  └────────┬─────────────┘
           │
           ▼
       ╭─────────╮                 ← Note bubble (rounded rectangle + badge)
       │  ✏ note │
       ╰─────────╯
```

<a id="43-实施约束"></a>

### 4.3 Implementation constraints

- `<svg viewBox="0 0 120 120">` + `stroke="currentColor"` + `fill="none"` / `fill="currentColor" fill-opacity="0.1"`, **following theme colors and adapting automatically to light/dark themes**
- Container stroke uses `text-muted-foreground/50`; emphasis uses `text-foreground/80`
- **Zero hardcoded Tailwind palette colors** (CLAUDE.md UI rules + `asci/no-tailwind-palette` guard)
- Default `aria-hidden`; decorative graphics excluded from accessibility tree

---

<a id="5-i18n-文案"></a>

## 5. i18n copy

**Path**: Add root `emptyCard` subtree to `apps/electron/src/renderer/locales/<lang>/onboarding.json` (synchronized en + zh).

### 5.1 zh

```json
{
  "emptyCard": {
    "replayTooltip": "重看演示",
    "dismissAriaLabel": "关闭演示",
    "notesView": {
      "title": "证据集 = 跨论文的证据合集",
      "intro": "把多篇论文里支持同一论点的片段集中起来，方便回头查、引、写综述。",
      "steps": {
        "what":   "包含若干论文片段（证据），每条都带原文出处",
        "create": "在 PDF 上划词 → 「加入证据集」；或在 @ 提及里建集",
        "where":  "左栏「全部证据集」按时间倒序看；点开看段落↔论文配对",
        "use":    "写综述 / 写报告时直接引用整集，自动带溯源"
      }
    },
    "paperNotes": {
      "title": "Note = 论文上的轻量批注",
      "intro": "在 PDF 上划词随手记，note 同时收录到证据集里。",
      "steps": {
        "what":   "锚定到 PDF 具体段落的短笔记",
        "create": "选中 PDF 上的文字 → 点弹出气泡里的「记下」",
        "where":  "本论文详情的 Notes 区，或左栏「全部证据集」",
        "use":    "为 @ 引用、综述写作准备可溯源的素材"
      }
    }
  }
}
```

### 5.2 en

```json
{
  "emptyCard": {
    "replayTooltip": "Replay intro",
    "dismissAriaLabel": "Dismiss intro",
    "notesView": {
      "title": "Evidence sets = cross-paper evidence collections",
      "intro": "Group snippets from multiple papers that support the same point — easy to recall, cite, and reuse when writing reviews.",
      "steps": {
        "what":   "Holds several paper snippets (evidence), each with source",
        "create": "Highlight in a PDF → \"Add to evidence set\"; or build one via @ mention",
        "where":  "Left rail \"All evidence sets\" sorted by time; click in to see paragraph↔paper pairs",
        "use":    "Cite the whole set when writing reviews/reports — sources auto-attached"
      }
    },
    "paperNotes": {
      "title": "Note = a lightweight annotation on a paper",
      "intro": "Highlight text in a PDF to jot a quick note — also indexed into evidence sets.",
      "steps": {
        "what":   "Short notes anchored to a specific paragraph in the PDF",
        "create": "Select text in the PDF → click \"Save\" in the popup",
        "where":  "In the Notes panel of this paper, or in left rail \"All evidence sets\"",
        "use":    "Prepare traceable raw material for @ citations and review writing"
      }
    }
  }
}
```

Existing **key-parity** tests cover it.

---

<a id="6-测试与验收"></a>

## 6. Tests and acceptance

<a id="61-测试矩阵"></a>

### 6.1 Test matrix

| Layer | File | Coverage |
|---|---|---|
| Main-process unit | `apps/electron/src/main/lib/onboarding-empty-card-service.test.ts` | `getState` / `dismiss` / `replay` states, `subscribe` notifications, missing settings-field compatibility, repeated-dismiss idempotence, immediate dismiss after replay |
| Shared types | (none) | TypeScript compilation guards |
| Renderer components | (none) | Visual components, manual `bun run dev` acceptance |
| i18n | Existing `key-parity.test.ts` | Automatically checks new en/zh keys |

<a id="62-done-when汇总"></a>

### 6.2 Done When (summary)

1. [ ] General `OnboardingEmptyCard` component + two primary SVG diagrams complete
2. [ ] Main service + four-part IPC channels complete (CLAUDE.md §5)
3. [ ] settings.json type adds `onboardingEmptyCard`, compatible with missing fields for existing users
4. [ ] NotesView integration: empty list + no query + not dismissed → show; top-bar HelpCircle replays
5. [ ] PaperNotesPanel integration: empty notes + not dismissed → show; header HelpCircle replays
6. [ ] i18n keys in `onboarding.json` root `emptyCard.*`, en + zh synchronized
7. [ ] `bun run typecheck` passes
8. [ ] `bun test` passes (including key-parity + new service tests)
9. [ ] pre-commit hook bumps version automatically (pinned to `origin/main` patch+1), no manual increment
10. [ ] Actual `bun run dev` acceptance:
   - [ ] Fresh installation (clear `~/.asci-dev/`) → NotesView card appears / `×` dismisses permanently / `i` replays
   - [ ] Same checks for PaperNotesPanel
   - [ ] Switch zh↔en in settings and run each, no raw keys
11. [ ] All issue #438 acceptance criteria checked; PR linked to close it

---

<a id="7-实施顺序建议"></a>

## 7. Suggested implementation order

When writing the implementation plan, divide into phases (run typecheck after each):

1. **Types + main service** (including unit tests): Pure logic, independently verifiable
2. **Four-part IPC**: Shared constants → main registration → preload bridge → renderer atom + hook + hydrate
3. **General `OnboardingEmptyCard` component**: Props-only rendering, independently viewable
4. **Two primary SVG diagrams**: Static, independently viewable
5. **i18n keys in `onboarding.json`**, bilingual
6. **NotesView integration** + **PaperNotesPanel integration**: Combine all parts
7. **Actual dev golden path** + bilingual switching acceptance

---

<a id="8-风险与边界条件"></a>

## 8. Risks and boundary conditions

| Risk | Response |
|---|---|
| Empty cards conflict visually with spotlight guidance | May add `&& !spotlightActive`; spotlight does not target NotesView/Library notes, so overlap unlikely; **omit initially, add only if dev testing shows a problem** |
| Dismiss not synchronized across windows | IPC `on-changed` broadcast plus hydration/subscription |
| Immediate dismiss after replay confuses state | Idempotent service: `replay` = `delete state[key]`; `dismiss` = `state[key] = { dismissedAt: nowMs() }`. They overwrite one another |
| Upgraded existing `~/.asci/` users unexpectedly see card on first NotesView entry | Expected: Only first empty NotesView shows it (not lists with content); educational, dismissible, noninterrupting |
| key-parity misses keys | Run `bun test` before i18n PRs; key-parity mandatory |

---

<a id="9-后续可能的迭代非本期"></a>

## 9. Possible later iterations (outside this release)

- **Empty-state hints inside EvidenceSetDetailSheet** (how to add paired cards to created empty sets): Outside issue #438, defer
- **PaperContainingEvidenceSetsPanel reverse hint**: Self-explanatory, omit
- **Automatic reappearance days after dismissal**: `dismissedAt: number` already reserves this field
- **Onboarding reach/conversion statistics**: Reassess instrumentation after public 0.3.0 release

---

<a id="附与现有机制的关系"></a>

## Appendix: Relationship to existing mechanisms

| Mechanism | Trigger | Scope | Persistence | Relationship |
|---|---|---|---|---|
| `SpotlightOverlay V2` | Genuine first install automatic + avatar-menu “Replay guidance” | Global overlay across views | `settings.onboardingSpotlight` | **Independent**, no shared state fields/machine |
| `WelcomeEmptyState` | Main conversations view has no conversations | Main-view welcome card | None | Visual reference (mascot + greeting), no component reuse |
| `OnboardingEmptyCard` (this spec) | Empty NotesView/PaperNotesPanel data + not dismissed | In-view empty state | `settings.onboardingEmptyCard.<key>` | **New** |
