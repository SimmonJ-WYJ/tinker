# 执行步骤组 Spec（Execution Step Grouping Specification）

> **状态**：设计已锁定 · 待实现
> **关联 issue**：#375
> **关联 PR**：#376（CONTEXT.md 领域语言 + 本 Spec）
> **领域语言事实源**：仓库根 `CONTEXT.md`（回合 / 过程块 / 最终回答 / 执行步骤组 / 队友 / TodoBoard）
> **实现交付**：分配给 itpretty

> **给实现者**：本 Spec 含完整 TDD 实现计划（任务分解 + 代码），可配合 `superpowers:executing-plans` 逐任务执行。任务步骤里的文件行号为撰写时快照，实现前请以实际代码为准（详见文末「已知实现层假设」）。

**Goal:** 把对话流里连续的过程块（思考 + 工具调用）折叠成一行可展开的「执行步骤组」，对话流一级只保留最终回答 + 一行执行摘要，省屏效。

**Architecture:** 在 `AssistantTurnRenderer` 渲染前，用一个纯函数 `groupExecutionSteps` 把顶层内容块序列预处理成「渲染项列表」（透传块 / 执行步骤组）；新增 `ExecutionStepGroup` 组件渲染折叠行 + 可展开详情，内部复用现有 `ContentBlock` 逐条渲染步骤，保证流程样式一致。分组规则：连续≥2 个同说话人过程块成组；最终回答（text）、说话人切换、TodoBoard 卡片均切断分组；单步退化为直接渲染原块。

**Tech Stack:** TypeScript（严格模式，导入带 `.ts`/`.tsx` 扩展名）、React 18、Bun test、i18next（`conversation` 命名空间，en+zh 同步）、Tailwind 语义 token。

**领域语言事实源：** 仓库根 `CONTEXT.md`（回合 / 过程块 / 最终回答 / 执行步骤组 / 队友 / TodoBoard）。

---

## 设计决策快照（已与产品锁定）

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | 分组边界 | 连续≥2 过程块成组；最终回答(text)切断；队友切换切断；TodoBoard 切断 |
| 2 | 折叠行文案 | 运行中=当前步(转圈)；完成="已执行 N 步"；有失败="⚠ 已执行 N 步·M 步失败" |
| 3 | 运行期默认 | 折叠，点击才展开 |
| 4 | 子 Agent | 每个队友单独成组，折叠行带队友名徽标（⊙ 名字·执行 N 步） |
| 5 | TodoBoard | 独立卡片保持可见，不折叠；同样切断分组 |
| 6 | 错误 | 折叠行加报错徽标，不自动展开 |
| 7 | 单步 | 只 1 步不成组，直接显原块（保留具体工具名） |
| 8 | 展开后流式 | 跟随追加；该组跑完自动收成汇总行 |
| 9 | 组内状态 | 两级嵌套：每步仍是一行，可再点开看详情 |

---

## File Structure

| 文件 | 责任 | 动作 |
|------|------|------|
| `apps/electron/src/renderer/components/agent/tool-result-lookup.ts` | 从 `allMessages` 中按 `tool_use_id` 查工具结果的纯函数（从 ContentBlock 抽出，供组件与分组摘要共用） | Create |
| `apps/electron/src/renderer/components/agent/tool-result-lookup.test.ts` | 上面纯函数的单测 | Create |
| `apps/electron/src/renderer/components/agent/group-execution-steps.ts` | 分组纯函数 `groupExecutionSteps` + 摘要 `summarizeExecutionGroup` + 类型 | Create |
| `apps/electron/src/renderer/components/agent/group-execution-steps.test.ts` | 分组与摘要的单测（分组算法核心） | Create |
| `apps/electron/src/renderer/components/agent/ExecutionStepGroup.tsx` | 折叠行 + 可展开详情组件；自动收起、报错徽标、队友徽标、当前步标签 | Create |
| `apps/electron/src/renderer/components/agent/ContentBlock.tsx` | `useToolResult` 改为调用抽出的纯函数（无行为变化） | Modify (47-75) |
| `apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx` | `AssistantTurnRenderer` 渲染循环改走 `groupExecutionSteps` | Modify (510-555) |
| `apps/electron/src/renderer/locales/en/conversation/agent.json` | 新增执行组 i18n key（英文） | Modify |
| `apps/electron/src/renderer/locales/zh/conversation/agent.json` | 新增执行组 i18n key（中文，与 en 同步） | Modify |
| `apps/electron/package.json` | patch 版本号递增 | Modify |

