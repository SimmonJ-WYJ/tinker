import { test, expect } from 'bun:test'
import {
  flattenCollectionTargets,
  resolveDefaultDest,
  parseDest,
  serializeDest,
  destToTargetTreeViewID,
  ZOTERO_DEST_CURRENT,
  ZOTERO_TREE_MY_LIBRARY,
} from './zotero-destination'
import type { ZoteroCollectionTarget } from '@asci/shared'

test('flattenCollectionTargets 用 level 推 depth + fullPath（targets 已父先于子排序）', () => {
  const list: ZoteroCollectionTarget[] = [
    { treeViewID: 'L1', name: 'My Library', level: 0 },
    { treeViewID: 'C1', name: 'AI', level: 1 },
    { treeViewID: 'C2', name: 'NLP', level: 2 },
    { treeViewID: 'C3', name: 'Vision', level: 2 },
    { treeViewID: 'C4', name: 'Bio', level: 1 },
  ]
  const out = flattenCollectionTargets(list)
  expect(out.map((n) => n.treeViewID)).toEqual(['L1', 'C1', 'C2', 'C3', 'C4'])
  expect(out.map((n) => n.depth)).toEqual([0, 1, 2, 2, 1])
  expect(out.map((n) => n.fullPath)).toEqual([
    'My Library',
    'My Library / AI',
    'My Library / AI / NLP',
    'My Library / AI / Vision',
    'My Library / Bio',
  ])
  expect(out[0]!.isLibraryRoot).toBe(true)
  expect(out[1]!.isLibraryRoot).toBe(false)
})

test('flattenCollectionTargets 空列表返回空数组，不抛错', () => {
  expect(flattenCollectionTargets([])).toEqual([])
})

test('parseDest 空 / undefined / 旧空串 → zoteroCurrent（默认）', () => {
  expect(parseDest(undefined)).toEqual({ kind: 'zoteroCurrent' })
  expect(parseDest(null)).toEqual({ kind: 'zoteroCurrent' })
  expect(parseDest('')).toEqual({ kind: 'zoteroCurrent' })
})

test('parseDest sentinel → zoteroCurrent；treeViewID → target', () => {
  expect(parseDest(ZOTERO_DEST_CURRENT)).toEqual({ kind: 'zoteroCurrent' })
  expect(parseDest('L1')).toEqual({ kind: 'target', treeViewID: 'L1' })
  expect(parseDest('C42')).toEqual({ kind: 'target', treeViewID: 'C42' })
})

test('serializeDest 往返一致', () => {
  const cases = [
    { kind: 'zoteroCurrent' as const },
    { kind: 'target' as const, treeViewID: 'L1' },
    { kind: 'target' as const, treeViewID: 'C7' },
  ]
  for (const d of cases) {
    expect(parseDest(serializeDest(d))).toEqual(d)
  }
})

test('resolveDefaultDest 优先 per-workspace > global > 我的文献库根', () => {
  // per-workspace 命中
  expect(resolveDefaultDest({ ws1: 'C5' }, 'L1', 'ws1'))
    .toEqual({ kind: 'target', treeViewID: 'C5' })

  // per-workspace 未命中 → fallback global
  expect(resolveDefaultDest({ ws1: 'C5' }, 'L1', 'ws2'))
    .toEqual({ kind: 'target', treeViewID: 'L1' })

  // 都缺 → 我的文献库根（不再静默跟随 Zotero UI，#463）
  expect(resolveDefaultDest(undefined, undefined, 'wsX'))
    .toEqual({ kind: 'target', treeViewID: ZOTERO_TREE_MY_LIBRARY })

  // workspaceId 为 null → 跳过 per-workspace 直接看 global
  expect(resolveDefaultDest({ ws1: 'C5' }, 'C9', null))
    .toEqual({ kind: 'target', treeViewID: 'C9' })
})

test('destToTargetTreeViewID 映射符合 createItem 协议', () => {
  expect(destToTargetTreeViewID({ kind: 'zoteroCurrent' })).toBe(null)
  expect(destToTargetTreeViewID({ kind: 'target', treeViewID: 'L1' })).toBe('L1')
  expect(destToTargetTreeViewID({ kind: 'target', treeViewID: 'C3' })).toBe('C3')
})
