/**
 * requestSpanProducedReview 行为单测
 *
 * 复现并锁定 issue：大综述在 `Write reviews/*.html` 之后触发 compact_boundary，把 Write 与最终
 * 总结切到两个 turn；"加入证据集"按钮挂在总结所在 turn 上，旧实现只扫该 turn 的 `Write` → 误判
 * 无综述 → includeReviewCitations=false → "本回答未引用相关论文"。
 *
 * 修复 ①+②：扫「上一条真实 user-input → 当前 turn 末尾」整段（跨 compact_boundary，遇真实
 * user-input 即止）、同时识别 Write 与 Edit。
 */

import type * as React from 'react'
import { describe, expect, test, beforeAll, afterAll, afterEach } from 'bun:test'
import { render, cleanup, screen } from '@testing-library/react'
import { StickToBottom } from 'use-stick-to-bottom'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

import { i18n } from '@/lib/i18n'
import { AssistantTurnRenderer, groupIntoTurns, requestSpanProducedReview, type AssistantTurn } from './SDKMessageRenderer.tsx'

// ─── 最小消息构造器（仅填 helper / groupIntoTurns 实际读取的字段） ───
let seq = 0
const REVIEW = 'reviews/2026-01-01_10-00-x.html'

const asst = (blocks: unknown[]): SDKMessage =>
  ({ type: 'assistant', uuid: `a${++seq}`, message: { content: blocks } }) as unknown as SDKMessage
const asstWithParent = (parentToolUseId: string, blocks: unknown[]): SDKMessage =>
  ({ type: 'assistant', uuid: `a${++seq}`, parent_tool_use_id: parentToolUseId, message: { content: blocks } }) as unknown as SDKMessage
const userInput = (t: string): SDKMessage =>
  ({ type: 'user', uuid: `u${++seq}`, message: { content: [{ type: 'text', text: t }] } }) as unknown as SDKMessage
const toolResult = (): SDKMessage =>
  ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] } }) as unknown as SDKMessage
const compactBoundary = (): SDKMessage =>
  ({ type: 'system', subtype: 'compact_boundary' }) as unknown as SDKMessage

const writeReview = (p = REVIEW): unknown => ({ type: 'tool_use', name: 'Write', id: `t${++seq}`, input: { file_path: p } })
const editReview = (p = REVIEW): unknown => ({ type: 'tool_use', name: 'Edit', id: `t${++seq}`, input: { file_path: p } })
const agentTool = (id: string, subagentType: string): unknown =>
  ({ type: 'tool_use', name: 'Agent', id, input: { subagent_type: subagentType, prompt: '执行任务' } })
const paperSearchTool = (id: string): unknown => ({ type: 'tool_use', name: 'PAPER-SEARCH', id, input: { query: 'gut microbiota' } })
const textBlock = (t: string): unknown => ({ type: 'text', text: t })
const thinkingBlock = (t: string): unknown => ({ type: 'thinking', thinking: t })

/** 取分组后最后一个 assistant-turn（"加入证据集"按钮所在的总结 turn） */
function lastAssistantTurn(messages: SDKMessage[]): AssistantTurn {
  const groups = groupIntoTurns(messages)
  const turns = groups.filter((g): g is AssistantTurn => g.type === 'assistant-turn')
  return turns[turns.length - 1]!
}

function renderInConversation(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<StickToBottom>{ui}</StickToBottom>)
}

beforeAll(async () => {
  await i18n.changeLanguage('zh')
})

afterAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
})

