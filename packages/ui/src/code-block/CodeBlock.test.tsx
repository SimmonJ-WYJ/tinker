/**
 * CodeBlock 渲染测试
 *
 * 覆盖：代码文本提取渲染、语言标签显示、复制按钮行为、尾部换行 trim、
 * 高亮真正生效（区别于 split 兜底路径）。
 * shiki 高亮器懒加载 → beforeAll 预热，确保 highlightToTokens 同步路径生效。
 */
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { highlightCode } from '@asci/core'
import { CodeBlock } from './CodeBlock.tsx'

// react-markdown 传入的 <pre> children 形态：<code className="language-xxx">code</code>
function codeChildren(code: string, lang?: string): React.ReactElement {
  return React.createElement('code', { className: lang ? `language-${lang}` : undefined }, code)
}

beforeAll(async () => {
  // 预热 shiki 高亮器单例，使后续 highlightToTokens 同步返回非 null
  await highlightCode({ code: 'const x = 1', language: 'ts' })
})

// navigator.clipboard 是进程级全局，覆盖后须在 afterEach 还原，防泄漏到后续 test
const origClipboardDesc = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

afterEach(() => {
  cleanup()
  if (origClipboardDesc) {
    Object.defineProperty(navigator, 'clipboard', origClipboardDesc)
  } else {
    delete (navigator as { clipboard?: unknown }).clipboard
  }
})

describe('CodeBlock', () => {
  it('渲染代码文本内容', () => {
    const { container } = render(<CodeBlock>{codeChildren('const x = 1', 'ts')}</CodeBlock>)
    // 高亮后文本被拆到多个 span，用 textContent 聚合断言
    const pre = container.querySelector('pre')
    expect(pre?.textContent).toContain('const x = 1')
  })

  it('多行代码按 \\n 拆行渲染 line span', () => {
    const { container } = render(<CodeBlock>{codeChildren('a\nb\nc', 'ts')}</CodeBlock>)
    const pre = container.querySelector('pre')
    expect(pre?.textContent).toContain('a')
    expect(pre?.textContent).toContain('b')
    expect(pre?.textContent).toContain('c')
    // 逐行渲染产生 line span（来自 split('\n')，与高亮无关，仅验证分行结构）
    expect(container.querySelectorAll('span.line').length).toBe(3)
  })

  it('shiki 高亮真正生效：token span 带 inline color（非 split 兜底）', () => {
    // 预热后 highlightToTokens 返回带颜色的 token；CodeBlock 把 token.color
    // 渲染成内联 style。兜底路径（token 缺失）只输出无 color 的裸文本 span，
    // 故此断言只有高亮真跑才通过——守护 shiki 集成本身。
    const { container } = render(
      <CodeBlock>{codeChildren('const foo = 42', 'ts')}</CodeBlock>
    )
    const colored = container.querySelectorAll('span.line span[style*="color"]')
    expect(colored.length).toBeGreaterThan(0)
  })

  it('已知语言显示规范化标签', () => {
    render(<CodeBlock>{codeChildren('x', 'ts')}</CodeBlock>)
    expect(screen.getByText('TypeScript')).toBeTruthy()
  })

  it('无 className 时标签回退到 Code', () => {
    render(<CodeBlock>{codeChildren('plain text')}</CodeBlock>)
    expect(screen.getByText('Code')).toBeTruthy()
  })

  it('未知语言首字母大写', () => {
    render(<CodeBlock>{codeChildren('x', 'brainfuck')}</CodeBlock>)
    expect(screen.getByText('Brainfuck')).toBeTruthy()
  })

  it('尾部换行被 trim（不产生额外空行）', () => {
    const { container } = render(<CodeBlock>{codeChildren('one\n', 'ts')}</CodeBlock>)
    // 'one\n' trim 末尾换行后只剩 1 行
    expect(container.querySelectorAll('span.line').length).toBe(1)
  })

  it('嵌套 children 递归提取文本', () => {
    const nested = React.createElement(
      'code',
      { className: 'language-ts' },
      ['const ', React.createElement('span', {}, 'y'), ' = 2']
    )
    const { container } = render(<CodeBlock>{nested}</CodeBlock>)
    expect(container.querySelector('pre')?.textContent).toContain('const y = 2')
  })

  it('复制按钮写剪贴板并切换 copied 态', async () => {
    const writeText = mock(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    render(
      <CodeBlock copyLabel="Copy" copiedLabel="Copied">
        {codeChildren('const x = 1\n', 'ts')}
      </CodeBlock>
    )

    expect(screen.getByText('Copy')).toBeTruthy()
    fireEvent.click(screen.getByText('Copy'))

    // findBy 轮询等待 async writeText + setCopied 刷新到 DOM
    expect(await screen.findByText('Copied')).toBeTruthy()
    // 写入的是 trim 尾换行后的代码
    expect(writeText).toHaveBeenCalledWith('const x = 1')
  })
})
