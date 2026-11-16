<a id="执行步骤组-specexecution-step-grouping-specification"></a>

# Execution Step Grouping Specification

> **Status**: Design locked · Implementation pending
> **Related issue**: #375
> **Related PR**: #376 (CONTEXT.md domain language + this Spec)
> **Domain-language source of truth**: Root `CONTEXT.md` (turn / process block / final answer / execution step group / teammate / TodoBoard)
> **Implementation delivery**: Assigned to itpretty

> **For implementers**: This Spec includes a complete TDD implementation plan (tasks + code), usable task-by-task with `superpowers:executing-plans`. File line numbers reflect the writing-time snapshot; check actual code before implementation (see “Known implementation assumptions” at end).

**Goal:** Collapse consecutive process blocks (thinking + tool calls) into one expandable execution-step-group row, leaving only final answers + one execution summary at the top conversation level to save screen space.

**Architecture:** Before `AssistantTurnRenderer` renders, pure `groupExecutionSteps` preprocesses top-level blocks into render items (passthrough blocks / execution groups); new `ExecutionStepGroup` renders collapsed row + expandable details, reusing existing `ContentBlock` for each step to preserve styling. Group consecutive ≥2 same-speaker process blocks; final answers (text), speaker changes, and TodoBoard cards break groups; single steps render original blocks directly.

**Tech Stack:** TypeScript (strict, imports include `.ts`/`.tsx` extensions), React 18, Bun test, i18next (`conversation` namespace, synchronized en+zh), Tailwind semantic tokens.

**Domain-language source of truth:** Root `CONTEXT.md` (turn / process block / final answer / execution step group / teammate / TodoBoard).

---

<a id="设计决策快照已与产品锁定"></a>

## Design decisions (locked with product)

| # | Decision | Conclusion |
|---|--------|------|
| 1 | Group boundaries | Consecutive ≥2 process blocks group; final text / teammate change / TodoBoard break groups |
| 2 | Collapsed copy | Running=current step (spinner); done=“Executed N steps”; failures=“⚠ Executed N steps · M failed” |
| 3 | Runtime default | Collapsed, expand only on click |
| 4 | Sub-Agents | Separate group per teammate, name badge on collapsed row (⊙ Name · Executed N steps) |
| 5 | TodoBoard | Independent visible card, never collapsed; breaks groups |
| 6 | Errors | Add error badge, no automatic expansion |
| 7 | Single step | No group for 1 step; show original block, preserving specific tool name |
| 8 | Streaming when expanded | Append live; automatically collapse into summary when group finishes |
| 9 | Internal state | Two-level nesting: one row per step, expandable again for details |

---

## File Structure

| File | Responsibility | Action |
|------|------|------|
| `apps/electron/src/renderer/components/agent/tool-result-lookup.ts` | Pure lookup by `tool_use_id` in `allMessages` (extracted from ContentBlock, shared by component/group summary) | Create |
| `apps/electron/src/renderer/components/agent/tool-result-lookup.test.ts` | Tests for the pure function above | Create |
| `apps/electron/src/renderer/components/agent/group-execution-steps.ts` | Pure grouping `groupExecutionSteps` + summary `summarizeExecutionGroup` + types | Create |
| `apps/electron/src/renderer/components/agent/group-execution-steps.test.ts` | Grouping/summary tests (core algorithm) | Create |
| `apps/electron/src/renderer/components/agent/ExecutionStepGroup.tsx` | Collapsed row/expandable details; auto-collapse, error/teammate badges, current-step label | Create |
| `apps/electron/src/renderer/components/agent/ContentBlock.tsx` | `useToolResult` delegates to extracted pure function (no behavior change) | Modify (47-75) |
| `apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx` | `AssistantTurnRenderer` loop uses `groupExecutionSteps` | Modify (510-555) |
| `apps/electron/src/renderer/locales/en/conversation/agent.json` | New execution-group i18n keys (English) | Modify |
| `apps/electron/src/renderer/locales/zh/conversation/agent.json` | New execution-group i18n keys (Chinese, matching en) | Modify |
| `apps/electron/package.json` | Increment patch version | Modify |

---

<a id="task-1-抽出工具结果查找纯函数"></a>

## Task 1: Extract pure tool-result lookup

Extract lookup logic from `useToolResult` in `ContentBlock.tsx` into pure `findToolResultInMessages`, reusable by group summaries and unit-testable. `useToolResult` becomes only a `useMemo` wrapper.

