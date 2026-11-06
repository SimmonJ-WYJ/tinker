import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import type * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { StickToBottom } from 'use-stick-to-bottom'
import { CollapsibleResult } from './collapsible-result.tsx'
import { i18n } from '@/lib/i18n'

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
  return render(<StickToBottom>{ui}</StickToBottom>)
}

describe('CollapsibleResult', () => {
  test('长结果折叠为带预览和更多按钮的轻卡片', () => {
    const content = Array.from({ length: 8 }, (_, index) => `第 ${index + 1} 行`).join('\n')

    const { container } = renderInConversation(
      <CollapsibleResult
        content={content}
        threshold={10}
        previewLines={3}
        renderContent={(text) => <pre>{text}</pre>}
      />,
    )

    const card = container.querySelector('.not-prose')
    expect(card?.getAttribute('class') ?? '').toContain('rounded-xl')
    expect(card?.getAttribute('class') ?? '').toContain('border-border/60')
    expect(card?.getAttribute('class') ?? '').toContain('bg-card/70')
    expect(screen.getByText('预览 3 行')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /显示全部/ })).toBeInTheDocument()
    expect(screen.queryByText('第 8 行')).toBeNull()
  })

  test('短结果不额外套卡片', () => {
    const { container } = renderInConversation(
      <CollapsibleResult
        content="短结果"
        threshold={100}
        renderContent={(text) => <pre>{text}</pre>}
      />,
    )

    expect(container.querySelector('.not-prose')).toBeNull()
    expect(screen.getByText('短结果')).toBeInTheDocument()
  })
})
