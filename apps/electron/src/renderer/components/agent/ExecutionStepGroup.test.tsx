/**
 * ExecutionStepGroup 渲染测试：
 *  - 折叠态（#443）：恒中性「已执行 N 步」、无红色失败后缀、图标不含 text-destructive。
 *  - 展开态 dot 列表（Codex 风）：每步渲染 dot 节点；thinking 默认展开直显内容、工具步保持折叠。
 */

import type * as React from 'react'
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { StickToBottom } from 'use-stick-to-bottom'
import { ExecutionStepGroup } from './ExecutionStepGroup.tsx'
import { i18n } from '@/lib/i18n'
import type { SDKContentBlock, SDKMessage } from '@asci/shared'
import type { GroupStep } from './group-execution-steps.ts'

// 折叠行文案断言依赖 zh（「已执行 N 步」），测试环境默认 en；统一切 zh 跑完再切回。
beforeAll(async () => {
  await i18n.changeLanguage('zh')
})

afterAll(async () => {
  await i18n.changeLanguage('en')
})

// bun:test 不自带 testing-library auto-cleanup，显式清理避免跨用例 DOM 污染。
afterEach(() => {
  cleanup()
})

function tool(id: string, name = 'Read'): SDKContentBlock {
  return { type: 'tool_use', id, name, input: {} } as SDKContentBlock
}

function thinking(text: string): SDKContentBlock {
  return { type: 'thinking', thinking: text } as SDKContentBlock
}

// 照搬 group-execution-steps.test.ts 的 helper：构造带 is_error 的工具结果 user 消息
function userToolResult(id: string, isError?: boolean): SDKMessage {
  return {
    type: 'user', parent_tool_use_id: null,
    message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'r', is_error: isError }] },
  } as unknown as SDKMessage
}

const STEPS: GroupStep[] = [
  { block: tool('a'), originalIndex: 0 },
  { block: tool('b'), originalIndex: 1 },
]

// usePreserveScrollOnExpand 依赖 StickToBottom context，需包一层 provider
function renderInConversation(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<StickToBottom>{ui}</StickToBottom>)
}

function rerenderInConversation(
  r: ReturnType<typeof render>, ui: React.ReactElement,
): void {
  r.rerender(<StickToBottom>{ui}</StickToBottom>)
}

describe('ExecutionStepGroup 折叠态（#443 失败不突出）', () => {
  it('完成态含失败步：渲染「已执行 N 步」，且无失败后缀文案', () => {
    const msgs = [userToolResult('a', false), userToolResult('b', true)]
    renderInConversation(
      <ExecutionStepGroup steps={STEPS} speaker="master" allMessages={msgs} isLive={false} turnStreaming={false} />,
    )
    expect(screen.getByText('已执行 2 步')).toBeInTheDocument()
    // 折叠态不出现任何失败提示（红色后缀已移除）
    expect(screen.queryByText(/失败|failed/)).toBeNull()
  })

  it('完成态含失败步：状态图标容器不含 text-destructive 类', () => {
    const msgs = [userToolResult('a', false), userToolResult('b', true)]
    const { container } = renderInConversation(
      <ExecutionStepGroup steps={STEPS} speaker="master" allMessages={msgs} isLive={false} turnStreaming={false} />,
    )
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('class') ?? '').not.toContain('text-destructive')
  })
})