**Files:**
- Create: `apps/electron/src/renderer/components/agent/tool-result-lookup.ts`
- Create: `apps/electron/src/renderer/components/agent/tool-result-lookup.test.ts`
- Modify: `apps/electron/src/renderer/components/agent/ContentBlock.tsx:39-75`

- [ ] **Step 1: Write failing tests**

Create `apps/electron/src/renderer/components/agent/tool-result-lookup.test.ts`:

```ts
import { test, expect, describe } from 'bun:test'
import type { SDKMessage } from '@asci/shared'
import { findToolResultInMessages } from './tool-result-lookup.ts'

function userToolResult(toolUseId: string, content: unknown, isError?: boolean): SDKMessage {
  return {
    type: 'user',
    parent_tool_use_id: null,
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }] },
  } as unknown as SDKMessage
}

describe('findToolResultInMessages', () => {
  test('未找到返回 null', () => {
    expect(findToolResultInMessages('missing', [])).toBeNull()
  })

  test('string content 直接作为 result', () => {
    const msgs = [userToolResult('t1', 'hello')]
    expect(findToolResultInMessages('t1', msgs)).toEqual({ result: 'hello', isError: undefined })
  })

  test('数组 content 拼接 text 片段', () => {
    const msgs = [userToolResult('t1', [
      { type: 'text', text: 'a' },
      { type: 'image' },
      { type: 'text', text: 'b' },
    ])]
    expect(findToolResultInMessages('t1', msgs)).toEqual({ result: 'a\nb', isError: undefined })
  })

  test('is_error 透传', () => {
    const msgs = [userToolResult('t1', 'boom', true)]
    expect(findToolResultInMessages('t1', msgs)).toEqual({ result: 'boom', isError: true })
  })
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `bun test apps/electron/src/renderer/components/agent/tool-result-lookup.test.ts`
Expected: FAIL — `Cannot find module './tool-result-lookup.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/electron/src/renderer/components/agent/tool-result-lookup.ts`:

```ts
/**
 * 工具结果查找 — 从 allMessages 中按 tool_use_id 提取对应的 tool_result。
 *
 * 纯函数，无 React 依赖：既被 ContentBlock 的 useToolResult 包成 hook 使用，
 * 也被 group-execution-steps 的 summarizeExecutionGroup 在 useMemo 内复用。
 */
import type { SDKMessage, SDKUserMessage, SDKToolResultBlock } from '@asci/shared'

export interface ToolResultData {
  result?: string
  isError?: boolean
}

/** 在 allMessages 中查找匹配 toolUseId 的工具结果；未找到返回 null */
export function findToolResultInMessages(
  toolUseId: string,
  allMessages: SDKMessage[],
): ToolResultData | null {
  for (const msg of allMessages) {
    if (msg.type !== 'user') continue
    const userMsg = msg as SDKUserMessage
    const contentBlocks = userMsg.message?.content
    if (!Array.isArray(contentBlocks)) continue

    for (const block of contentBlocks) {
      if (block.type === 'tool_result') {
        const resultBlock = block as SDKToolResultBlock
        if (resultBlock.tool_use_id === toolUseId) {
          let result: string | undefined
          if (typeof resultBlock.content === 'string') {
            result = resultBlock.content
          } else if (Array.isArray(resultBlock.content)) {
            result = (resultBlock.content as Array<{ type: string; text?: string }>)
              .filter((c) => c.type === 'text' && typeof c.text === 'string')
              .map((c) => c.text)
              .join('\n')
          }
          return { result, isError: resultBlock.is_error }
        }
      }
    }
  }
  return null
}
```

- [ ] **Step 4: Run tests and confirm success**

Run: `bun test apps/electron/src/renderer/components/agent/tool-result-lookup.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Reuse pure function in ContentBlock.tsx**

Add to `ContentBlock.tsx` imports (near `isSubagentToolUse`, around line 37):

```ts
import { findToolResultInMessages, type ToolResultData } from './tool-result-lookup.ts'
```

Delete original `ToolResultData` interface and `useToolResult` in `ContentBlock.tsx` lines 39-75; replace with:

```ts
// ===== useToolResult Hook =====

