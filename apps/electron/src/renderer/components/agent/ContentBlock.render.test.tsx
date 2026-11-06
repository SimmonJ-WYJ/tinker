import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import type * as React from 'react'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { StickToBottom } from 'use-stick-to-bottom'
import type { SDKContentBlock, SDKMessage } from '@asci/shared'
import { i18n } from '@/lib/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ContentBlock } from './ContentBlock.tsx'

beforeAll(async () => {
  await i18n.changeLanguage('zh')
})

afterAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
})

function toolResult(toolUseId: string, content: string): SDKMessage {
  return {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content,
          is_error: false,
        },
      ],
    },
  } as unknown as SDKMessage
}

function renderInConversation(ui: React.ReactElement): ReturnType<typeof render> {
  return render(
    <StickToBottom>
      <TooltipProvider>{ui}</TooltipProvider>
    </StickToBottom>,
  )
}

describe('ContentBlock 工具调用卡片样式', () => {
  test('Write 工具调用渲染为轻卡片，展开结果不再使用左竖线时间线', () => {
    const block = {
      type: 'tool_use',
      id: 'write-1',
      name: 'Write',
      input: { file_path: 'lit-review/写入 肠道菌群与抑郁症_简短综述.md' },
    } as SDKContentBlock

    const { container } = renderInConversation(
      <ContentBlock
        block={block}
        allMessages={[toolResult('write-1', '写入完成\n+75')]}
        isStreaming={false}
      />,
    )

    const card = container.querySelector('[data-tool-card="true"]')
    expect(card).not.toBeNull()
    const cardClass = card?.getAttribute('class') ?? ''
    // 过程日志卡片应比交付物卡更轻：低背景、低边框、低圆角，避免像大按钮。
    expect(cardClass).toContain('bg-background/55')
    expect(cardClass).toContain('rounded-lg')
    expect(cardClass).toContain('border-border/45')
    expect(cardClass).toContain('py-2')
    expect(cardClass).not.toContain('ring-1')
    expect(cardClass).not.toContain('shadow-sm')

    // 头部行为 flush 卡片头：铺满卡片、不再自带灰胶囊底（消除盒中盒）
    const headerBtn = within(card as HTMLElement).getByRole('button')
    expect(headerBtn.getAttribute('class') ?? '').toContain('w-full')
    expect(headerBtn.getAttribute('class') ?? '').not.toContain('bg-muted-foreground/8')

    fireEvent.click(headerBtn)

    // 展开结果不再套内层灰卡（各结果渲染器自带背景），也不用左竖线时间线
    const expanded = container.querySelector('[data-tool-result-card="true"]')
    expect(expanded?.getAttribute('class') ?? '').not.toContain('bg-muted/35')
    expect(expanded?.getAttribute('class') ?? '').not.toContain('shadow-inner')
    expect(expanded?.getAttribute('class') ?? '').not.toContain('border-l-2')
  })
})
