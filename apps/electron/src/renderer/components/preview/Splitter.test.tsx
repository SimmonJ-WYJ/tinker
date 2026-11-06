/**
 * Splitter 单元测试 — 覆盖拖拽生命周期、#592 两个回归与 #600 纯点击回归：
 * 1. drag-end 任何路径（pointerup / pointercancel / lostpointercapture /
 *    window blur / release 抛错）都必须还原 body cursor/userSelect；
 * 2. 拖拽结束后再 move 不得继续触发 onDrag（面板不得跟随裸鼠标收窄）。
 *
 * happy-dom 注意：releasePointerCapture 后不会自动派发 lostpointercapture，
 * 相关路径在用例里手动 fire；RAF 异步，断言 onDrag 前需等一帧。
 */

import { describe, it, expect, mock, afterEach, beforeEach } from 'bun:test'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { Splitter } from './Splitter.tsx'

// happy-dom 个别版本缺 pointer capture API，补 no-op 兜底（不影响真实浏览器行为）
if (typeof HTMLElement.prototype.setPointerCapture !== 'function') {
  HTMLElement.prototype.setPointerCapture = () => {}
}
if (typeof HTMLElement.prototype.releasePointerCapture !== 'function') {
  HTMLElement.prototype.releasePointerCapture = () => {}
}
if (typeof HTMLElement.prototype.hasPointerCapture !== 'function') {
  HTMLElement.prototype.hasPointerCapture = () => false
}

/** 等一帧 RAF，让 scheduleDrag 的批量更新 flush */
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })

interface Handlers {
  onDrag: ReturnType<typeof mock>
  onDragStart: ReturnType<typeof mock>
  onDragEnd: ReturnType<typeof mock>
}

function renderSplitter(orientation: 'vertical' | 'horizontal' = 'vertical'): { separator: HTMLElement } & Handlers {
  const onDrag = mock(() => {})
  const onDragStart = mock(() => {})
  const onDragEnd = mock(() => {})
  const { getByRole } = render(
    <Splitter orientation={orientation} onDrag={onDrag} onDragStart={onDragStart} onDragEnd={onDragEnd} />
  )
  return { separator: getByRole('separator'), onDrag, onDragStart, onDragEnd }
}

beforeEach(() => {
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})

// 显式 cleanup：bun:test 不自带 testing-library auto-cleanup
afterEach(() => {
  cleanup()
})

describe('Splitter 拖拽生命周期', () => {
  it('正常流程：down 设置 body 样式，move 触发 onDrag，up 触发 onDragEnd 并还原样式', async () => {
    const { separator, onDrag, onDragStart, onDragEnd } = renderSplitter()

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    expect(onDragStart).toHaveBeenCalledTimes(1)
    expect(document.body.style.cursor).toBe('ew-resize')
    expect(document.body.style.userSelect).toBe('none')

    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 150 })
    await nextFrame()
    expect(onDrag).toHaveBeenCalledWith(150)

    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 160 })
    expect(onDragEnd).toHaveBeenCalledTimes(1)
    expect(onDragEnd).toHaveBeenCalledWith(160)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })

  it('纯点击（down+up 未移动）：onDrag 不被调，onDragEnd 收到 null（#600 回归）', async () => {
    const { separator, onDrag, onDragEnd } = renderSplitter()

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 100 })
    await nextFrame()

    expect(onDrag).not.toHaveBeenCalled()
    expect(onDragEnd).toHaveBeenCalledTimes(1)
    expect(onDragEnd).toHaveBeenCalledWith(null)
    expect(document.body.style.cursor).toBe('')
  })

  it('阈值内抖动（≤2px，含恰好 2px 边界）按纯点击处理：onDrag 不被调，onDragEnd 收到 null', async () => {
    const { separator, onDrag, onDragEnd } = renderSplitter()

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 102 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 99 })
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 102 })
    await nextFrame()

    expect(onDrag).not.toHaveBeenCalled()
    expect(onDragEnd).toHaveBeenCalledTimes(1)
    expect(onDragEnd).toHaveBeenCalledWith(null)
  })

  it('幂等：up 之后再派发 lostpointercapture 与二次 up，onDragEnd 只调一次', () => {
    const { separator, onDragEnd } = renderSplitter()

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 120 })
    fireEvent.lostPointerCapture(separator, { pointerId: 1 })
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 130 })

    expect(onDragEnd).toHaveBeenCalledTimes(1)
  })

  it('mid-drag lostpointercapture（无 up）：还原样式并以最后坐标结束', async () => {
    const { separator, onDragEnd } = renderSplitter()

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 140 })
    await nextFrame()

    fireEvent.lostPointerCapture(separator, { pointerId: 1 })
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(onDragEnd).toHaveBeenCalledTimes(1)
    expect(onDragEnd).toHaveBeenCalledWith(140)
  })

  it('mid-drag window blur：还原样式并结束拖拽', async () => {
    const { separator, onDragEnd } = renderSplitter()

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 130 })
    await nextFrame()

    fireEvent(window, new Event('blur'))
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(onDragEnd).toHaveBeenCalledTimes(1)
    expect(onDragEnd).toHaveBeenCalledWith(130)
  })

  it('Bug 2 回归：拖拽结束后再 move 不再触发 onDrag', async () => {
    const { separator, onDrag } = renderSplitter()

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 120 })
    const callsAfterEnd = onDrag.mock.calls.length

    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 300 })
    await nextFrame()
    expect(onDrag.mock.calls.length).toBe(callsAfterEnd)
  })

  it('Bug 1 回归：releasePointerCapture 抛错时 body 样式仍被还原、onDragEnd 仍被调', () => {
    const { separator, onDragEnd } = renderSplitter()
    // 强制走 release 分支并令其抛错，模拟 capture 已失效的真实场景
    separator.hasPointerCapture = () => true
    separator.releasePointerCapture = () => {
      throw new DOMException('no capture', 'NotFoundError')
    }

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    expect(document.body.style.cursor).toBe('ew-resize')

    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 110 })
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(onDragEnd).toHaveBeenCalledTimes(1)
  })

  it('pointercancel 走同一结束路径', () => {
    const { separator, onDragEnd } = renderSplitter()

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    fireEvent.pointerCancel(separator, { pointerId: 1, clientX: 105 })

    expect(document.body.style.cursor).toBe('')
    expect(onDragEnd).toHaveBeenCalledTimes(1)
  })

  it('horizontal 方向：用 clientY 与 ns-resize', async () => {
    const { separator, onDrag, onDragEnd } = renderSplitter('horizontal')

    fireEvent.pointerDown(separator, { pointerId: 1, clientY: 200 })
    expect(document.body.style.cursor).toBe('ns-resize')

    fireEvent.pointerMove(separator, { pointerId: 1, clientY: 240 })
    await nextFrame()
    expect(onDrag).toHaveBeenCalledWith(240)

    fireEvent.pointerUp(separator, { pointerId: 1, clientY: 250 })
    expect(onDragEnd).toHaveBeenCalledWith(250)
    expect(document.body.style.cursor).toBe('')
  })
})