---

## Task 1: 抽出工具结果查找纯函数

把 `ContentBlock.tsx` 里 `useToolResult` 的查找逻辑抽成独立纯函数 `findToolResultInMessages`，让分组摘要也能复用（且可单测）。`useToolResult` 改为只包一层 `useMemo`。

**Files:**
- Create: `apps/electron/src/renderer/components/agent/tool-result-lookup.ts`
- Create: `apps/electron/src/renderer/components/agent/tool-result-lookup.test.ts`
- Modify: `apps/electron/src/renderer/components/agent/ContentBlock.tsx:39-75`

- [ ] **Step 1: 写失败测试**

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

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test apps/electron/src/renderer/components/agent/tool-result-lookup.test.ts`
Expected: FAIL — `Cannot find module './tool-result-lookup.ts'`

- [ ] **Step 3: 写最小实现**

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

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test apps/electron/src/renderer/components/agent/tool-result-lookup.test.ts`
Expected: PASS（4 个测试）

- [ ] **Step 5: 改 ContentBlock.tsx 复用纯函数**

在 `ContentBlock.tsx` 顶部 import 区（约 37 行 `isSubagentToolUse` 那段附近）加入：

```ts
import { findToolResultInMessages, type ToolResultData } from './tool-result-lookup.ts'
```

删除 `ContentBlock.tsx` 第 39-75 行原有的 `ToolResultData` 接口与 `useToolResult` 实现，替换为：

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

- [ ] **Step 6: 类型检查 + 测试**

Run: `bun run typecheck && bun test apps/electron/src/renderer/components/agent/`
Expected: PASS（含原 ContentBlock.test.ts 不回归）

- [ ] **Step 7: Commit**

```bash
git add apps/electron/src/renderer/components/agent/tool-result-lookup.ts apps/electron/src/renderer/components/agent/tool-result-lookup.test.ts apps/electron/src/renderer/components/agent/ContentBlock.tsx
git commit -m "refactor(conversation): 抽出 findToolResultInMessages 纯函数供分组复用"
```

---

## Task 2: 分组纯函数 groupExecutionSteps

实现分组核心算法 + 摘要函数。这是整个特性的可测试核心，必须先于组件落地。

**Files:**
- Create: `apps/electron/src/renderer/components/agent/group-execution-steps.ts`
- Create: `apps/electron/src/renderer/components/agent/group-execution-steps.test.ts`

- [ ] **Step 1: 写失败测试**

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

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test apps/electron/src/renderer/components/agent/group-execution-steps.test.ts`
Expected: FAIL — `Cannot find module './group-execution-steps.ts'`

- [ ] **Step 3: 写最小实现**

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

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test apps/electron/src/renderer/components/agent/group-execution-steps.test.ts`
Expected: PASS（8 个测试）

- [ ] **Step 5: Commit**

```bash
git add apps/electron/src/renderer/components/agent/group-execution-steps.ts apps/electron/src/renderer/components/agent/group-execution-steps.test.ts
git commit -m "feat(conversation): 新增 groupExecutionSteps 分组纯函数 + 单测"
```

---

## Task 3: 执行组 i18n key（en + zh 同步）

新增折叠行汇总文案。当前步标签复用已有的 `conversation.tool.*`（getToolPhrase）与 `agent.messages.thinkingStreaming`，无需新增；本任务只加「已执行 N 步」「N 步失败」两条。

**Files:**
- Modify: `apps/electron/src/renderer/locales/en/conversation/agent.json`
- Modify: `apps/electron/src/renderer/locales/zh/conversation/agent.json`

- [ ] **Step 1: 定位 messages 段**

两个文件都在 `"messages": { ... }` 段（en 文件约第 113 行）。该段已有 `thinkingStreaming` / `thinking` / `thinkingWithDuration` 等 key。

- [ ] **Step 2: en 加 key**

在 `apps/electron/src/renderer/locales/en/conversation/agent.json` 的 `"messages"` 对象内，`thinkingStreaming` 同级处加入（注意补逗号）：

```json
      "executedSteps": "Executed {{count}} steps",
      "executedStepsWithFailures": "Executed {{count}} steps · {{failed}} failed"
```

