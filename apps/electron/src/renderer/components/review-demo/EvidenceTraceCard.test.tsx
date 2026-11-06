/**
 * EvidenceTraceCard 单测
 *
 * 覆盖：
 *   - 渲染 paper 元数据 / quote 文本
 *   - 主按钮 click 触发 onOpenInLibrary
 *   - 关闭按钮 click 触发 onClose
 *   - openInLibraryDisabledReason 提供时主按钮 disabled
 *   - onAddNote 缺省时 add-note 按钮 disabled
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { EvidenceTraceCard } from './EvidenceTraceCard.tsx'

afterEach(() => {
  cleanup()
})

const basePaper = {
  label: 'Izacard et al. 2022',
  title: 'Atlas: Few-shot learning with retrieval augmented language models',
  meta: 'arXiv:2208.03299',
  location: '第 4 节第 1 段',
}
const baseQuote =
  'Atlas matches parameter-only models on open-ended generation tasks…'

describe('EvidenceTraceCard', () => {
  test('渲染 paper label / meta / location / quote', () => {
    render(
      <EvidenceTraceCard
        paper={basePaper}
        quote={baseQuote}
        onOpenInLibrary={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('Izacard et al. 2022')).toBeTruthy()
    expect(screen.getByText(/arXiv:2208\.03299/)).toBeTruthy()
    expect(screen.getByText(/第 4 节第 1 段/)).toBeTruthy()
    expect(screen.getByText(/Atlas matches parameter-only/)).toBeTruthy()
  })

  test('主按钮 click → onOpenInLibrary', () => {
    let called = 0
    render(
      <EvidenceTraceCard
        paper={basePaper}
        quote={baseQuote}
        onOpenInLibrary={() => {
          called++
        }}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Open full context/i }))
    expect(called).toBe(1)
  })

  test('关闭按钮 click → onClose', () => {
    let closed = 0
    render(
      <EvidenceTraceCard
        paper={basePaper}
        quote={baseQuote}
        onOpenInLibrary={() => {}}
        onClose={() => {
          closed++
        }}
      />,
    )
    fireEvent.click(screen.getByLabelText('Close evidence trace'))
    expect(closed).toBe(1)
  })

  test('openInLibraryDisabledReason → 主按钮 disabled + title 提示', () => {
    render(
      <EvidenceTraceCard
        paper={basePaper}
        quote={baseQuote}
        onOpenInLibrary={() => {}}
        onClose={() => {}}
        openInLibraryDisabledReason="未关联 Zotero"
      />,
    )
    const btn = screen.getByRole('button', { name: /Open full context/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(btn.getAttribute('title')).toBe('未关联 Zotero')
  })

  test('sourceRemoved=true → 显示"源已移除"禁用按钮，无"Open full context"按钮（issue #462 方式 A）', () => {
    let called = 0
    render(
      <EvidenceTraceCard
        paper={basePaper}
        quote={baseQuote}
        onOpenInLibrary={() => {
          called++
        }}
        onClose={() => {}}
        sourceRemoved
      />,
    )
    // 跳转按钮被替换为"源已移除"禁用态
    expect(screen.queryByRole('button', { name: /Open full context/i })).toBeNull()
    const removedBtn = screen.getByRole('button', { name: /Source removed/i })
    expect((removedBtn as HTMLButtonElement).disabled).toBe(true)
    // 即便回调存在也无从触发（按钮 disabled）
    fireEvent.click(removedBtn)
    expect(called).toBe(0)
  })

  test('onAddNote 缺省时 add-note 按钮 disabled', () => {
    render(
      <EvidenceTraceCard
        paper={basePaper}
        quote={baseQuote}
        onOpenInLibrary={() => {}}
        onClose={() => {}}
      />,
    )
    const btn = screen.getByRole('button', { name: /Add note here/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })
})
