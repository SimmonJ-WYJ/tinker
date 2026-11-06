// apps/electron/src/renderer/atoms/right-panel-tabs.test.ts
import { expect, test, describe } from 'bun:test'
import { createStore } from 'jotai'
import type { PreviewTarget } from './side-panel-layout.ts'
import {
  rightPanelTabsBySessionAtom,
  kindOfTarget,
  titleOfTarget,
  tabIdOfTarget,
  upsertTab,
  replaceActiveTab,
  closeTab,
  closeOtherTabs,
  closeTabsToRight,
  isDefaultTabId,
  DEFAULT_TABS,
  isPreviewKind,
  type SessionTabsState,
} from './right-panel-tabs.ts'

/** 构造最小 PaperRecord（recordKey 只看 doi / extra；title+ts 供兜底与标题） */
function rec(fields: { doi?: string; title?: string; ts?: string; extra?: Record<string, unknown> }): PreviewTarget {
  return {
    kind: 'paper',
    record: { doi: fields.doi ?? null, title: fields.title ?? 'P', ts: fields.ts ?? '2026', extra: fields.extra } as never,
  }
}

describe('kindOfTarget', () => {
  test('file → file-preview', () => {
    expect(kindOfTarget({ kind: 'file', path: '/x.md', ext: 'md', size: 0 })).toBe('file-preview')
  })
  test('paper → paper-detail；paper-entry → paper-record', () => {
    expect(kindOfTarget(rec({ doi: '10.1/a' }))).toBe('paper-detail')
    expect(kindOfTarget({ kind: 'paper-entry', entry: { key: 'Y' } as never })).toBe('paper-record')
  })
})

describe('tabIdOfTarget', () => {
  test('file：id 含 path（每文件独立）', () => {
    expect(tabIdOfTarget({ kind: 'file', path: '/a/b.txt', ext: 'txt', size: 0 })).toBe('file-preview:/a/b.txt')
  })

  test('paper：按 recordKey 独立成 tab（DOI 优先）', () => {
    expect(tabIdOfTarget(rec({ doi: '10.1/AaA' }))).toBe('paper:doi:10.1/aaa')
  })

  test('不同论文 → 不同 id（累积）', () => {
    expect(tabIdOfTarget(rec({ doi: '10.1/a' }))).not.toBe(tabIdOfTarget(rec({ doi: '10.1/b' })))
  })

  test('同一篇论文的 record 与 entry → 同一 id（收敛）', () => {
    const recId = tabIdOfTarget(rec({ doi: '10.1/same' }))
    const entryId = tabIdOfTarget({ kind: 'paper-entry', entry: { key: 'doi:10.1/same' } as never })
    expect(recId).toBe('paper:doi:10.1/same')
    expect(entryId).toBe('paper:doi:10.1/same')
    expect(recId).toBe(entryId)
  })

  test('paper 无 DOI/ID → recordKey 用 title+year 派生稳定 key', () => {
    expect(tabIdOfTarget(rec({ title: 'Hi', ts: 't1' }))).toBe('paper:t:hi|y:')
  })

  test('paper 连标题都缺（占位）→ tabIdOfTarget 退化 title+ts 兜底，仍唯一', () => {
    // 标题为占位符时 recordKey 返回 null，tabIdOfTarget 用 title+ts 兜底
    const id = tabIdOfTarget(rec({ title: '(无标题)', ts: 'ts-9' }))
    expect(id).toBe('paper:t:(无标题)|ts-9')
  })
})

describe('titleOfTarget', () => {
  test('file：取文件名', () => {
    expect(titleOfTarget({ kind: 'file', path: '/a/b/c.txt', ext: 'txt', size: 0 })).toBe('c.txt')
  })
  test('paper：取 record.title', () => {
    expect(titleOfTarget(rec({ doi: '10.1/a', title: 'X' }))).toBe('X')
  })
  test('paper：标题剥 markup 标签保内文', () => {
    expect(titleOfTarget(rec({ doi: '10.1/a', title: '<scp>AI</scp> in teaching' }))).toBe('AI in teaching')
  })
  test('paper：标题缺失 → 空串（由渲染层退化到 i18n 文案）', () => {
    expect(titleOfTarget(rec({ doi: '10.1/a', title: '' }))).toBe('')
  })
  test('paper-entry：标题缺失 → 退化到 entry.key', () => {
    expect(titleOfTarget({ kind: 'paper-entry', entry: { key: 'doi:10.1/k', title: '' } as never })).toBe('doi:10.1/k')
  })
})

