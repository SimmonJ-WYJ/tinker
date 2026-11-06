import { test, expect, describe } from 'bun:test'
import { createStore } from 'jotai'
import {
  sidePanelRatioAtom,
  currentPreviewAtom,
  effectiveRatioAtom,
} from './side-panel-layout'
import { currentAgentSessionIdAtom } from './agent-atoms'
import { rightPanelMaximizedAtom, rightPanelTabsBySessionAtom } from './right-panel-tabs'

describe('effectiveRatioAtom', () => {
  test('无预览时也返回 sidePanelRatio(Tab 化后不再因预览开关而切换宽度)', () => {
    const store = createStore()
    store.set(sidePanelRatioAtom, 0.45)
    expect(store.get(effectiveRatioAtom)).toBe(0.45)
  })

  test('有预览时仍返回 sidePanelRatio(同一比例)', () => {
    const store = createStore()
    store.set(sidePanelRatioAtom, 0.45)
    store.set(currentAgentSessionIdAtom, 'test-session')
    store.set(currentPreviewAtom, { kind: 'file', path: '/a.md', ext: 'md', size: 100 })
    expect(store.get(effectiveRatioAtom)).toBe(0.45)
  })

  test('paper 类型预览也返回同一 sidePanelRatio', () => {
    const store = createStore()
    store.set(sidePanelRatioAtom, 0.45)
    store.set(currentAgentSessionIdAtom, 'test-session-2')
    store.set(currentPreviewAtom, {
      kind: 'paper',
      record: {
        ts: '2026-04-22',
        query: null,
        source: 'test',
        title: 'T',
        authors: [],
        year: null,
        venue: null,
        doi: null,
        url: null,
        abstract: null,
      },
    })
    expect(store.get(effectiveRatioAtom)).toBe(0.45)
  })

  test('maximized 时返回 1.0(全宽覆盖对话区),忽略 sidePanelRatio', () => {
    const store = createStore()
    store.set(sidePanelRatioAtom, 0.45)
    store.set(rightPanelMaximizedAtom, true)
    expect(store.get(effectiveRatioAtom)).toBe(1.0)
  })

  test('setting currentPreviewAtom to null closes the preview tab even when a default tab is active', () => {
    const store = createStore()
    store.set(currentAgentSessionIdAtom, 'test-session-null-write')

    // open a file preview
    store.set(currentPreviewAtom, { kind: 'file', path: '/a.txt', ext: 'txt', size: 0 })
    expect(store.get(currentPreviewAtom)).not.toBeNull()

    // switch active back to a default tab (manually via the tabs atom)
    const tabsAtom = rightPanelTabsBySessionAtom('test-session-null-write')
    store.set(tabsAtom, { ...store.get(tabsAtom), activeId: 'session-papers' })

    // null write should still close the preview tab
    store.set(currentPreviewAtom, null)
    expect(store.get(currentPreviewAtom)).toBeNull()
    const tabs = store.get(tabsAtom).tabs
    expect(tabs.some((t) => t.kind === 'file-preview')).toBe(false)
  })

  test('#444 多 file tab 时 null 写入只关闭当前 active 的那个', () => {
    const store = createStore()
    store.set(currentAgentSessionIdAtom, 'test-session-multi-null')
    const tabsAtom = rightPanelTabsBySessionAtom('test-session-multi-null')

    // 连开两个文件，b 为当前 active
    store.set(currentPreviewAtom, { kind: 'file', path: '/a.txt', ext: 'txt', size: 0 })
    store.set(currentPreviewAtom, { kind: 'file', path: '/b.txt', ext: 'txt', size: 0 })
    expect(store.get(tabsAtom).activeId).toBe('file-preview:/b.txt')

    // null 写入：只关掉 active 的 b，a 仍在
    store.set(currentPreviewAtom, null)
    const ids = store.get(tabsAtom).tabs.map((t) => t.id)
    expect(ids).toContain('file-preview:/a.txt')
    expect(ids).not.toContain('file-preview:/b.txt')
    // active 落到相邻左 tab（a）
    expect(store.get(tabsAtom).activeId).toBe('file-preview:/a.txt')
  })
})

import { previewSiblingsAtom } from './side-panel-layout'

describe('previewSiblingsAtom', () => {
  test('默认值为 null', () => {
    const store = createStore()
    expect(store.get(previewSiblingsAtom)).toBeNull()
  })

  test('可写入 PreviewSiblings 对象', () => {
    const store = createStore()
    const siblings = {
      files: [{ name: 'a.pdf', path: '/root/a.pdf', isDirectory: false }],
      currentIndex: 0,
    }
    store.set(previewSiblingsAtom, siblings)
    expect(store.get(previewSiblingsAtom)).toEqual(siblings)
  })
})