/** 在 allMessages 中查找匹配 toolUseId 的工具结果（纯查找逻辑见 tool-result-lookup.ts） */
function useToolResult(toolUseId: string, allMessages: SDKMessage[]): ToolResultData | null {
  return React.useMemo(
    () => findToolResultInMessages(toolUseId, allMessages),
    [toolUseId, allMessages],
  )
}
```

- [ ] **Step 6: Typecheck + tests**

Run: `bun run typecheck && bun test apps/electron/src/renderer/components/agent/`
Expected: PASS (including no original ContentBlock.test.ts regression)

- [ ] **Step 7: Commit**

```bash
git add apps/electron/src/renderer/components/agent/tool-result-lookup.ts apps/electron/src/renderer/components/agent/tool-result-lookup.test.ts apps/electron/src/renderer/components/agent/ContentBlock.tsx
git commit -m "refactor(conversation): 抽出 findToolResultInMessages 纯函数供分组复用"
```

---

<a id="task-2-分组纯函数-groupexecutionsteps"></a>

## Task 2: Pure grouping function groupExecutionSteps

Implement core grouping algorithm + summary. This is the feature's testable core and must precede components.

**Files:**
- Create: `apps/electron/src/renderer/components/agent/group-execution-steps.ts`
- Create: `apps/electron/src/renderer/components/agent/group-execution-steps.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/electron/src/renderer/components/agent/group-execution-steps.test.ts`:

```ts
import { test, expect, describe } from 'bun:test'
import type { SDKContentBlock, SDKMessage, AgentSpeaker } from '@asci/shared'
import { groupExecutionSteps, summarizeExecutionGroup, type EnrichedBlock } from './group-execution-steps.ts'

const MASTER: AgentSpeaker = 'master'
const FOX: AgentSpeaker = { kind: 'scenario', name: '狐尼克' }
const EAGLE: AgentSpeaker = { kind: 'scenario', name: '鹰尼克' }

function think(): SDKContentBlock { return { type: 'thinking', thinking: 'x' } as SDKContentBlock }
function tool(id: string, name = 'Read'): SDKContentBlock {
  return { type: 'tool_use', id, name, input: {} } as SDKContentBlock
}
function text(s = 'hi'): SDKContentBlock { return { type: 'text', text: s } as SDKContentBlock }
function todo(id: string): SDKContentBlock {
  return { type: 'tool_use', id, name: 'TodoWrite', input: {} } as SDKContentBlock
}
function enrich(blocks: SDKContentBlock[], speaker: AgentSpeaker = MASTER): EnrichedBlock[] {
  return blocks.map((block) => ({ block, speaker }))
}

describe('groupExecutionSteps', () => {
  test('≥2 个连续过程块（master）聚合成一个组', () => {
    const items = enrich([think(), tool('a'), tool('b')])
    const out = groupExecutionSteps(items, -1)
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('group')
    if (out[0]!.kind === 'group') expect(out[0]!.steps).toHaveLength(3)
  })

  test('单个过程块退化为透传 block', () => {
    const items = enrich([tool('a')])
    const out = groupExecutionSteps(items, -1)
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('block')
  })

  test('最终回答(text)切断分组', () => {
    const items = enrich([think(), tool('a'), text(), tool('b'), tool('c')])
    const out = groupExecutionSteps(items, -1)
    // group(2) → block(text) → group(2)
    expect(out.map((x) => x.kind)).toEqual(['group', 'block', 'group'])
  })

  test('说话人切换切断分组：每个队友单独成组', () => {
    const items = [
      ...enrich([think(), tool('m1')], MASTER),
      ...enrich([tool('f1'), tool('f2')], FOX),
      ...enrich([tool('e1'), tool('e2')], EAGLE),
    ]
    const out = groupExecutionSteps(items, -1)
    expect(out.map((x) => x.kind)).toEqual(['group', 'group', 'group'])
    if (out[1]!.kind === 'group') expect(out[1]!.speaker).toEqual(FOX)
    if (out[2]!.kind === 'group') expect(out[2]!.speaker).toEqual(EAGLE)
  })

  test('首个 TodoBoard 块切断分组并作为卡片锚点透传；其余 TodoBoard 块透明不破组', () => {
    // 索引: 0 tool, 1 TodoWrite(first), 2 tool, 3 TodoWrite(non-first), 4 tool
    const items = enrich([tool('a'), todo('t1'), tool('b'), todo('t2'), tool('c')])
    const firstTaskIndex = 1
    const out = groupExecutionSteps(items, firstTaskIndex)
    // block(tool@0 单步) → block(card@1) → group(tool@2, tool@4)，TodoWrite@3 透明
    expect(out.map((x) => x.kind)).toEqual(['block', 'block', 'group'])
    if (out[2]!.kind === 'group') {
      expect(out[2]!.steps.map((s) => s.originalIndex)).toEqual([2, 4])
    }
  })

  test('空输入返回空', () => {
    expect(groupExecutionSteps([], -1)).toEqual([])
  })
})