describe('upsertTab — Chrome 风累积', () => {
  const base = (): SessionTabsState => ({ tabs: [...DEFAULT_TABS], activeId: 'session-papers' })

  test('新 id 追加到末尾并激活', () => {
    const t: PreviewTarget = { kind: 'file', path: '/a.txt', ext: 'txt', size: 0 }
    const next = upsertTab(base(), tabIdOfTarget(t), 'file-preview', 'a.txt', t)
    expect(next.tabs.map((x) => x.id)).toEqual(['session-files', 'session-papers', 'file-preview:/a.txt'])
    expect(next.activeId).toBe('file-preview:/a.txt')
  })

  test('两篇不同论文各自成 tab（不再单槽位复用，反转 #444）', () => {
    const p1 = rec({ doi: '10.1/a', title: 'P1' })
    const p2 = rec({ doi: '10.1/b', title: 'P2' })
    let s = base()
    s = upsertTab(s, tabIdOfTarget(p1), 'paper-detail', 'P1', p1)
    s = upsertTab(s, tabIdOfTarget(p2), 'paper-detail', 'P2', p2)
    expect(s.tabs.filter((t) => t.kind === 'paper-detail')).toHaveLength(2)
    expect(s.activeId).toBe(tabIdOfTarget(p2))
  })

  test('同一篇论文 record→entry：复用同一 tab，kind 随之切换', () => {
    const r = rec({ doi: '10.1/same', title: 'R' })
    const eId = 'paper:doi:10.1/same'
    let s = base()
    s = upsertTab(s, tabIdOfTarget(r), 'paper-detail', 'R', r)
    const entry: PreviewTarget = { kind: 'paper-entry', entry: { key: 'doi:10.1/same', title: 'E' } as never }
    s = upsertTab(s, tabIdOfTarget(entry), 'paper-record', 'E', entry)
    const paperTabs = s.tabs.filter((t) => t.id === eId)
    expect(paperTabs).toHaveLength(1)
    expect(paperTabs[0]?.kind).toBe('paper-record')
    expect(s.tabs).toHaveLength(3) // 2 默认 + 1 paper
  })

  test('同一文件再次打开 → 聚焦不新建', () => {
    const t: PreviewTarget = { kind: 'file', path: '/a.txt', ext: 'txt', size: 0 }
    let s = base()
    s = upsertTab(s, tabIdOfTarget(t), 'file-preview', 'a.txt', t)
    s = upsertTab(s, tabIdOfTarget(t), 'file-preview', 'a.txt', t)
    expect(s.tabs).toHaveLength(3)
  })
})

describe('closeTab', () => {
  const withFile = (): SessionTabsState => ({
    tabs: [
      ...DEFAULT_TABS,
      { id: 'file-preview:/a', kind: 'file-preview', title: 'a', payload: { kind: 'file', path: '/a', ext: '', size: 0 } as PreviewTarget },
    ],
    activeId: 'file-preview:/a',
  })

  test('关闭 preview tab，激活相邻左 tab', () => {
    const next = closeTab(withFile(), 'file-preview:/a')
    expect(next.tabs.map((t) => t.id)).toEqual(['session-files', 'session-papers'])
    expect(next.activeId).toBe('session-papers')
  })

  test('默认 tab 不可关闭（no-op）', () => {
    const s = withFile()
    expect(closeTab(s, 'session-files')).toBe(s)
    expect(closeTab(s, 'session-papers')).toBe(s)
  })

  test('关闭非 active tab 不改 active', () => {
    const s: SessionTabsState = {
      tabs: [
        ...DEFAULT_TABS,
        { id: 'file-preview:/a', kind: 'file-preview', title: 'a', payload: null },
        { id: 'file-preview:/b', kind: 'file-preview', title: 'b', payload: null },
      ],
      activeId: 'file-preview:/b',
    }
    const next = closeTab(s, 'file-preview:/a')
    expect(next.activeId).toBe('file-preview:/b')
    expect(next.tabs.map((t) => t.id)).toEqual(['session-files', 'session-papers', 'file-preview:/b'])
  })
})

describe('closeOtherTabs', () => {
  test('仅保留默认 tab + 指定 tab，激活指定', () => {
    const s: SessionTabsState = {
      tabs: [
        ...DEFAULT_TABS,
        { id: 'p1', kind: 'paper-detail', title: 'p1', payload: null },
        { id: 'p2', kind: 'paper-detail', title: 'p2', payload: null },
        { id: 'p3', kind: 'paper-detail', title: 'p3', payload: null },
      ],
      activeId: 'p3',
    }
    const next = closeOtherTabs(s, 'p2')
    expect(next.tabs.map((t) => t.id)).toEqual(['session-files', 'session-papers', 'p2'])
    expect(next.activeId).toBe('p2')
  })
})

