import { test, expect } from 'bun:test'
import {
  buildCollectionPathList,
  sortCollectionsForTree,
  filterCollectionsByQuery,
  createInitialNavState,
  getCurrentLevel,
  enterLevel,
  goBack,
  isLeaf,
  toDrillTarget,
  pruneStaleLevels,
  type CollectionWithPath,
} from './at-mention-helpers.ts'
import type { CollectionSummary } from '@asci/core/zotero'

const fixtures: CollectionSummary[] = [
  { key: 'A', name: 'Papers', parentKey: null },
  { key: 'B', name: 'Transformers', parentKey: 'A' },
  { key: 'C', name: '2024', parentKey: 'B' },
  { key: 'D', name: 'Methods', parentKey: null },
]

test('buildCollectionPathList 按父子链拼路径', () => {
  const list = buildCollectionPathList(fixtures)
  const byKey = new Map(list.map((c: CollectionWithPath) => [c.key, c]))
  expect(byKey.get('A')?.path).toBe('Papers')
  expect(byKey.get('B')?.path).toBe('Papers / Transformers')
  expect(byKey.get('C')?.path).toBe('Papers / Transformers / 2024')
  expect(byKey.get('D')?.path).toBe('Methods')
})

test('buildCollectionPathList 按 path 深度推 depth（根为 0）', () => {
  const list = buildCollectionPathList(fixtures)
  const byKey = new Map(list.map((c: CollectionWithPath) => [c.key, c]))
  expect(byKey.get('A')?.depth).toBe(0)
  expect(byKey.get('B')?.depth).toBe(1)
  expect(byKey.get('C')?.depth).toBe(2)
  expect(byKey.get('D')?.depth).toBe(0)
})

test('buildCollectionPathList 输出为树形 DFS 先序（父紧跟子树，同级按名排序）', () => {
  // 同级：根 ['Methods'(D), 'Papers'(A)] 按名排序 Methods 在前；Papers 子树紧跟 Papers
  const list = buildCollectionPathList(fixtures)
  expect(list.map((c) => c.key)).toEqual(['D', 'A', 'B', 'C'])
})

test('sortCollectionsForTree 同级按名字本地化排序', () => {
  const flat: CollectionWithPath[] = [
    { key: 'r', name: 'Root', parentKey: null, path: 'Root', depth: 0 },
    { key: 'z', name: 'Zebra', parentKey: 'r', path: 'Root / Zebra', depth: 1 },
    { key: 'a', name: 'Apple', parentKey: 'r', path: 'Root / Apple', depth: 1 },
  ]
  expect(sortCollectionsForTree(flat).map((c) => c.key)).toEqual(['r', 'a', 'z'])
})

test('sortCollectionsForTree 孤儿（父缺失）补挂尾部不丢失', () => {
  const flat: CollectionWithPath[] = [
    { key: 'r', name: 'Root', parentKey: null, path: 'Root', depth: 0 },
    { key: 'o', name: 'Orphan', parentKey: 'GONE', path: '? / Orphan', depth: 1 },
  ]
  const out = sortCollectionsForTree(flat)
  expect(out).toHaveLength(2)
  expect(out.map((c) => c.key)).toEqual(['r', 'o'])
})

test('buildCollectionPathList 父链断裂时用 "?" 占位', () => {
  const orphan: CollectionSummary[] = [
    { key: 'X', name: 'Orphan', parentKey: 'NONEXISTENT' },
  ]
  const list = buildCollectionPathList(orphan)
  expect(list[0].path).toBe('? / Orphan')
})

test('filterCollectionsByQuery 空 query 返回全部', () => {
  const list = buildCollectionPathList(fixtures)
  expect(filterCollectionsByQuery(list, '')).toHaveLength(4)
})

test('filterCollectionsByQuery 按名字或路径任一段模糊命中', () => {
  const list = buildCollectionPathList(fixtures)
  const result = filterCollectionsByQuery(list, 'trans')
  expect(result.map((c) => c.key)).toEqual(['B'])
})

test('filterCollectionsByQuery 按父级路径命中子节点', () => {
  const list = buildCollectionPathList(fixtures)
  const result = filterCollectionsByQuery(list, 'papers')
  expect(new Set(result.map((c) => c.key))).toEqual(new Set(['A', 'B', 'C']))
})