describe('requestSpanProducedReview', () => {
  test('compaction 把 Write 与总结切成两 turn —— 仍判定为综述（核心回归）', () => {
    const messages = [
      userInput('@zotero-col 综述 multi agent'),
      asst([writeReview()]), // 综述 HTML 写出（压缩前 turn）
      compactBoundary(), // ← 上下文压缩，切断 turn
      asst([editReview()]), // fact-check 修正（压缩后 turn，用 Edit）
      asst([textBlock('综述已完成，经事实核查后修正了 3 处。')]), // 总结（按钮挂这里）
    ]
    const turn = lastAssistantTurn(messages)
    expect(requestSpanProducedReview(messages, turn)).toBe(true)
  })

  test('②：当前 turn 只有 Edit reviews/*.html（无 Write）也判定为综述', () => {
    const messages = [
      userInput('改一下综述'),
      asst([editReview()]),
      asst([textBlock('已更新综述。')]),
    ]
    expect(requestSpanProducedReview(messages, lastAssistantTurn(messages))).toBe(true)
  })

  test('单 turn 内 Write + 总结（无压缩）判定为综述', () => {
    const messages = [
      userInput('写综述'),
      asst([writeReview()]),
      toolResult(),
      asst([textBlock('综述已写好。')]),
    ]
    expect(requestSpanProducedReview(messages, lastAssistantTurn(messages))).toBe(true)
  })

  test('后续独立 Q&A（新 user-input 后）不被误判为综述——保留 message 粒度门控', () => {
    const messages = [
      userInput('写综述'),
      asst([writeReview()]),
      asst([textBlock('综述已写好。')]),
      userInput('顺便解释下什么是 RAG'), // ← 新请求边界
      asst([textBlock('RAG 是……')]), // 普通 Q&A turn，按钮挂这里
    ]
    // 最后一个 turn 的请求段从第二条 user-input 起算，扫不到前面的 Write
    expect(requestSpanProducedReview(messages, lastAssistantTurn(messages))).toBe(false)
  })

  test('非综述路径（无 Write/Edit reviews）判定为 false', () => {
    const messages = [
      userInput('查点论文'),
      asst([{ type: 'tool_use', name: 'Write', id: 't1', input: { file_path: 'notes/x.md' } }]),
      asst([textBlock('好了。')]),
    ]
    expect(requestSpanProducedReview(messages, lastAssistantTurn(messages))).toBe(false)
  })
})