describe('closeTabsToRight', () => {
  test('关闭目标右侧的全部（默认 tab 在最前不受影响）', () => {
    const s: SessionTabsState = {
      tabs: [
        ...DEFAULT_TABS,
        { id: 'p1', kind: 'paper-detail', title: 'p1', payload: null },
        { id: 'p2', kind: 'paper-detail', title: 'p2', payload: null },
        { id: 'p3', kind: 'paper-detail', title: 'p3', payload: null },
      ],
      activeId: 'p3',
    }
    const next = closeTabsToRight(s, 'p1')
    expect(next.tabs.map((t) => t.id)).toEqual(['session-files', 'session-papers', 'p1'])
    // active 落在被关的 p3 上 → 回退到目标 p1
    expect(next.activeId).toBe('p1')
  })

  test('目标已是最右 → no-op', () => {
    const s: SessionTabsState = {
      tabs: [...DEFAULT_TABS, { id: 'p1', kind: 'paper-detail', title: 'p1', payload: null }],
      activeId: 'p1',
    }
    expect(closeTabsToRight(s, 'p1')).toBe(s)
  })
})

describe('isDefaultTabId / isPreviewKind', () => {
  test('isDefaultTabId', () => {
    expect(isDefaultTabId('session-files')).toBe(true)
    expect(isDefaultTabId('session-papers')).toBe(true)
    expect(isDefaultTabId('paper:doi:x')).toBe(false)
  })
  test('isPreviewKind', () => {
    expect(isPreviewKind('file-preview')).toBe(true)
    expect(isPreviewKind('paper-detail')).toBe(true)
    expect(isPreviewKind('session-files')).toBe(false)
  })
})

describe('rightPanelTabsBySessionAtom', () => {
  test('未知会话返回 DEFAULT_TABS（papers 激活）', () => {
    const store = createStore()
    const state = store.get(rightPanelTabsBySessionAtom('s1'))
    expect(state.tabs.map((t) => t.id)).toEqual(['session-files', 'session-papers'])
    expect(state.activeId).toBe('session-papers')
  })

  test('不同会话状态独立', () => {
    const store = createStore()
    const a = rightPanelTabsBySessionAtom('s1')
    const b = rightPanelTabsBySessionAtom('s2')
    const t: PreviewTarget = { kind: 'file', path: '/a', ext: '', size: 0 }
    store.set(a, upsertTab(store.get(a), tabIdOfTarget(t), 'file-preview', 'a', t))
    expect(store.get(a).tabs).toHaveLength(3)
    expect(store.get(b).tabs).toHaveLength(2)
  })
})

describe('replaceActiveTab — 兄弟导航原地切换（不新增 tab）', () => {
  const base: SessionTabsState = { tabs: [...DEFAULT_TABS], activeId: 'session-papers' }

  test('激活的是 preview tab → 原地替换槽位 + 改标题，不新增', () => {
    const s1 = upsertTab(base, 'paper:A', 'paper-detail', 'Paper A', rec({ doi: 'A', title: 'Paper A' }))
    expect(s1.tabs).toHaveLength(3)
    expect(s1.activeId).toBe('paper:A')
    const s2 = replaceActiveTab(s1, 'paper:B', 'paper-detail', 'Paper B', rec({ doi: 'B', title: 'Paper B' }))
    expect(s2.tabs).toHaveLength(3) // 没有新增
    expect(s2.activeId).toBe('paper:B')
    expect(s2.tabs.find((t) => t.id === 'paper:A')).toBeUndefined()
    expect(s2.tabs[2]?.id).toBe('paper:B') // 占原 A 的末位
    expect(s2.tabs[2]?.title).toBe('Paper B')
  })

  test('激活的是默认 tab → 退化为追加（默认 tab 不动）', () => {
    const s = replaceActiveTab(base, 'paper:A', 'paper-detail', 'Paper A', rec({ doi: 'A' }))
    expect(s.tabs).toHaveLength(3)
    expect(s.activeId).toBe('paper:A')
    expect(s.tabs.filter((t) => isDefaultTabId(t.id))).toHaveLength(2)
  })

  test('替换目标 id 已在别处 → 去重（保留当前槽位）', () => {
    let s = upsertTab(base, 'paper:A', 'paper-detail', 'A', rec({ doi: 'A' }))
    s = upsertTab(s, 'paper:B', 'paper-detail', 'B', rec({ doi: 'B' })) // active=paper:B
    const r = replaceActiveTab(s, 'paper:A', 'paper-detail', 'A2', rec({ doi: 'A' }))
    expect(r.tabs.filter((t) => t.id === 'paper:A')).toHaveLength(1)
    expect(r.activeId).toBe('paper:A')
    expect(r.tabs).toHaveLength(3) // 默认2 + 去重后的 A
  })
})
