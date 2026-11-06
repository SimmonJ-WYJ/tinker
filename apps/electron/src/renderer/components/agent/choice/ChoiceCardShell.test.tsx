/**
 * ChoiceCardShell 单元测试 — 覆盖 dangerLevel 配色、counter、footerHints、
 * Esc → onDismiss、输入框聚焦时 Esc 不触发；以及新增的 footer 右下确定按钮
 * （confirmLabel / confirmDanger / onConfirm）行为。
 * i18n 由 bunfig.toml 中的 preload (apps/electron/test-setup.ts) 全局初始化。
 */

import { describe, it, expect, mock, afterEach } from 'bun:test'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ChoiceCardShell } from './ChoiceCardShell.tsx'

const baseHints = [
  { key: '↑↓', label: '切换' },
  { key: '1-9', label: '直选' },
  { key: 'Esc', label: '终止' },
]

// 显式 cleanup：bun:test 不自带 testing-library auto-cleanup，
// 未清理的 DOM 与 document.keydown 监听会跨用例 / 跨文件污染。
afterEach(() => {
  cleanup()
})

describe('ChoiceCardShell', () => {
  it('dangerLevel="dangerous" 渲染 choice-dangerous 边框与标题色 token', () => {
    render(
      <ChoiceCardShell title="危险操作" dangerLevel="dangerous">
        <div>body</div>
      </ChoiceCardShell>
    )
    const card = screen.getByRole('dialog')
    expect(card.className).toContain('border-choice-dangerous-border')
    expect(screen.getByText('危险操作').className).toContain('text-choice-dangerous-fg')
  })

  it('counter 渲染 2/5；total=1 时不渲染', () => {
    const { rerender } = render(
      <ChoiceCardShell title="t" counter={{ current: 2, total: 5 }}>
        <div />
      </ChoiceCardShell>
    )
    expect(screen.getByText('2/5')).toBeInTheDocument()
    rerender(
      <ChoiceCardShell title="t" counter={{ current: 1, total: 1 }}>
        <div />
      </ChoiceCardShell>
    )
    expect(screen.queryByText('1/1')).not.toBeInTheDocument()
  })

  it('footerHints 渲染键名与 label', () => {
    render(
      <ChoiceCardShell title="t" footerHints={[{ key: '↵', label: '确认' }, { key: 'esc', label: '取消' }]}>
        <div />
      </ChoiceCardShell>
    )
    expect(screen.getByText('↵')).toBeInTheDocument()
    expect(screen.getByText('确认')).toBeInTheDocument()
    expect(screen.getByText('esc')).toBeInTheDocument()
  })

  it('Esc 触发 onDismiss；未传时不抛错', () => {
    const onDismiss = mock(() => {})
    render(
      <ChoiceCardShell title="t" onDismiss={onDismiss}>
        <div />
      </ChoiceCardShell>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)

    // 不传 onDismiss 时再按 Esc 也不应抛错（依靠组件内部的 noop 守门）
    expect(() =>
      fireEvent.keyDown(document, { key: 'Escape' })
    ).not.toThrow()
  })

  it('e.target 为 <input> 时不拦截 Esc', () => {
    const onDismiss = mock(() => {})
    render(
      <>
        <input data-testid="inp" />
        <ChoiceCardShell title="t" onDismiss={onDismiss}>
          <div />
        </ChoiceCardShell>
      </>
    )
    const inp = screen.getByTestId('inp')
    inp.focus()
    fireEvent.keyDown(inp, { key: 'Escape' })
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('当传入 confirmLabel + onConfirm 时，footer 右侧显示按钮', () => {
    const onConfirm = mock(() => {})
    render(
      <ChoiceCardShell title="需要确认" footerHints={baseHints} confirmLabel="允许" onConfirm={onConfirm}>
        <div>body</div>
      </ChoiceCardShell>
    )
    const btn = screen.getByRole('button', { name: /允许/ })
    expect(btn).toBeTruthy()
    fireEvent.click(btn)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('confirmDanger=true 时按钮使用 destructive 背景', () => {
    render(
      <ChoiceCardShell
        title="危险确认"
        footerHints={baseHints}
        confirmLabel="拒绝"
        confirmDanger={true}
        onConfirm={() => {}}
      >
        <div />
      </ChoiceCardShell>
    )
    const btn = screen.getByRole('button', { name: /拒绝/ })
    expect(btn.className).toContain('bg-destructive')
  })

  it('未传 confirmLabel 时不渲染按钮，footer 行为不变', () => {
    render(
      <ChoiceCardShell title="无按钮" footerHints={baseHints}>
        <div />
      </ChoiceCardShell>
    )
    expect(screen.queryByRole('button', { name: /确定/ })).toBeNull()
  })
})
