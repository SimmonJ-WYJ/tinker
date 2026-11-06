/**
 * zotero-link-reconcile 纯函数单测（#461）
 *
 * 只覆盖 selectEntriesToClear 的选择逻辑：给定各工作区的 linkedZoteroKey 与
 * 「已确认在 Zotero 被删除」的 key 集合，算出每个工作区需要清空的 entry key 列表。
 * 真实的 Zotero Web API 反查 / fs 读写不在此测，交由集成路径手验。
 */

import { describe, expect, test } from 'bun:test'
import {
  findDeletedZoteroKeys,
  selectEntriesToClear,
  type WorkspaceLinks,
} from './zotero-link-reconcile-core'

const WS = (id: string, slug: string, entries: Array<[string, string | null]>): WorkspaceLinks => ({
  id,
  slug,
  entries: entries.map(([key, linkedZoteroKey]) => ({ key, linkedZoteroKey })),
})

describe('selectEntriesToClear', () => {
  test('linkedZoteroKey 命中 staleKeys 的 entry 被选中清理', () => {
    const ws = [WS('id-1', 'slug-1', [['paper-a', 'ZKEY1'], ['paper-b', 'ZKEY2']])]
    const result = selectEntriesToClear(ws, new Set(['ZKEY1']))
    expect(result).toEqual([{ id: 'id-1', slug: 'slug-1', keys: ['paper-a'] }])
  })

  test('linkedZoteroKey 不在 staleKeys 的 entry 不被选中', () => {
    const ws = [WS('id-1', 'slug-1', [['paper-a', 'ZKEY1']])]
    expect(selectEntriesToClear(ws, new Set(['ZOTHER']))).toEqual([])
  })

  test('linkedZoteroKey 为 null 的 entry 永不被选中', () => {
    const ws = [WS('id-1', 'slug-1', [['paper-a', null]])]
    expect(selectEntriesToClear(ws, new Set(['ZKEY1']))).toEqual([])
  })

  test('多工作区只返回有命中条目的工作区', () => {
    const ws = [
      WS('id-1', 'slug-1', [['paper-a', 'ZKEY1']]),
      WS('id-2', 'slug-2', [['paper-c', 'ZKEY9']]),
      WS('id-3', 'slug-3', [['paper-d', 'ZKEY2'], ['paper-e', 'ZKEY3']]),
    ]
    const result = selectEntriesToClear(ws, new Set(['ZKEY1', 'ZKEY2', 'ZKEY3']))
    expect(result).toEqual([
      { id: 'id-1', slug: 'slug-1', keys: ['paper-a'] },
      { id: 'id-3', slug: 'slug-3', keys: ['paper-d', 'paper-e'] },
    ])
  })

  test('staleKeys 为空集合时返回空', () => {
    const ws = [WS('id-1', 'slug-1', [['paper-a', 'ZKEY1']])]
    expect(selectEntriesToClear(ws, new Set())).toEqual([])
  })
})

describe('findDeletedZoteroKeys', () => {
  test('Zotero 全部返回 → 无 stale', async () => {
    const stale = await findDeletedZoteroKeys(['A', 'B'], async (batch) => batch)
    expect([...stale]).toEqual([])
  })

  test('Zotero 漏返的 key 被判定为 stale（已删除）', async () => {
    const stale = await findDeletedZoteroKeys(['A', 'B', 'C'], async () => ['A', 'C'])
    expect([...stale].sort()).toEqual(['B'])
  })

  test('批次查询抛错 → 该批 key 一律不判 stale（保守，避免误清）', async () => {
    const stale = await findDeletedZoteroKeys(['A', 'B'], async () => {
      throw new Error('Zotero offline')
    })
    expect([...stale]).toEqual([])
  })

  test('超过 batchSize 时分批查询，跨批正确合并 stale', async () => {
    const calls: string[][] = []
    const stale = await findDeletedZoteroKeys(
      ['A', 'B', 'C', 'D'],
      async (batch) => {
        calls.push(batch)
        return [] // 全部漏返 → 全 stale
      },
      2,
    )
    expect(calls).toEqual([['A', 'B'], ['C', 'D']])
    expect([...stale].sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  test('只有失败的批次跳过，成功批次的 stale 仍生效', async () => {
    const stale = await findDeletedZoteroKeys(
      ['A', 'B', 'C', 'D'],
      async (batch) => {
        if (batch.includes('A')) throw new Error('batch 1 failed')
        return [] // 第二批全漏返
      },
      2,
    )
    // 第一批失败被跳过（A/B 不清），第二批成功判 C/D stale
    expect([...stale].sort()).toEqual(['C', 'D'])
  })

  test('空 key 列表 → 不调用 fetcher，返回空', async () => {
    let called = false
    const stale = await findDeletedZoteroKeys([], async (batch) => {
      called = true
      return batch
    })
    expect(called).toBe(false)
    expect([...stale]).toEqual([])
  })
})