test('filterCollectionsByQuery 大小写不敏感', () => {
  const list = buildCollectionPathList(fixtures)
  expect(filterCollectionsByQuery(list, 'METHODS')).toHaveLength(1)
})

test('filterCollectionsByQuery 路径子串不传染给子节点', () => {
  // 'trans' 应该只命中 name='Transformers' 的 B；
  // 不应通过 C 的路径 'Papers / Transformers / 2024' 命中 C（C 自己的 name='2024' 不含 'trans'）
  const list = buildCollectionPathList(fixtures)
  const result = filterCollectionsByQuery(list, 'trans')
  expect(result.map((c) => c.key)).toEqual(['B'])
})

// ---- 导航状态模型测试 ----

test('createInitialNavState 仅含根层', () => {
  const s = createInitialNavState()
  expect(s.stack).toHaveLength(1)
  expect(s.stack[0].kind).toBe('root')
  expect(s.stack[0].query).toBe('')
  expect(s.stack[0].index).toBe(0)
})

test('getCurrentLevel 读取栈顶', () => {
  const s = createInitialNavState()
  expect(getCurrentLevel(s).kind).toBe('root')
})

test('enterLevel 从根进入 project-files', () => {
  const s0 = createInitialNavState()
  const s1 = enterLevel(s0, { kind: 'project-files' })
  expect(s1.stack).toHaveLength(2)
  expect(getCurrentLevel(s1).kind).toBe('project-files')
  expect(getCurrentLevel(s1).query).toBe('')
  expect(getCurrentLevel(s1).index).toBe(0)
})

test('enterLevel 从根进入 library-root', () => {
  const s0 = createInitialNavState()
  const s1 = enterLevel(s0, { kind: 'library-root' })
  expect(s1.stack).toHaveLength(2)
  expect(getCurrentLevel(s1).kind).toBe('library-root')
})

test('enterLevel 从 library-root 进入 library-all-items', () => {
  const s0 = enterLevel(createInitialNavState(), { kind: 'library-root' })
  const s1 = enterLevel(s0, { kind: 'library-all-items' })
  expect(s1.stack).toHaveLength(3)
  expect(getCurrentLevel(s1).kind).toBe('library-all-items')
})

test('enterLevel 从 library-root 进入 library-collection 并携带 collectionKey', () => {
  const s0 = enterLevel(createInitialNavState(), { kind: 'library-root' })
  const s1 = enterLevel(s0, { kind: 'library-collection', collectionKey: 'A' })
  expect(s1.stack).toHaveLength(3)
  const cur = getCurrentLevel(s1)
  expect(cur.kind).toBe('library-collection')
  expect(cur.collectionKey).toBe('A')
})

test('enterLevel 进入 library-root 无条件成功（Zotero 未启用由面板层渲染占位）', () => {
  const s0 = createInitialNavState()
  const s1 = enterLevel(s0, { kind: 'library-root' })
  // 不论 Zotero 是否启用，栈都已入一层 library-root
  expect(s1).not.toBe(s0)
  expect(s1.stack).toHaveLength(2)
  expect(s1.stack[1]?.kind).toBe('library-root')
})

test('enterLevel 非法转移抛错（project-files 是叶子）', () => {
  const s0 = enterLevel(createInitialNavState(), { kind: 'project-files' })
  expect(() =>
    enterLevel(s0, { kind: 'library-all-items' }),
  ).toThrow()
})

test('enterLevel 非法转移抛错（根层直接进 library-all-items）', () => {
  const s0 = createInitialNavState()
  expect(() =>
    enterLevel(s0, { kind: 'library-all-items' }),
  ).toThrow()
})

test('goBack 从二级回到根层', () => {
  const s0 = createInitialNavState()
  const s1 = enterLevel(s0, { kind: 'library-root' })
  const s2 = goBack(s1)
  expect(s2.stack).toHaveLength(1)
  expect(getCurrentLevel(s2).kind).toBe('root')
})

test('goBack 从三级回到二级', () => {
  const s0 = enterLevel(createInitialNavState(), { kind: 'library-root' })
  const s1 = enterLevel(s0, { kind: 'library-collection', collectionKey: 'B' })
  const s2 = goBack(s1)
  expect(s2.stack).toHaveLength(2)
  expect(getCurrentLevel(s2).kind).toBe('library-root')
})

