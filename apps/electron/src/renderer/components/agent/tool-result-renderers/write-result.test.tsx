import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import type * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { StickToBottom } from 'use-stick-to-bottom'
import { i18n } from '@/lib/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WriteResultRenderer } from './write-result.tsx'

beforeAll(async () => {
  await i18n.changeLanguage('zh')
})

afterAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
})

function renderInConversation(ui: React.ReactElement): ReturnType<typeof render> {
  return render(
    <StickToBottom>
      <TooltipProvider>{ui}</TooltipProvider>
    </StickToBottom>,
  )
}

describe('WriteResultRenderer', () => {
  test('长写入内容使用预览卡片，避免展开工具时整屏铺满 diff', () => {
    const content = Array.from(
      { length: 80 },
      (_, index) => `第 ${index + 1} 行内容：这是一段用于模拟长文档写入结果的正文，长度足够触发预览卡片。`,
    ).join('\n')

    const { container } = renderInConversation(
      <WriteResultRenderer
        result=""
        isError={false}
        input={{ file_path: 'report.md', content }}
      />,
    )

    const card = container.querySelector('.not-prose.rounded-xl')
    expect(card?.getAttribute('class') ?? '').toContain('rounded-xl')
    expect(card?.getAttribute('class') ?? '').toContain('bg-card/70')
    expect(container.querySelector('.bg-diff-add-bg')).toBeNull()
    expect(screen.getByText('预览 10 行')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /显示全部/ })).toBeInTheDocument()
    expect(screen.queryByText(/第 80 行内容/)).toBeNull()
  })
})
