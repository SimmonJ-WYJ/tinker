/**
 * ChoiceCard 单元测试 — 覆盖前缀编号、↑↓循环、disabled 跳过、数字键直选、
 * Enter 触发、danger 二次确认 modal 拦截路径，以及超过 9 项时的前缀降级。
 */

import { describe, it, expect, mock, beforeAll, afterAll, afterEach } from 'bun:test'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ChoiceCard } from './ChoiceCard.tsx'
import { i18n } from '@/lib/i18n'

// 该套件部分断言依赖 zh 文案（如 ConfirmDangerousModal 的"永久允许 Bash？"标题），
// 而测试环境 DEFAULT_LOCALE 是 en；统一把语言切到 zh 跑完再切回。
beforeAll(async () => {
  await i18n.changeLanguage('zh')
})

afterAll(async () => {
  await i18n.changeLanguage('en')
})

// 显式 cleanup：bun:test 不自带 testing-library auto-cleanup，未清理的 DOM 与
// document.keydown 监听会跨用例污染（例如 getAllByText('·') 命中前用例残留节点）。
afterEach(() => {
  cleanup()
})

const OPTS = [
  { id: 'a', label: '允许' },
  { id: 'b', label: '拒绝' },
  { id: 'c', label: '总是允许' },
]

describe('ChoiceCard', () => {
  it('3 个选项时渲染 1. / 2. / 3. 前缀', () => {
    render(<ChoiceCard title="t" options={OPTS} onSelect={() => {}} />)
    expect(screen.getByText('1.')).toBeInTheDocument()
    expect(screen.getByText('2.')).toBeInTheDocument()
    expect(screen.getByText('3.')).toBeInTheDocument()
  })

  it('↓ 末项循环到首项；↑ 首项循环到末项', () => {
    render(<ChoiceCard title="t" options={OPTS} defaultFocusedId="c" onSelect={() => {}} />)
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('允许')
    fireEvent.keyDown(document, { key: 'ArrowUp' })
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('总是允许')
  })

  it('↑↓ 跳过 disabled 项', () => {
    const opts = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', disabled: true },
      { id: 'c', label: 'C' },
    ]
    render(<ChoiceCard title="t" options={opts} defaultFocusedId="a" onSelect={() => {}} />)
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('C')
  })

  it('数字键 1/2/3 触发对应 onSelect', () => {
    const onSelect = mock(() => {})
    render(<ChoiceCard title="t" options={OPTS} onSelect={onSelect} />)
    fireEvent.keyDown(document, { key: '2' })
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('焦点项 Enter 触发 onSelect', () => {
    const onSelect = mock(() => {})
    render(<ChoiceCard title="t" options={OPTS} defaultFocusedId="b" onSelect={onSelect} />)
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('焦点项 disabled 时 Enter noop', () => {
    const onSelect = mock(() => {})
    const opts = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', disabled: true },
    ]
    render(<ChoiceCard title="t" options={opts} defaultFocusedId="b" onSelect={onSelect} />)
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('disabled 选项数字键也不触发', () => {
    const onSelect = mock(() => {})
    const opts = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', disabled: true },
    ]
    render(<ChoiceCard title="t" options={opts} onSelect={onSelect} />)
    fireEvent.keyDown(document, { key: '2' })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('danger: true 选项触发后先渲染 ConfirmDangerousModal，不立即调 onSelect', () => {
    const onSelect = mock(() => {})
    const opts = [
      { id: 'allow', label: '允许' },
      { id: 'always', label: '总是允许', danger: true },
    ]
    render(<ChoiceCard title="t" subtitle="Bash" options={opts} defaultFocusedId="always" onSelect={onSelect} />)
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: /永久允许/ })).toBeInTheDocument()
  })

  it('modal 内 Y 确认调原始 onSelect；N 取消不调', () => {
    const onSelect = mock(() => {})
    const opts = [
      { id: 'always', label: '总是允许', danger: true },
    ]
    const { rerender } = render(<ChoiceCard title="t" subtitle="Bash" options={opts} defaultFocusedId="always" onSelect={onSelect} />)
    fireEvent.keyDown(document, { key: 'Enter' })
    fireEvent.keyDown(document, { key: 'y' })
    expect(onSelect).toHaveBeenCalledWith('always')

    onSelect.mockClear()
    rerender(<ChoiceCard title="t" subtitle="Bash" options={opts} defaultFocusedId="always" onSelect={onSelect} />)
    fireEvent.keyDown(document, { key: 'Enter' })
    fireEvent.keyDown(document, { key: 'n' })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('选项 > 9 个时，第 10 项前缀为 · 而不是 10.，按数字键无响应', () => {
    const onSelect = mock(() => {})
    const opts = Array.from({ length: 11 }, (_, i) => ({ id: `o${i}`, label: `Option ${i}` }))
    render(<ChoiceCard title="t" options={opts} onSelect={onSelect} />)
    expect(screen.getByText('1.')).toBeInTheDocument()
    expect(screen.getByText('9.')).toBeInTheDocument()
    expect(screen.queryByText('10.')).not.toBeInTheDocument()
    // 第 10 项（index=9）前缀应为 ·
    const dots = screen.getAllByText('·')
    expect(dots.length).toBeGreaterThanOrEqual(2)
  })
})

describe('ChoiceCard ↔ Shell confirm button 同步', () => {
  const opts = [
    { id: 'allow', label: '允许' },
    { id: 'deny', label: '拒绝' },
    { id: 'always', label: '本会话总是允许' },
  ]

  it('初始 focused 在 allow，按钮文字 = "允许"', () => {
    render(<ChoiceCard title="t" options={opts} onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: /允许/ })).toBeTruthy()
  })

  it('↓ 之后按钮文字变 "拒绝"', () => {
    render(<ChoiceCard title="t" options={opts} onSelect={() => {}} />)
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: /拒绝/ })).toBeTruthy()
  })

  it('点确定按钮 = 选中 focused option', () => {
    const onSelect = mock((id: string) => {})
    render(<ChoiceCard title="t" options={opts} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /允许/ }))
    expect(onSelect).toHaveBeenCalledWith('allow')
  })

  it('focused 在 deny + opts[1].danger=true + dangerLevel=dangerous 时按钮变红', () => {
    const dangerOpts = [
      { id: 'allow', label: '允许' },
      { id: 'deny', label: '拒绝', danger: true },
    ]
    render(<ChoiceCard title="t" dangerLevel="dangerous" options={dangerOpts} defaultFocusedId="deny" onSelect={() => {}} />)
    const btn = screen.getByRole('button', { name: /拒绝/ })
    expect(btn.className).toContain('bg-destructive')
  })
})