describe('summarizeExecutionGroup', () => {
  function userToolResult(id: string, isError?: boolean): SDKMessage {
    return {
      type: 'user', parent_tool_use_id: null,
      message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'r', is_error: isError }] },
    } as unknown as SDKMessage
  }

  test('统计总步数与失败步数', () => {
    const steps = [
      { block: tool('a'), originalIndex: 0 },
      { block: tool('b'), originalIndex: 1 },
      { block: think(), originalIndex: 2 },
    ]
    const msgs = [userToolResult('a', false), userToolResult('b', true)]
    expect(summarizeExecutionGroup(steps, msgs)).toEqual({ total: 3, failed: 1 })
  })

  test('思考块不计入失败', () => {
    const steps = [{ block: think(), originalIndex: 0 }]
    expect(summarizeExecutionGroup(steps, [])).toEqual({ total: 1, failed: 0 })
  })
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `bun test apps/electron/src/renderer/components/agent/group-execution-steps.test.ts`
Expected: FAIL — `Cannot find module './group-execution-steps.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/electron/src/renderer/components/agent/group-execution-steps.ts`:

```ts
/**
 * 执行步骤分组（0.2.0）— 纯函数，无 React 依赖，便于单测。
 *
 * 把一个 assistant turn 的顶层内容块序列预处理成「渲染项列表」：
 *   - text / 最终回答          → 透传 block（切断分组）
 *   - 首个 TodoBoard 工具块     → 透传 block（卡片锚点，切断分组）
 *   - 其余 TodoBoard 工具块     → 透明跳过（不渲染、不破组；渲染层本就对其余 task 块渲染 null）
 *   - 单个过程块               → 透传 block（单步退化）
 *   - ≥2 个同说话人连续过程块   → 聚合成 ExecutionStepGroup
 *
 * 过程块 = thinking | 非 TodoBoard 的 tool_use（含 Task/Agent 派发，归入主 Agent 组）。
 * 说话人切换（master ↔ 队友、队友A ↔ 队友B）切断分组。
 */
import type { SDKContentBlock, SDKToolUseBlock, SDKMessage, AgentSpeaker } from '@asci/shared'
import { TASK_TOOL_NAMES } from './TaskProgressCard.tsx'
import { findToolResultInMessages } from './tool-result-lookup.ts'

export interface EnrichedBlock {
  block: SDKContentBlock
  speaker: AgentSpeaker
}

export interface GroupStep {
  block: SDKContentBlock
  /** 在原 topLevelEnriched 序列中的下标，用作 React key / 动画延迟 */
  originalIndex: number
}

export type ExecutionRenderItem =
  | { kind: 'block'; block: SDKContentBlock; speaker: AgentSpeaker; originalIndex: number }
  | { kind: 'group'; speaker: AgentSpeaker; steps: GroupStep[] }

/** 说话人归一化 key：'master' 或 'scenario:<name>'，用于判断是否同一说话人 */
export function speakerKey(speaker: AgentSpeaker): string {
  return speaker === 'master' ? 'master' : `scenario:${speaker.name}`
}

/** 是否 TodoBoard 工具块（TaskCreate/TaskUpdate/TodoWrite） */
function isTodoBoardBlock(block: SDKContentBlock): boolean {
  return block.type === 'tool_use' && TASK_TOOL_NAMES.has((block as SDKToolUseBlock).name)
}

/** 是否过程块（思考 + 非 TodoBoard 工具调用） */
export function isProcessStep(block: SDKContentBlock): boolean {
  if (block.type === 'thinking') return true
  if (block.type === 'tool_use') return !TASK_TOOL_NAMES.has((block as SDKToolUseBlock).name)
  return false
}

export function groupExecutionSteps(
  items: EnrichedBlock[],
  firstTaskIndex: number,
): ExecutionRenderItem[] {
  const out: ExecutionRenderItem[] = []
  let i = 0
  while (i < items.length) {
    const item = items[i]!
    const block = item.block

    // TodoBoard 块：仅首个作为卡片锚点透传（切断分组），其余透明跳过
    if (isTodoBoardBlock(block)) {
      if (i === firstTaskIndex) {
        out.push({ kind: 'block', block, speaker: item.speaker, originalIndex: i })
      }
      i++
      continue
    }

    // 非过程块（text）：透传边界
    if (!isProcessStep(block)) {
      out.push({ kind: 'block', block, speaker: item.speaker, originalIndex: i })
      i++
      continue
    }

    // 过程块：聚合连续同说话人过程块
    const speaker = item.speaker
    const sk = speakerKey(speaker)
    const startIndex = i
    const steps: GroupStep[] = []
    while (i < items.length) {
      const cur = items[i]!
      if (isTodoBoardBlock(cur.block)) {
        if (i === firstTaskIndex) break // 首个 TodoBoard 是边界，结束当前组
        i++ // 其余 TodoBoard 透明跳过，保持组连续
        continue
      }
      if (!isProcessStep(cur.block)) break // text 切断
      if (speakerKey(cur.speaker) !== sk) break // 说话人切换切断
      steps.push({ block: cur.block, originalIndex: i })
      i++
    }

    if (steps.length >= 2) {
      out.push({ kind: 'group', speaker, steps })
    } else if (steps.length === 1) {
      out.push({ kind: 'block', block: steps[0]!.block, speaker, originalIndex: startIndex })
    }
    // steps.length === 0 不会发生：外层已确认当前 item 是过程块
  }
  return out
}

export interface ExecutionGroupSummary {
  /** 组内步骤总数 */
  total: number
  /** 失败步数（tool_result.is_error 为 true 的工具步） */
  failed: number
}

/** 统计执行组的步数与失败步数（用于折叠行文案 + 报错徽标） */
export function summarizeExecutionGroup(
  steps: GroupStep[],
  allMessages: SDKMessage[],
): ExecutionGroupSummary {
  let failed = 0
  for (const step of steps) {
    if (step.block.type === 'tool_use') {
      const r = findToolResultInMessages((step.block as SDKToolUseBlock).id, allMessages)
      if (r?.isError) failed++
    }
  }
  return { total: steps.length, failed }
}
```

