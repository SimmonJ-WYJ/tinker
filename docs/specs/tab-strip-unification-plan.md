# Tab Strip Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让主对话流顶部采用 Codex 式单行 header；右侧栏顶部继续使用统一组件化 tab 视觉。

**Architecture:** 新增一个轻量 tab strip primitive 文件，仅负责 className 拼装和状态变体。`TabBar` 保留会话 tab 业务逻辑，但渲染列表由所有可见 tab 收敛为当前会话的 Codex 式单行 header；`AgentView` 不再额外渲染第二行会话标题；`RightPanelTabBar` 继续渲染全部上下文 tab，并复用 tab chip primitive。

**Tech Stack:** React 18, Jotai, Tailwind, Bun test.

---

### Task 1: 测试主顶部 tab 选择逻辑

**Files:**
- Test: `apps/electron/src/renderer/components/tabs/TabBar.test.ts`
- Modify: `apps/electron/src/renderer/components/tabs/TabBar.tsx`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'bun:test'
import { selectTopConversationTabs } from './TabBar.tsx'
import type { TabItem } from '@/atoms/tab-atoms'

function makeTab(id: string): TabItem {
  return { id, type: 'agent', sessionId: id, title: id, workspaceId: 'ws' }
}

describe('selectTopConversationTabs', () => {
  it('只返回当前 active tab', () => {
    expect(selectTopConversationTabs([makeTab('a'), makeTab('b')], 'b').map((tab) => tab.id)).toEqual(['b'])
  })

  it('active 不可见时回退到第一个可见 tab', () => {
    expect(selectTopConversationTabs([makeTab('a'), makeTab('b')], 'missing').map((tab) => tab.id)).toEqual(['a'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/electron/src/renderer/components/tabs/TabBar.test.ts`
Expected: FAIL because `selectTopConversationTabs` is not exported.

- [ ] **Step 3: Write minimal implementation**

Export `selectTopConversationTabs()` from `TabBar.tsx` and use it before rendering `TabBarInner`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/electron/src/renderer/components/tabs/TabBar.test.ts`
Expected: PASS.

### Task 2: 抽共享顶部导航 primitive

**Files:**
- Create: `apps/electron/src/renderer/components/tabs/tab-strip-primitives.ts`
- Test: `apps/electron/src/renderer/components/tabs/tab-strip-primitives.test.ts`
- Modify: `apps/electron/src/renderer/components/tabs/TabBarItem.tsx`
- Modify: `apps/electron/src/renderer/components/app-shell/RightPanelTabBar.tsx`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'bun:test'
import {
  currentConversationStripClassNames,
  tabStripChipClassNames,
} from './tab-strip-primitives.ts'

describe('tabStripChipClassNames', () => {
  it('右侧栏 active chip 使用共享激活态', () => {
    const cls = tabStripChipClassNames({ active: true, size: 'compact' })
    expect(cls).toContain('bg-content-area')
    expect(cls).toContain('text-foreground')
    expect(cls).toContain('rounded-t-xl')
  })

  it('inactive chip 使用共享 hover 态', () => {
    const cls = tabStripChipClassNames({ active: false, size: 'compact' })
    expect(cls).toContain('text-muted-foreground')
    expect(cls).toContain('hover:bg-muted/50')
    expect(cls).toContain('rounded-t-xl')
  })

  it('主对话顶部使用 Codex 式单行标题入口而不是 tab chip', () => {
    const cls = currentConversationStripClassNames()
    expect(cls).toContain('text-foreground')
    expect(cls).toContain('inline-flex')
    expect(cls).toContain('h-10')
    expect(cls).not.toContain('bg-content-area')
    expect(cls).not.toContain('flex-1')
    expect(cls).not.toContain('rounded-t-xl')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/electron/src/renderer/components/tabs/tab-strip-primitives.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement primitive and replace class duplication**

Create class helpers for root, right-panel chip, current-conversation header entry, icon, label, close button, and scroll buttons. Replace `TabBarItem` and `RightPanelTabBar.TabChip` class duplication with these helpers.

- [ ] **Step 4: Run focused tests**

Run: `bun test apps/electron/src/renderer/components/tabs/TabBar.test.ts apps/electron/src/renderer/components/tabs/tab-strip-primitives.test.ts`
Expected: PASS.

### Task 3: 版本与验证

**Files:**
- Modify: `apps/electron/package.json`

- [ ] **Step 1: Bump affected package patch**

Change `@asci/electron` from `0.1.533` to `0.1.534`.

- [ ] **Step 2: Full checks**

Run:
```bash
bun run typecheck
bun test
```

Expected: both pass.

- [ ] **Step 3: UI preview**

Run: `bun run electron:start` or `bun run dev` and inspect the Codex-like main conversation header and right-panel top tabs.