- [ ] **Step 3: zh 加 key（同名）**

在 `apps/electron/src/renderer/locales/zh/conversation/agent.json` 的 `"messages"` 对象内，同级处加入：

```json
      "executedSteps": "已执行 {{count}} 步",
      "executedStepsWithFailures": "已执行 {{count}} 步 · {{failed}} 步失败"
```

- [ ] **Step 4: 跑 key-parity 校验**

Run: `bun test apps/electron/src/renderer/locales/__tests__/key-parity.test.ts`
Expected: PASS（en/zh key 对齐）

> 若上面路径不存在，先定位：`rg -l "key-parity" apps/electron --glob "*.test.*"` 然后跑该文件。

- [ ] **Step 5: Commit**

```bash
git add apps/electron/src/renderer/locales/en/conversation/agent.json apps/electron/src/renderer/locales/zh/conversation/agent.json
git commit -m "feat(i18n): 执行步骤组折叠行汇总文案（en+zh）"
```

---

## Task 4: ExecutionStepGroup 组件

折叠行（默认折叠）+ 可展开详情。运行中显示当前步（转圈），完成后显示「已执行 N 步」，有失败显示报错徽标；队友组带名字徽标；该组从 live→done 时自动收起。展开后逐条复用 `ContentBlock`，样式与今天一致。

**Files:**
- Create: `apps/electron/src/renderer/components/agent/ExecutionStepGroup.tsx`

- [ ] **Step 1: 写组件**

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

- [ ] **Step 2: 类型检查**

Run: `bun run typecheck`
Expected: PASS（确认 `ContentBlock` 为具名导出、`getToolPhrase`/`summarizeExecutionGroup`/`speakerDisplayName` 路径正确）

- [ ] **Step 3: Commit**

```bash
git add apps/electron/src/renderer/components/agent/ExecutionStepGroup.tsx
git commit -m "feat(conversation): 新增 ExecutionStepGroup 折叠组组件"
```

---

## Task 5: 接入 AssistantTurnRenderer 渲染循环

把 `SDKMessageRenderer.tsx` 的渲染循环从「逐块 map」改成「先 groupExecutionSteps，再按渲染项 map」。保留 TodoBoard 卡片（firstTaskIndex）、scenario 徽标、text 前置 gap 逻辑。

**Files:**
- Modify: `apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx`（import 区 + 510-555 渲染块）

- [ ] **Step 1: 加 import**

在 `SDKMessageRenderer.tsx` import 区（已有 `import { TaskProgressCard, TASK_TOOL_NAMES } from './TaskProgressCard'` 一行附近）加入：

```ts
import { groupExecutionSteps } from './group-execution-steps.ts'
import { ExecutionStepGroup } from './ExecutionStepGroup.tsx'
```

- [ ] **Step 2: 在 return 前计算渲染项**

在 `AssistantTurnRenderer` 的 `return (` 之前（即 `taskActivities` 的 `useMemo` 之后、约第 509 行 `return (` 上方）插入：

```tsx
  // 0.2.0：把顶层块序列预处理成「渲染项」——连续≥2 过程块折叠成执行步骤组
  const renderItems = React.useMemo(
    () => groupExecutionSteps(topLevelEnriched, firstTaskIndex),
    [topLevelEnriched, firstTaskIndex],
  )
```

> 注意：`topLevelEnriched` 的元素形如 `{ block, speaker }`，与 `groupExecutionSteps` 的 `EnrichedBlock` 同构，可直接传入。

- [ ] **Step 3: 替换渲染循环**

把 `SDKMessageRenderer.tsx` 第 513-555 行的 `<div className={cn('space-y-2')}>{topLevelEnriched.map(...)}</div>` 整块替换为：

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

> 不再需要原循环里基于 `firstTaskIndex` 的 `i === firstTaskIndex ? card : null` 分支——`groupExecutionSteps` 已把「仅首个 task 块透传、其余跳过」处理掉。

- [ ] **Step 4: 类型检查 + 全量测试**

Run: `bun run typecheck && bun test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx
git commit -m "feat(conversation): AssistantTurnRenderer 接入执行步骤组渲染"
```

---

## Task 6: 版本号递增 + 全链路验证

**Files:**
- Modify: `apps/electron/package.json`（`version`）