- [ ] **Step 4: Run tests and confirm success**

Run: `bun test apps/electron/src/renderer/components/agent/group-execution-steps.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/electron/src/renderer/components/agent/group-execution-steps.ts apps/electron/src/renderer/components/agent/group-execution-steps.test.ts
git commit -m "feat(conversation): 新增 groupExecutionSteps 分组纯函数 + 单测"
```

---

<a id="task-3-执行组-i18n-keyen-&#45;zh-同步"></a>

## Task 3: Execution-group i18n keys (en + zh together)

Add collapsed-summary copy. Current-step labels reuse existing `conversation.tool.*` (getToolPhrase) and `agent.messages.thinkingStreaming`; only “Executed N steps” and “N steps failed” are new.

**Files:**
- Modify: `apps/electron/src/renderer/locales/en/conversation/agent.json`
- Modify: `apps/electron/src/renderer/locales/zh/conversation/agent.json`

- [ ] **Step 1: Locate messages section**

Both files use `"messages": { ... }` (en around line 113), already containing `thinkingStreaming` / `thinking` / `thinkingWithDuration` keys.

- [ ] **Step 2: Add en keys**

Inside `"messages"` in `apps/electron/src/renderer/locales/en/conversation/agent.json`, alongside `thinkingStreaming`, add (with commas):

```json
      "executedSteps": "Executed {{count}} steps",
      "executedStepsWithFailures": "Executed {{count}} steps · {{failed}} failed"
```

- [ ] **Step 3: Add matching zh keys**

Inside `"messages"` in `apps/electron/src/renderer/locales/zh/conversation/agent.json`, add alongside existing keys:

```json
      "executedSteps": "已执行 {{count}} 步",
      "executedStepsWithFailures": "已执行 {{count}} 步 · {{failed}} 步失败"
```

- [ ] **Step 4: Run key-parity validation**

Run: `bun test apps/electron/src/renderer/locales/__tests__/key-parity.test.ts`
Expected: PASS (matching en/zh keys)

> If the path does not exist, locate with `rg -l "key-parity" apps/electron --glob "*.test.*"`, then run that file.

- [ ] **Step 5: Commit**

```bash
git add apps/electron/src/renderer/locales/en/conversation/agent.json apps/electron/src/renderer/locales/zh/conversation/agent.json
git commit -m "feat(i18n): 执行步骤组折叠行汇总文案（en+zh）"
```

---

<a id="task-4-executionstepgroup-组件"></a>

## Task 4: ExecutionStepGroup component

Collapsed row (default) + expandable details. Running shows current step/spinner, done “Executed N steps,” failures an error badge; teammate groups include name badges; live→done auto-collapses. Expanded rows reuse `ContentBlock`, preserving current styling.

**Files:**
- Create: `apps/electron/src/renderer/components/agent/ExecutionStepGroup.tsx`

- [ ] **Step 1: Write component**

Create `apps/electron/src/renderer/components/agent/ExecutionStepGroup.tsx`:

```tsx
/**
 * ExecutionStepGroup — 执行步骤组（0.2.0）
 *
 * 把一段连续过程块折叠成对话流一级的一行：
 *  - 折叠态：运行中显示当前步（转圈）；完成显示「已执行 N 步」；有失败显示报错徽标。
 *  - 队友组：折叠行带队友名徽标（⊙ 名字·已执行 N 步）。
 *  - 默认折叠；点击展开后逐条复用 ContentBlock（两级嵌套，单步仍可再点开）。
 *  - 该组从实时(isLive)→完成时自动收起（尊重「完成后自动收」的产品决策）。
 */
import * as React from 'react'
import { ChevronRight, Loader2, AlertTriangle, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import { usePreserveScrollOnExpand } from '@/hooks/usePreserveScrollOnExpand'
import { ContentBlock } from './ContentBlock.tsx'
import { getToolPhrase } from './tool-phrase.ts'
import { summarizeExecutionGroup, type GroupStep } from './group-execution-steps.ts'
import { speakerDisplayName } from './resolve-message-speaker.ts'
import type { SDKContentBlock, SDKMessage, SDKToolUseBlock, AgentSpeaker } from '@asci/shared'
import type { TFunction } from 'i18next'

interface ExecutionStepGroupProps {
  steps: GroupStep[]
  speaker: AgentSpeaker
  allMessages: SDKMessage[]
  basePath?: string
  /** 该组是否处于实时流（isStreaming 且为当前 turn 最后一个渲染项） */
  isLive: boolean
  dimmed?: boolean
}

/** 折叠行运行态的「当前步」短语：工具走 loadingLabel，思考走 thinkingStreaming */
function currentStepLabel(block: SDKContentBlock, t: TFunction<'conversation'>): string {
  if (block.type === 'tool_use') {
    const tu = block as SDKToolUseBlock
    return getToolPhrase(tu.name, tu.input, t).loadingLabel
  }
  return t('agent.messages.thinkingStreaming')
}

export function ExecutionStepGroup({
  steps, speaker, allMessages, basePath, isLive, dimmed = false,
}: ExecutionStepGroupProps): React.ReactElement {
  const { t } = useT('conversation')
  const [expanded, setExpanded] = React.useState(false)
  const expandedScroll = usePreserveScrollOnExpand(expanded)

  // 实时→完成时自动收起；历史组（从未 live）不受影响，纯手动 toggle
  const prevLiveRef = React.useRef(isLive)
  React.useEffect(() => {
    if (prevLiveRef.current && !isLive) setExpanded(false)
    prevLiveRef.current = isLive
  }, [isLive])

  const { total, failed } = React.useMemo(
    () => summarizeExecutionGroup(steps, allMessages),
    [steps, allMessages],
  )

  const scenarioName = speakerDisplayName(speaker)
  const lastStep = steps[steps.length - 1]!

  // 折叠行文案
  let labelText: string
  if (isLive) {
    labelText = currentStepLabel(lastStep.block, t)
  } else if (failed > 0) {
    labelText = t('agent.messages.executedStepsWithFailures', { count: total, failed })
  } else {
    labelText = t('agent.messages.executedSteps', { count: total })
  }

  // 折叠行图标：运行中转圈 / 有失败警告 / 否则层叠图标
  const StatusIcon = isLive ? Loader2 : failed > 0 ? AlertTriangle : Layers

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-2 py-0.5 text-left hover:opacity-70 transition-opacity group w-full"
        onClick={() => { expandedScroll.snapshot(); setExpanded(!expanded) }}
      >
        <ChevronRight
          className={cn(
            'size-3 text-muted-foreground/50 transition-transform duration-150 shrink-0',
            expanded && 'rotate-90',
          )}
        />
        <StatusIcon
          className={cn(
            'size-3.5 shrink-0',
            isLive && 'animate-spin text-primary/50',
            !isLive && failed > 0 && 'text-destructive/70',
            !isLive && failed === 0 && (dimmed ? 'text-muted-foreground/70' : 'text-muted-foreground'),
          )}
        />
        {scenarioName && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[11px] font-medium bg-primary/8 text-primary/60 select-none shrink-0">
            ⊙ {scenarioName}
          </span>
        )}
        <span className={cn(
          'truncate text-[14px]',
          isLive && 'animate-pulse',
          failed > 0 && !isLive ? 'text-destructive/80' : dimmed ? 'text-muted-foreground/70' : 'text-muted-foreground',
        )}>
          {labelText}
        </span>
      </button>

      {expanded && (
        <div className="pl-5 mt-1 space-y-2 border-l-2 border-border/30 ml-[5px] animate-in fade-in slide-in-from-top-1 duration-150">
          {steps.map((step, idx) => (
            <ContentBlock
              key={step.originalIndex}
              block={step.block}
              allMessages={allMessages}
              basePath={basePath}
              animate={false}
              index={idx}
              dimmed={dimmed}
              isStreaming={isLive && idx === steps.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS (confirm named `ContentBlock` export and correct `getToolPhrase`/`summarizeExecutionGroup`/`speakerDisplayName` paths)

- [ ] **Step 3: Commit**

```bash
git add apps/electron/src/renderer/components/agent/ExecutionStepGroup.tsx
git commit -m "feat(conversation): 新增 ExecutionStepGroup 折叠组组件"
```

---

<a id="task-5-接入-assistantturnrenderer-渲染循环"></a>

## Task 5: Integrate AssistantTurnRenderer loop

Change `SDKMessageRenderer.tsx` from mapping blocks directly to grouping with groupExecutionSteps then mapping render items. Preserve TodoBoard (firstTaskIndex), scenario badges, and pre-text gaps.

**Files:**
- Modify: `apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx` (imports + lines 510-555 rendering)

- [ ] **Step 1: Add imports**

Add in `SDKMessageRenderer.tsx` imports (near `import { TaskProgressCard, TASK_TOOL_NAMES } from './TaskProgressCard'`):

```ts
import { groupExecutionSteps } from './group-execution-steps.ts'
import { ExecutionStepGroup } from './ExecutionStepGroup.tsx'
```

- [ ] **Step 2: Compute render items before return**

Before `AssistantTurnRenderer`'s `return (` (after `taskActivities` `useMemo`, around line 509 `return (`), insert:

```tsx
  // 0.2.0：把顶层块序列预处理成「渲染项」——连续≥2 过程块折叠成执行步骤组
  const renderItems = React.useMemo(
    () => groupExecutionSteps(topLevelEnriched, firstTaskIndex),
    [topLevelEnriched, firstTaskIndex],
  )
```

> Note: `topLevelEnriched` elements are `{ block, speaker }`, matching `groupExecutionSteps` `EnrichedBlock`; pass directly.

- [ ] **Step 3: Replace render loop**

Replace the entire `<div className={cn('space-y-2')}>{topLevelEnriched.map(...)}</div>` block in `SDKMessageRenderer.tsx` lines 513-555 with:

```tsx
        <div className={cn('space-y-2')}>
          {renderItems.map((item, ri) => {
            const isLastItem = ri === renderItems.length - 1

            // 执行步骤组
            if (item.kind === 'group') {
              const isLive = !!isStreaming && isLastItem
              return (
                <ExecutionStepGroup
                  key={`grp-${item.steps[0]!.originalIndex}`}
                  steps={item.steps}
                  speaker={item.speaker}
                  allMessages={allMessages}
                  basePath={basePath}
                  isLive={isLive}
                  dimmed={hasTextContent}
                />
              )
            }

            // 透传 block
            const block = item.block

            // TodoBoard 卡片（groupExecutionSteps 只把首个 task 块作为锚点透传到这里）
            if (block.type === 'tool_use' && TASK_TOOL_NAMES.has((block as SDKToolUseBlock).name)) {
              return (
                <TaskProgressCard
                  key="task-progress-card"
                  activities={taskActivities}
                  streamEnded={!isStreaming}
                  historicalTaskSubjects={historicalTaskSubjects}
                />
              )
            }

            // A4 §② per-event speaker：scenario → 徽标；master → 无徽标
            const scenarioName = speakerDisplayName(item.speaker)

            // 文本块跟在过程块/组之后时额外加上边距，拉开「处理过程」与「最终结果」
            const prevItem = renderItems[ri - 1]
            const prevIsText = prevItem?.kind === 'block' && prevItem.block.type === 'text'
            const needsResultGap = block.type === 'text' && prevItem != null && !prevIsText

            return (
              <div key={item.originalIndex} className={cn('space-y-1', needsResultGap ? '!mt-5' : undefined)}>
                {scenarioName && (
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[11px] font-medium bg-primary/8 text-primary/60 select-none">
                      ⊙ {scenarioName}
                    </span>
                  </div>
                )}
                <ContentBlock
                  block={block}
                  allMessages={allMessages}
                  basePath={basePath}
                  animate={!!isStreaming}
                  index={item.originalIndex}
                  dimmed={hasTextContent && block.type !== 'text'}
                  isStreaming={isStreaming}
                />
              </div>
            )
          })}
        </div>
```

> The original `firstTaskIndex`-based `i === firstTaskIndex ? card : null` branch is unnecessary; `groupExecutionSteps` already passes only the first task block and skips others.

- [ ] **Step 4: Typecheck + full tests**

Run: `bun run typecheck && bun test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx
git commit -m "feat(conversation): AssistantTurnRenderer 接入执行步骤组渲染"
```

---

<a id="task-6-版本号递增-&#45;全链路验证"></a>

## Task 6: Version increment + end-to-end validation

**Files:**
- Modify: `apps/electron/package.json`（`version`）

- [ ] **Step 1: Patch version +1**

Change `"version": "0.1.339-rc.1"` in `apps/electron/package.json` to `"version": "0.1.340-rc.1"`.
(If no longer 0.1.339 at implementation time, increment current patch by 1.)

- [ ] **Step 2: Automated checks**

Run: `bun run typecheck && bun test`
Expected: All PASS (including key-parity)

- [ ] **Step 3: simplify retrospective**

Run `@code-simplifier` / `simplify` over changes in `group-execution-steps.ts`, `ExecutionStepGroup.tsx`, `SDKMessageRenderer.tsx` to review component structure/readability.

- [ ] **Step 4: Manual dev walkthrough (mandatory for UI; explicitly tell user if unavailable)**

Run: `bun run dev`; walk these golden paths/boundaries in browser:

1. **Multiple-step group**: Request multiple tool calls → running row shows current step + spinner; completion automatically collapses to “Executed N steps.”
2. **Expand/collapse**: Click group row → one row per step; click step → detailed expansion (two nested levels).
3. **Single-step fallback**: One-tool request → no “Executed 1 step”; show original tool row (e.g. “Read xxx”).
4. **Text breaks groups**: Agent replies partway then continues → group → text → new group.
5. **Teammate grouping**: Dispatch sub-Agents (Fox Nick/Eagle Nick) → separate groups, each with ⊙ Name badge.
6. **TodoBoard**: Trigger TodoWrite → progress card stays independently visible, never collapsed (group → card → group).
7. **Error badge**: Cause tool failure (e.g. nonexistent file) → red “⚠ Executed N steps · 1 failed,” no auto-expansion.
8. **i18n**: Run once in zh and en; summary copy has no raw keys/missing translations.
9. **History replay**: Reopen historical session → groups default collapsed by rules, expand normally.

- [ ] **Step 5: Commit**

```bash
git add apps/electron/package.json
git commit -m "chore(electron): patch 版本号递增（执行步骤组）"
```

---

<a id="self-review写完计划后自检"></a>

## Self-Review (after writing plan)

**Spec coverage (design decision → task mapping):**

| Decision | Location |
|------|------|
| ① Group boundaries (text/teammate/TodoBoard break, ≥2 group) | Task 2 `groupExecutionSteps` + tests |
| ② Collapsed copy (running=current / done=N steps / failure badge) | Task 3 i18n + Task 4 `labelText`/`StatusIcon` |
| ③ Collapsed by default while running | Task 4 `useState(false)` |
| ④ One group per teammate | Task 2 `speakerKey` boundary + Task 4 teammate badge |
| ⑤ TodoBoard independently visible | Task 2 first-task passthrough + Task 5 TaskProgressCard branch |
| ⑥ Error badge without auto-expansion | Task 2 `summarizeExecutionGroup` + Task 4 error copy/icon |
| ⑦ Single-step fallback | Task 2 `steps.length === 1 → block` + tests |
| ⑧ Auto-collapse on completion | Task 4 `prevLiveRef` effect |
| ⑨ Consistent two-level nesting | Task 4 expanded area reuses `ContentBlock` |

**Placeholder scan:** No TBD / “handle edge cases” placeholders; complete code for every code step.

**Type consistency:** `EnrichedBlock`/`GroupStep`/`ExecutionRenderItem` defined in Task 2, consistently referenced in Tasks 4/5; `ToolResultData`/`findToolResultInMessages` defined in Task 1 and consistently used by Task 2 `summarizeExecutionGroup` and ContentBlock; `isLive`/`speaker`/`steps` props defined in Task 4, consistently passed by Task 5.

**Known implementation assumptions (recheck during execution):**
- `topLevelEnriched` matches `EnrichedBlock` (`{ block, speaker }`); SDKMessageRenderer.tsx:405-408 confirms.
- If key-parity path differs from Task 3 Step 4, run actual path from `rg -l "key-parity"`.
- `usePreserveScrollOnExpand` returns an object with `snapshot()` (consistent with ContentBlock usage).
