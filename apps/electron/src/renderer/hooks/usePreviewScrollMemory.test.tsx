/**
 * usePreviewScrollMemory 单元测试（issue #551 / PR #558 review 两个回归场景）
 *
 * happy-dom 无真实排版，scrollHeight / clientHeight 用 defineProperty 模拟，
 * scroll 事件手动 dispatch。rAF 由 happy-dom 提供，用 frame() 逐帧推进。
 */

import { describe, it, expect, afterEach } from 'bun:test'
import { render, cleanup } from '@testing-library/react'
import * as React from 'react'
import { usePreviewScrollMemory } from './usePreviewScrollMemory.ts'

afterEach(() => {
  cleanup()
})

function Harness({ cacheKey, ready = true }: { cacheKey: string; ready?: boolean }) {
  const ref = React.useRef<HTMLDivElement | null>(null)
  usePreviewScrollMemory(ref, cacheKey, ready)
  return <div data-testid="scroller" ref={ref} />
}

/** 等一个 rAF tick（hook 的保存节流与恢复轮询都按帧推进） */
function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function frames(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await frame()
}

/** 模拟容器排版结果：happy-dom 下两者默认恒 0，必须显式注入 */
function setMetrics(el: HTMLElement, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
}

function getScroller(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-testid="scroller"]')
  if (!(el instanceof HTMLElement)) throw new Error('scroller 未渲染')
  return el
}

function scrollTo(el: HTMLElement, top: number): void {
  el.scrollTop = top
  el.dispatchEvent(new Event('scroll'))
}

describe('usePreviewScrollMemory', () => {
  it('滚动保存 → 重挂载后恢复到原位置', async () => {
    const r1 = render(<Harness cacheKey="k-roundtrip" />)
    const el1 = getScroller(r1.container)
    setMetrics(el1, 1000, 200)
    scrollTo(el1, 300)
    await frame() // saveRaf 落盘
    r1.unmount()

    const r2 = render(<Harness cacheKey="k-roundtrip" />)
    const el2 = getScroller(r2.container)
    setMetrics(el2, 1000, 200)
    await frames(2) // 恢复轮询：首帧即满足 maxScroll ≥ saved
    expect(el2.scrollTop).toBe(300)
    r2.unmount()
  })

  it('容器迟迟未撑开 → 超时放弃不落位，缓存原值保留（review Minor 1）', async () => {
    // 种入缓存：滚到 300 后卸载（cleanup flush 写入）
    const r1 = render(<Harness cacheKey="k-timeout" />)
    const el1 = getScroller(r1.container)
    setMetrics(el1, 1000, 200)
    scrollTo(el1, 300)
    await frame()
    r1.unmount()

    // 容器始终撑不开（maxScroll < saved）→ 轮询 60 帧后放弃，不写 scrollTop
    const r2 = render(<Harness cacheKey="k-timeout" />)
    const el2 = getScroller(r2.container)
    setMetrics(el2, 100, 200)
    await frames(65)
    expect(el2.scrollTop).toBe(0)
    r2.unmount() // 用户没滚动过 → 不 flush，缓存仍是 300

    // 容器正常撑开 → 仍能恢复到 300，证明缓存没被超时分支/卸载 flush 冲掉
    const r3 = render(<Harness cacheKey="k-timeout" />)
    const el3 = getScroller(r3.container)
    setMetrics(el3, 1000, 200)
    await frames(2)
    expect(el3.scrollTop).toBe(300)
    r3.unmount()
  })

  it('滚动后立刻卸载（saveRaf 未执行）→ cleanup flush 不丢最后增量（review Minor 2）', async () => {
    const r1 = render(<Harness cacheKey="k-flush" />)
    const el1 = getScroller(r1.container)
    setMetrics(el1, 1000, 200)
    scrollTo(el1, 300)
    await frame()
    // 最后一次滚动后不等 rAF 直接卸载——对应「滚动后立刻点 DOI 角标」golden path
    scrollTo(el1, 350)
    r1.unmount()

    const r2 = render(<Harness cacheKey="k-flush" />)
    const el2 = getScroller(r2.container)
    setMetrics(el2, 1000, 200)
    await frames(2)
    expect(el2.scrollTop).toBe(350)
    r2.unmount()
  })

  it('ready=false 时不挂监听、不恢复', async () => {
    const r1 = render(<Harness cacheKey="k-notready" ready={false} />)
    const el1 = getScroller(r1.container)
    setMetrics(el1, 1000, 200)
    scrollTo(el1, 300)
    await frame()
    r1.unmount()

    const r2 = render(<Harness cacheKey="k-notready" />)
    const el2 = getScroller(r2.container)
    setMetrics(el2, 1000, 200)
    await frames(2)
    expect(el2.scrollTop).toBe(0) // 未保存过 → 不恢复
    r2.unmount()
  })
})