- [ ] **Step 1: patch 版本号 +1**

把 `apps/electron/package.json` 的 `"version": "0.1.339-rc.1"` 改为 `"version": "0.1.340-rc.1"`。
（若实现时已不是 0.1.339，按当前 patch +1。）

- [ ] **Step 2: 机器校验**

Run: `bun run typecheck && bun test`
Expected: 全 PASS（含 key-parity）

- [ ] **Step 3: simplify 复盘**

对 `group-execution-steps.ts`、`ExecutionStepGroup.tsx`、`SDKMessageRenderer.tsx` 改动跑一次 `@code-simplifier` / `simplify`，复盘组件化与可读性。

- [ ] **Step 4: 手动 dev 走查（UI 必做，无法自验则显式告知用户）**

Run: `bun run dev`，在浏览器里走以下 golden path + 边界：

1. **多步成组**：发一个会触发多次工具调用的请求 → 运行中折叠行显示当前步+转圈；跑完自动收成「已执行 N 步」。
2. **展开/折叠**：点折叠行 → 逐条步骤一行；再点某步 → 展开该步详情（两级嵌套）。
3. **单步退化**：只调一次工具的请求 → 不出现「执行 1 步」，直接显该工具行（如「读取 xxx」）。
4. **文字切断**：Agent 中途回半句再继续 → 组 → 文字 → 新组。
5. **队友分组**：触发派发子 Agent（狐尼克/鹰尼克）→ 每个队友单独一组，折叠行带 ⊙ 名字徽标。
6. **TodoBoard**：触发 TodoWrite → 进度卡片独立可见，不被折叠（组 → 卡片 → 组）。
7. **报错徽标**：制造一个工具失败（如读不存在的文件）→ 折叠行显示「⚠ 已执行 N 步·1 步失败」红色态，不自动展开。
8. **i18n**：设置页切 zh↔en 各走一遍，折叠行汇总文案无 raw key、无漏翻。
9. **历史回放**：重开一个历史会话 → 组按规则默认折叠，可正常展开。

- [ ] **Step 5: Commit**

```bash
git add apps/electron/package.json
git commit -m "chore(electron): patch 版本号递增（执行步骤组）"
```

---

## Self-Review（写完计划后自检）

**Spec coverage（设计决策 → 任务映射）：**

| 决策 | 落在 |
|------|------|
| ① 分组边界（text/队友/TodoBoard 切断，≥2 成组） | Task 2 `groupExecutionSteps` + 测试 |
| ② 折叠行文案（运行=当前步 / 完成=N 步 / 失败徽标） | Task 3 i18n + Task 4 `labelText`/`StatusIcon` |
| ③ 运行期默认折叠 | Task 4 `useState(false)` |
| ④ 每队友一组 | Task 2 `speakerKey` 切断 + Task 4 队友徽标 |
| ⑤ TodoBoard 独立可见 | Task 2 首个 task 块透传 + Task 5 TaskProgressCard 分支 |
| ⑥ 报错徽标不自动展开 | Task 2 `summarizeExecutionGroup` + Task 4 失败态文案/图标 |
| ⑦ 单步退化 | Task 2 `steps.length === 1 → block` + 测试 |
| ⑧ 完成后自动收 | Task 4 `prevLiveRef` effect |
| ⑨ 两级嵌套样式一致 | Task 4 展开区复用 `ContentBlock` |

**Placeholder scan：** 无 TBD / “handle edge cases” 占位；每个 code step 均给出完整代码。

**Type consistency：** `EnrichedBlock`/`GroupStep`/`ExecutionRenderItem` 在 Task 2 定义，Task 4/5 一致引用；`ToolResultData`/`findToolResultInMessages` 在 Task 1 定义，Task 2 `summarizeExecutionGroup` 与 ContentBlock 一致引用；`isLive`/`speaker`/`steps` props 在 Task 4 定义、Task 5 一致传入。

**已知实现层假设（执行时需复核）：**
- `topLevelEnriched` 元素结构与 `EnrichedBlock` 同构（`{ block, speaker }`）——见 SDKMessageRenderer.tsx:405-408，成立。
- key-parity 测试路径若与 Task 3 Step 4 不符，按 `rg -l "key-parity"` 实际路径跑。
- `usePreserveScrollOnExpand` 返回带 `snapshot()` 的对象（ContentBlock 用法一致）。
