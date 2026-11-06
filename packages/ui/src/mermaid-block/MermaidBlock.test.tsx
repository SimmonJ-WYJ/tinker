/**
 * MermaidBlock 渲染测试
 *
 * 覆盖两条路径：
 * 1. 源码优先（无需等待）：Mermaid 标签、源码文本、Copy 按钮、缩放按钮不渲染
 * 2. SVG 层（350ms 防抖后 async renderMermaid 成功）：SVG 注入、缩放按钮出现、缩放交互
 *
 * beautiful-mermaid 的 renderMermaid 被 mock 为立即 resolve 固定 SVG 串，
 * 350ms 防抖走真实 timer（waitFor 轮询等待），避免脆弱的真实图表引擎输出。
 */
import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// 先抓真实模块，afterAll 还原用（mock.module 进程级全局，须还原防泄漏到后续 test）
const realMermaid = await import('beautiful-mermaid')

// mock 必须在导入被测组件前
const renderMermaidMock = mock(() => Promise.resolve('<svg id="m"><g></g></svg>'))
mock.module('beautiful-mermaid', () => ({
  renderMermaid: renderMermaidMock,
  THEMES: { 'github-light': {}, 'github-dark': {} },
}))

const { MermaidBlock } = await import('./MermaidBlock.tsx')

// navigator.clipboard 是进程级全局，覆盖后须还原
const origClipboardDesc = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

afterEach(() => {
  cleanup()
  renderMermaidMock.mockClear()
  if (origClipboardDesc) {
    Object.defineProperty(navigator, 'clipboard', origClipboardDesc)
  } else {
    delete (navigator as { clipboard?: unknown }).clipboard
  }
})

afterAll(() => {
  // 还原真实 beautiful-mermaid，避免 stub 泄漏到同进程后续 test
  mock.module('beautiful-mermaid', () => ({ ...realMermaid }))
})

const CODE = 'graph TD; A-->B'

describe('MermaidBlock 源码优先路径', () => {
  it('渲染 Mermaid 标签与源码文本', () => {
    const { container } = render(<MermaidBlock code={CODE} />)
    expect(screen.getByText('Mermaid')).toBeTruthy()
    expect(container.querySelector('pre')?.textContent).toContain(CODE)
  })

  it('渲染 Copy 按钮', () => {
    render(<MermaidBlock code={CODE} copyLabel="Copy" />)
    expect(screen.getByText('Copy')).toBeTruthy()
  })

  it('SVG 未就绪时不渲染缩放按钮', () => {
    render(<MermaidBlock code={CODE} zoomInLabel="Zoom in" />)
    expect(screen.queryByTitle('Zoom in')).toBeNull()
  })

  it('复制按钮写剪贴板并切换 copied 态', async () => {
    const writeText = mock(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<MermaidBlock code={CODE} copyLabel="Copy" copiedLabel="Copied" />)
    fireEvent.click(screen.getByText('Copy'))

    expect(await screen.findByText('Copied')).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith(CODE)
  })
})

describe('MermaidBlock SVG 路径', () => {
  it('防抖后注入 SVG 并显示缩放按钮', async () => {
    const { container } = render(
      <MermaidBlock code={CODE} zoomInLabel="Zoom in" resetZoomLabel="Reset zoom" />
    )

    // 350ms 防抖 + async renderMermaid，轮询等待 SVG 注入
    await waitFor(
      () => {
        expect(container.querySelector('svg#m')).toBeTruthy()
      },
      { timeout: 2000 }
    )

    expect(renderMermaidMock).toHaveBeenCalled()
    // svgVisible 后缩放按钮出现
    expect(screen.getByTitle('Zoom in')).toBeTruthy()
  })

  it('缩放交互更新百分比', async () => {
    render(
      <MermaidBlock
        code={CODE}
        zoomInLabel="Zoom in"
        zoomOutLabel="Zoom out"
        resetZoomLabel="Reset zoom"
      />
    )

    await waitFor(() => expect(screen.getByTitle('Zoom in')).toBeTruthy(), { timeout: 2000 })

    // 初始 100%
    expect(screen.getByText('100%')).toBeTruthy()
    // Zoom in +0.15 → 115%
    fireEvent.click(screen.getByTitle('Zoom in'))
    expect(screen.getByText('115%')).toBeTruthy()
    // Zoom out ×2 → 85%
    fireEvent.click(screen.getByTitle('Zoom out'))
    fireEvent.click(screen.getByTitle('Zoom out'))
    expect(screen.getByText('85%')).toBeTruthy()
    // Reset → 100%
    fireEvent.click(screen.getByTitle('Reset zoom'))
    expect(screen.getByText('100%')).toBeTruthy()
  })
})