test('goBack 在根层返回原 state（引用相等作为边界标记）', () => {
  const s0 = createInitialNavState()
  const s1 = goBack(s0)
  expect(s1).toBe(s0)
})

// ---- isLeaf / toDrillTarget ----

test('isLeaf: file / zotero-item 为叶子', () => {
  expect(isLeaf({ kind: 'file' })).toBe(true)
  expect(isLeaf({ kind: 'zotero-item' })).toBe(true)
})

test('isLeaf: category / library-all-items / zotero-col 非叶子', () => {
  expect(isLeaf({ kind: 'category', target: 'project-files' })).toBe(false)
  expect(isLeaf({ kind: 'library-all-items' })).toBe(false)
  expect(isLeaf({ kind: 'zotero-col', col: { key: 'K' } })).toBe(false)
})

test('toDrillTarget: category → 对应 target 层', () => {
  expect(toDrillTarget({ kind: 'category', target: 'project-files' })).toEqual({
    kind: 'project-files',
  })
  expect(toDrillTarget({ kind: 'category', target: 'library-root' })).toEqual({
    kind: 'library-root',
  })
})

test('toDrillTarget: library-all-items → library-all-items', () => {
  expect(toDrillTarget({ kind: 'library-all-items' })).toEqual({
    kind: 'library-all-items',
  })
})

test('toDrillTarget: zotero-col → library-collection 携带 key', () => {
  expect(toDrillTarget({ kind: 'zotero-col', col: { key: 'K1' } })).toEqual({
    kind: 'library-collection',
    collectionKey: 'K1',
  })
})

test('toDrillTarget: 叶子返回 null', () => {
  expect(toDrillTarget({ kind: 'file' })).toBeNull()
  expect(toDrillTarget({ kind: 'zotero-item' })).toBeNull()
})

// ---- pruneStaleLevels ----

test('pruneStaleLevels: 全部 collection 均有效时返回原引用', () => {
  const s0 = enterLevel(createInitialNavState(), { kind: 'library-root' })
  const s1 = enterLevel(s0, { kind: 'library-collection', collectionKey: 'K1' })
  const out = pruneStaleLevels(s1, new Set(['K1', 'K2']))
  expect(out).toBe(s1)
})

test('pruneStaleLevels: 栈中不含 library-collection 时返回原引用', () => {
  const s0 = enterLevel(createInitialNavState(), { kind: 'library-root' })
  const s1 = enterLevel(s0, { kind: 'library-all-items' })
  const out = pruneStaleLevels(s1, new Set())
  expect(out).toBe(s1)
})

test('pruneStaleLevels: 栈顶 library-collection 失效时回退到 library-root', () => {
  const s0 = enterLevel(createInitialNavState(), { kind: 'library-root' })
  const s1 = enterLevel(s0, { kind: 'library-collection', collectionKey: 'GONE' })
  const out = pruneStaleLevels(s1, new Set(['OTHER']))
  expect(out.stack).toHaveLength(2)
  expect(getCurrentLevel(out).kind).toBe('library-root')
})

test('pruneStaleLevels: 深层失效时把上方所有层一起弹出', () => {
  // 构造：root → library-root → library-collection(GONE)
  // （更深的再下钻 library-collection 目前模型不支持，此用例覆盖单层失效即可）
  const s0 = enterLevel(createInitialNavState(), { kind: 'library-root' })
  const s1 = enterLevel(s0, { kind: 'library-collection', collectionKey: 'GONE' })
  const out = pruneStaleLevels(s1, new Set())
  expect(out.stack.map((l) => l.kind)).toEqual(['root', 'library-root'])
})

test('pruneStaleLevels: 无 collectionKey 也视为失效', () => {
  // 构造一个 collectionKey 缺失的病态层级（防御性）
  const badState = {
    stack: [
      { kind: 'root' as const, query: '', index: 0 },
      { kind: 'library-root' as const, query: '', index: 0 },
      { kind: 'library-collection' as const, query: '', index: 0 },
    ],
  }
  const out = pruneStaleLevels(badState, new Set(['K']))
  expect(out.stack).toHaveLength(2)
  expect(getCurrentLevel(out).kind).toBe('library-root')
})