describe('ExecutionStepGroup 展开态 dot 列表', () => {
  // 点开折叠行（首个 expandable button 即组头）进入展开态
  function expandGroup(): void {
    fireEvent.click(screen.getAllByRole('button')[0]!)
  }

  it('展开后每步渲染一个 dot 节点（N 步 → N 个 dot）', () => {
    const steps: GroupStep[] = [
      { block: thinking('思考甲'), originalIndex: 0 },
      { block: tool('a'), originalIndex: 1 },
      { block: thinking('思考乙'), originalIndex: 2 },
    ]
    const { container } = renderInConversation(
      <ExecutionStepGroup steps={steps} speaker="master" allMessages={[]} isLive={false} turnStreaming={false} />,
    )
    expandGroup()
    // dot 节点用 `size-1.5 rounded-full` 渲染，每步恰好一个
    const dots = container.querySelectorAll('span.size-\\[5px\\].rounded-full')
    expect(dots.length).toBe(3)
  })

  it('步骤标题下分割线更贴近标题，展开内容块内部节奏更紧凑', () => {
    const steps: GroupStep[] = [
      { block: thinking('思考甲'), originalIndex: 0 },
      { block: tool('a'), originalIndex: 1 },
    ]
    const { container } = renderInConversation(
      <ExecutionStepGroup steps={steps} speaker="master" allMessages={[]} isLive={false} turnStreaming={false} />,
    )
    const divider = container.querySelector('.border-border\\/40')
    expect(divider?.getAttribute('class') ?? '').toContain('mt-1')

    expandGroup()
    const body = container.querySelector('[data-step-section-body]')
    expect(body?.getAttribute('class') ?? '').toContain('mt-2.5')
    expect(body?.getAttribute('class') ?? '').toContain('space-y-3')

    const list = container.querySelector('.space-y-3')
    expect(list).not.toBeNull()
  })

  it('子 Agent 小标题低权重，dimmed 步骤组里的工具卡执行内容仍与正文同深色', () => {
    const steps: GroupStep[] = [
      { block: tool('a'), originalIndex: 0 },
    ]
    const { container } = renderInConversation(
      <ExecutionStepGroup steps={steps} speaker={{ kind: 'scenario', name: 'searcher' }} allMessages={[]} isLive={false} turnStreaming={false} dimmed />,
    )
    expandGroup()

    const scenarioLabel = screen.getByText('searcher').parentElement
    expect(scenarioLabel?.getAttribute('class') ?? '').toContain('text-muted-foreground/70')
    expect(scenarioLabel?.getAttribute('class') ?? '').toContain('font-normal')

    const toolCard = container.querySelector('[data-tool-card="true"]')
    const toolText = within(toolCard as HTMLElement).getByText('读取文件')
    expect(toolText.getAttribute('class') ?? '').toContain('!text-foreground/85')
  })

  it('thinking 步默认展开直接显示思考内容（无需点开内层行）', () => {
    const steps: GroupStep[] = [
      { block: thinking('深度推理内容'), originalIndex: 0 },
      { block: tool('a'), originalIndex: 1 },
    ]
    renderInConversation(
      <ExecutionStepGroup steps={steps} speaker="master" allMessages={[]} isLive={false} turnStreaming={false} />,
    )
    expandGroup()
    expect(screen.getByText('深度推理内容')).toBeInTheDocument()
  })

  it('工具步默认折叠：结果文案展开内层行后才出现', () => {
    const steps: GroupStep[] = [{ block: tool('a'), originalIndex: 0 }]
    const msgs: SDKMessage[] = [{
      type: 'user', parent_tool_use_id: null,
      message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: '工具结果详情', is_error: false }] },
    } as unknown as SDKMessage]
    renderInConversation(
      <ExecutionStepGroup steps={steps} speaker="master" allMessages={msgs} isLive={false} turnStreaming={false} />,
    )
    expandGroup()
    // 组展开后工具行仍折叠，结果文案不可见
    expect(screen.queryByText('工具结果详情')).toBeNull()
    // 单工具步：展开后恰好 2 个 button（组头 + 工具行），点工具行
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[1]!)
    expect(within(document.body).getByText('工具结果详情')).toBeInTheDocument()
  })

  it('运行中手动展开：isLive 瞬时 true→false（仍 turnStreaming）不应收回展开', () => {
    // 模拟「最后工作组」被点开后，agent 返回新结果致本组不再是流尾 → isLive false，
    // 但整个 turn 仍在跑（turnStreaming true）。此时不能收回用户的手动展开。
    const r = renderInConversation(
      <ExecutionStepGroup steps={STEPS} speaker="master" allMessages={[]} isLive turnStreaming />,
    )
    expandGroup()
    const dotsBefore = r.container.querySelectorAll('span.size-\\[5px\\].rounded-full')
    expect(dotsBefore.length).toBe(2) // 已展开：2 个 dot

    // isLive 翻 false（不再是流尾），但 turnStreaming 维持 true
    rerenderInConversation(
      r, <ExecutionStepGroup steps={STEPS} speaker="master" allMessages={[]} isLive={false} turnStreaming />,
    )
    const dotsAfter = r.container.querySelectorAll('span.size-\\[5px\\].rounded-full')
    expect(dotsAfter.length).toBe(2) // 仍展开，未被收回
  })

  it('turn 真正结束（turnStreaming→false）：自动收回展开（产品本意）', () => {
    const r = renderInConversation(
      <ExecutionStepGroup steps={STEPS} speaker="master" allMessages={[]} isLive turnStreaming />,
    )
    expandGroup()
    expect(r.container.querySelectorAll('span.size-\\[5px\\].rounded-full').length).toBe(2)

    // run 结束：turnStreaming 翻 false → 自动收起
    rerenderInConversation(
      r, <ExecutionStepGroup steps={STEPS} speaker="master" allMessages={[]} isLive={false} turnStreaming={false} />,
    )
    expect(r.container.querySelectorAll('span.size-\\[5px\\].rounded-full').length).toBe(0)
  })

  it('失败工具步：dot 节点保留为黑灰色（不替换成 XCircle、不染红）', () => {
    const steps: GroupStep[] = [
      { block: thinking('思考'), originalIndex: 0 },
      { block: tool('a'), originalIndex: 1 },
    ]
    const msgs = [userToolResult('a', true)]
    const { container } = renderInConversation(
      <ExecutionStepGroup steps={steps} speaker="master" allMessages={msgs} isLive={false} turnStreaming={false} />,
    )
    expandGroup()
    // 失败步与正常步同样渲染黑灰 dot；不再用 destructive 色标记失败
    const dots = container.querySelectorAll('span.size-\\[5px\\].rounded-full')
    expect(dots.length).toBe(2)
    expect(container.querySelector('span.size-\\[5px\\].rounded-full.bg-destructive\\/70')).toBeNull()
    // 不应出现替换节点的 XCircle svg
    expect(container.querySelector('svg[class*="text-destructive"]')).toBeNull()
  })
})


it('进行中的执行组使用静态标记，不重复播放加载动画', () => {
 const { container } = renderInConversation(
  <ExecutionStepGroup steps={STEPS} speaker="master" allMessages={[]} isLive turnStreaming />,
 )
 expect(container.querySelector('.animate-spin')).toBeNull()
 expect(container.querySelector('.animate-pulse')).toBeNull()
})