describe('AssistantTurnRenderer 执行步骤分割线布局', () => {
  test('scenario 标签使用浅灰元信息样式，searcher、scorer 与 lit-review 都有图标且与工具卡等距', () => {
    const messages = [
      asst([agentTool('agent-searcher', 'searcher')]),
      asstWithParent('agent-searcher', [paperSearchTool('paper-searcher')]),
      asst([agentTool('agent-scorer', 'scorer')]),
      asstWithParent('agent-scorer', [paperSearchTool('paper-scorer')]),
      asst([agentTool('agent-lit-review', 'lit-review')]),
      asstWithParent('agent-lit-review', [paperSearchTool('paper-lit-review')]),
      asst([thinkingBlock('全部任务已完成。')]),
      asst([textBlock('以下是交付物汇总：')]),
      asst([thinkingBlock('准备下一轮。')]),
    ]
    const turn = lastAssistantTurn(messages)

    const { container } = renderInConversation(
      <AssistantTurnRenderer turn={turn} allMessages={messages} isStreaming={false} />,
    )

    for (const name of ['searcher', 'scorer', 'lit-review']) {
      const label = screen.getByText(name).parentElement
      expect(label?.getAttribute('class') ?? '').toContain('text-muted-foreground/70')
      expect(label?.getAttribute('class') ?? '').toContain('font-normal')
      expect(label?.getAttribute('class') ?? '').not.toContain('text-primary')
      expect(label?.querySelector('svg')).not.toBeNull()
      expect(label?.closest('.space-y-3')).not.toBeNull()
    }

    expect(container.querySelector('.space-y-1')).toBeNull()
    expect(container.querySelector('[data-agent-turn-items]')?.getAttribute('class') ?? '').toContain('flex')
    const topLevelItems = container.querySelectorAll('[data-agent-turn-item]')
    expect(topLevelItems[1]?.getAttribute('class') ?? '').toContain('mt-3')
    expect(topLevelItems[2]?.getAttribute('class') ?? '').toContain('mt-7')
    expect(topLevelItems[3]?.getAttribute('class') ?? '').toContain('mt-3')
    expect(topLevelItems[4]?.getAttribute('class') ?? '').toContain('mt-7')
    expect(topLevelItems[5]?.getAttribute('class') ?? '').toContain('mt-3')
    expect(topLevelItems[6]?.getAttribute('class') ?? '').toContain('mt-7')
    expect(topLevelItems[7]?.getAttribute('class') ?? '').toContain('mt-7')
  })

  test('单个思考块后接正文时，分割线也在思考标题下方', () => {
    const messages = [
      asst([
        thinkingBlock('检查现有交付物。'),
        textBlock('全部任务已完成。以下是交付物汇总：'),
      ]),
    ]
    const turn = lastAssistantTurn(messages)

    const { container } = renderInConversation(
      <AssistantTurnRenderer turn={turn} allMessages={messages} isStreaming={false} />,
    )

    const dividers = container.querySelectorAll('.border-border\\/40')
    expect(dividers).toHaveLength(1)
    expect(dividers[0]?.getAttribute('class') ?? '').toContain('mt-1')
    const thinkingHeader = container.querySelector('button')
    expect(thinkingHeader?.getAttribute('class') ?? '').toContain('-ml-2')
    expect(container.querySelector('[data-agent-turn-items]')?.getAttribute('class') ?? '').toContain('flex')
    const sectionBody = screen.getByText('全部任务已完成。以下是交付物汇总：').closest('[data-step-section-body]')
    expect(sectionBody).not.toBeNull()
    expect(sectionBody?.getAttribute('class') ?? '').toContain('mt-2.5')
    expect(sectionBody?.getAttribute('class') ?? '').toContain('space-y-3')
    expect(container.querySelector('.border-border\\/30')).toBeNull()
  })

  test('分割线属于步骤组标题下方，后续正文容器不再承载 border-t', () => {
    const messages = [
      asst([
        thinkingBlock('检索计划已确认。'),
        writeReview('notes/result.md'),
        textBlock('全部任务已完成。以下是交付物汇总：'),
      ]),
    ]
    const turn = lastAssistantTurn(messages)

    const { container } = renderInConversation(
      <AssistantTurnRenderer turn={turn} allMessages={messages} isStreaming={false} />,
    )

    expect(container.querySelector('.border-border\\/40')).not.toBeNull()
    expect(screen.getByText('全部任务已完成。以下是交付物汇总：').closest('[data-step-section-body]')).not.toBeNull()
    expect(container.querySelector('.border-border\\/30')).toBeNull()
  })

  test('正文 markdown 水平线不参与消息分割', () => {
    const messages = [
      asst([textBlock('全部任务已完成。\n\n---\n\n交付物：')]),
    ]
    const turn = lastAssistantTurn(messages)

    const { container } = renderInConversation(
      <AssistantTurnRenderer turn={turn} allMessages={messages} isStreaming={false} />,
    )

    const prose = container.querySelector('.prose')
    expect(prose?.getAttribute('class') ?? '').toContain('prose-hr:hidden')
  })
})

 test('empty thinking block preserves the following model reply', () => {
  const messages = [userInput('hello'), asst([thinkingBlock('')]), asst([textBlock('Visible model reply')])]
  renderInConversation(<AssistantTurnRenderer turn={lastAssistantTurn(messages)} allMessages={messages} />)
  expect(screen.queryByText('Visible model reply')).not.toBeNull()
})

test('general tool progress is collapsed while the final answer remains visible', () => {
 const messages = [userInput('latest news'), asst([textBlock('I will search now'), {type:'tool_use', id:'web1', name:'mcp__asci-web__search', input:{query:'Rocket Lab'}}]), asst([textBlock('The results were generic'), {type:'tool_use', id:'web2', name:'mcp__asci-web__fetch', input:{url:'https://example.com'}}]), asst([thinkingBlock('private reasoning'), textBlock('Final verified answer')])]
 const view = renderInConversation(<AssistantTurnRenderer compactProcess turn={lastAssistantTurn(messages)} allMessages={messages} />)
 const details = view.container.querySelector('details[data-agent-process]')!
 expect(details.hasAttribute('open')).toBe(false)
 expect(details.textContent).toContain('I will search now')
 expect(details.textContent).not.toContain('private reasoning')
 expect(details.textContent).not.toContain('Final verified answer')
 expect(screen.queryByText('Final verified answer')).not.toBeNull()
})
