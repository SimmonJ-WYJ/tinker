/**
 * useSmoothStream 测试
 *
 * rAF 驱动的逐字渲染 hook。用受控的 requestAnimationFrame 替身确定性推进：
 * flushRAF(n) 手动跑 n 帧，每帧 currentTime 递增足够大以越过 minDelay。
 *
 * 覆盖：非流式一次性同步、流式逐帧增量（观测中间帧）、append 追加、reset 重置、
 * 多字节字符（中文/emoji）任何中间帧不裂字。
 *
 * 关键：流式路径断言全程保持 isStreaming: true —— 翻成 false 会触发一次性安全网
 * 兜底（useSmoothStream.ts:109-124），掩盖 rAF 渲染循环 / Intl.Segmenter 是否真在工作。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useSmoothStream } from './useSmoothStream.ts'

// ==== 受控 rAF 替身 ====
let rafCallbacks: Array<(t: number) => void> = []
let rafTime = 0
let nextRafId = 1

const origRaf = globalThis.requestAnimationFrame
const origCancel = globalThis.cancelAnimationFrame

beforeEach(() => {
  rafCallbacks = []
  rafTime = 0
  nextRafId = 1
  globalThis.requestAnimationFrame = ((cb: (t: number) => void): number => {
    rafCallbacks.push(cb)
    return nextRafId++
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = (() => {
    // 受控替身：cancel 后不再有新帧被 flush 推进即可，无需精确移除
  }) as typeof cancelAnimationFrame
})

afterEach(() => {
  cleanup()
  globalThis.requestAnimationFrame = origRaf
  globalThis.cancelAnimationFrame = origCancel
})

/** 手动跑 n 帧，每帧时间大幅前进以越过 minDelay 门槛 */
function flushRAF(frames: number): void {
  for (let i = 0; i < frames; i++) {
    const batch = rafCallbacks
    rafCallbacks = []
    rafTime += 1000
    act(() => {
      for (const cb of batch) cb(rafTime)
    })
  }
}

/** 流式 hook 渲染工厂：统一 minDelay: 0，避免各用例复制 renderHook 样板 */
function renderStream(initialProps: { content: string; isStreaming: boolean }) {
  return renderHook(
    ({ content, isStreaming }) => useSmoothStream({ content, isStreaming, minDelay: 0 }),
    { initialProps }
  )
}

describe('useSmoothStream', () => {
  it('非流式时初始内容即时呈现', () => {
    const { result } = renderHook(() =>
      useSmoothStream({ content: 'hello', isStreaming: false })
    )
    expect(result.current.displayedContent).toBe('hello')
  })

  it('流式内容逐帧增量推进（观测中间帧，非仅末态）', () => {
    const { result, rerender } = renderStream({ content: '', isStreaming: true })

    // 保持 isStreaming: true —— 只有走 rAF 渲染循环才会逐帧增长，
    // 若翻成 false 会触发一次性安全网兜底，掩盖循环是否真的工作
    act(() => rerender({ content: 'abcdefgh', isStreaming: true }))

    // 逐帧推进，记录中间态：必须出现严格 0 < len < 8 的部分帧，
    // 证明是"增量流式"而非"结束前啥都不渲染 + 末态兜底"
    const lengths: number[] = []
    let prevLen = 0
    for (let i = 0; i < 20; i++) {
      flushRAF(1)
      const len = result.current.displayedContent.length
      expect(len).toBeGreaterThanOrEqual(prevLen) // 单调不减
      lengths.push(len)
      prevLen = len
      // displayed 必须始终是目标的前缀（rAF 按序取字符）
      expect('abcdefgh'.startsWith(result.current.displayedContent)).toBe(true)
    }

    // 关键强断言：存在至少一个 0 < len < 8 的中间帧
    expect(lengths.some((l) => l > 0 && l < 8)).toBe(true)
    // 流式循环最终排空至完整
    expect(result.current.displayedContent).toBe('abcdefgh')
  })

  it('append 增量追加（流式中逐帧消费 delta）', () => {
    const { result, rerender } = renderStream({ content: 'foo', isStreaming: true })
    // 初始 'foo' 同步呈现（useState 初值），append 'bar' 走队列逐帧消费
    act(() => rerender({ content: 'foobar', isStreaming: true }))

    let sawPartial = false
    for (let i = 0; i < 20; i++) {
      flushRAF(1)
      const shown = result.current.displayedContent
      // 始终是 'foobar' 的前缀（append 分支只在尾部加字符）
      expect('foobar'.startsWith(shown)).toBe(true)
      if (shown.length > 3 && shown.length < 6) sawPartial = true
    }
    // 观测到 delta 被逐帧消费的中间态（>3 说明 'bar' 部分进入）
    expect(sawPartial).toBe(true)
    expect(result.current.displayedContent).toBe('foobar')
  })

  it('内容重置（非前缀）在流式中立即从头替换', () => {
    const { result, rerender } = renderStream({ content: 'hello world', isStreaming: true })
    // 先推进出部分显示态
    flushRAF(1)
    const partial = result.current.displayedContent
    expect(partial.length).toBeGreaterThan(0)
    expect('hello world'.startsWith(partial)).toBe(true)

    // 非前缀内容 + 仍在流式 —— 走 reset 分支（useSmoothStream.ts:98-103）而非末态安全网，
    // 立即整体替换、清空队列
    act(() => rerender({ content: 'totally different', isStreaming: true }))
    expect(result.current.displayedContent).toBe('totally different')
  })

  it('多字节字符不裂字：任何中间帧都不出现半个代理对', () => {
    const text = '你好🎉世界' // 🎉 = 代理对（两个 UTF-16 码元）
    const { result, rerender } = renderStream({ content: '', isStreaming: true })
    act(() => rerender({ content: text, isStreaming: true }))

    // 逐帧推进，检查每一个中间态：末尾不得是孤立高位代理（0xD800-0xDBFF）
    for (let i = 0; i < 30; i++) {
      flushRAF(1)
      const shown = result.current.displayedContent
      if (shown.length > 0) {
        const lastCode = shown.charCodeAt(shown.length - 1)
        expect(lastCode >= 0xd800 && lastCode <= 0xdbff).toBe(false)
      }
      expect(text.startsWith(shown)).toBe(true)
    }
    // 完整呈现，且全程 grapheme 完整 → 证明 Intl.Segmenter 按字符入队
    expect(result.current.displayedContent).toBe(text)
  })
})
