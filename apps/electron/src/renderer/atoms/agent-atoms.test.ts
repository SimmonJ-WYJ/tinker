import { test, expect } from 'bun:test'
import { createStore } from 'jotai'
import {
  sidebarProjectFilesExpandedMapAtom,
  recentWorkspaceFilesAtom,
  agentPendingMentionsAtom,
  addPendingMentionsAtom,
  type AgentPendingMention,
} from './agent-atoms.ts'

test('sidebarProjectFilesExpandedMapAtom 默认为空 Map', () => {
  const store = createStore()
  const m = store.get(sidebarProjectFilesExpandedMapAtom)
  expect(m).toBeInstanceOf(Map)
  expect(m.size).toBe(0)
})

test('sidebarProjectFilesExpandedMapAtom 支持按 workspaceId 读写隔离', () => {
  const store = createStore()
  const next = new Map(store.get(sidebarProjectFilesExpandedMapAtom))
  next.set('ws-a', true)
  next.set('ws-b', false)
  store.set(sidebarProjectFilesExpandedMapAtom, next)
  const read = store.get(sidebarProjectFilesExpandedMapAtom)
  expect(read.get('ws-a')).toBe(true)
  expect(read.get('ws-b')).toBe(false)
})

test('recentWorkspaceFilesAtom 默认为 null', () => {
  const store = createStore()
  expect(store.get(recentWorkspaceFilesAtom)).toBeNull()
})

test('recentWorkspaceFilesAtom 可写入完整结构', () => {
  const store = createStore()
  store.set(recentWorkspaceFilesAtom, {
    workspaceId: 'ws-1',
    files: [{ relPath: 'a.md', name: 'a.md', mtimeMs: 1000, size: 10 }],
    totalCount: 1,
    capped: false,
  })
  const result = store.get(recentWorkspaceFilesAtom)
  expect(result).not.toBeNull()
  expect(result!.files[0]!.name).toBe('a.md')
})

const file = (id: string, label = id): AgentPendingMention => ({ kind: 'file', id, label })

test('addPendingMentionsAtom: 空数组写入 atom 不变', () => {
  const store = createStore()
  store.set(agentPendingMentionsAtom, [file('a.md')])
  store.set(addPendingMentionsAtom, [])
  expect(store.get(agentPendingMentionsAtom)).toEqual([file('a.md')])
})

test('addPendingMentionsAtom: 单项写入空 atom', () => {
  const store = createStore()
  store.set(addPendingMentionsAtom, [file('a.md')])
  expect(store.get(agentPendingMentionsAtom)).toEqual([file('a.md')])
})

test('addPendingMentionsAtom: 单项重复（同 kind+id）不变', () => {
  const store = createStore()
  store.set(agentPendingMentionsAtom, [file('a.md')])
  store.set(addPendingMentionsAtom, [file('a.md', '不同 label 也算重复')])
  expect(store.get(agentPendingMentionsAtom)).toEqual([file('a.md')])
})

test('addPendingMentionsAtom: 批量写入含部分重复 — 仅追加未存在项，顺序保留', () => {
  const store = createStore()
  store.set(agentPendingMentionsAtom, [file('a.md'), file('b.md')])
  store.set(addPendingMentionsAtom, [file('b.md'), file('c.md'), file('d.md')])
  expect(store.get(agentPendingMentionsAtom)).toEqual([
    file('a.md'),
    file('b.md'),
    file('c.md'),
    file('d.md'),
  ])
})

test('addPendingMentionsAtom: 不同 kind 同 id 视为不同项', () => {
  const store = createStore()
  const a: AgentPendingMention = { kind: 'file', id: 'x', label: 'x' }
  const b: AgentPendingMention = { kind: 'zotero-item', id: 'x', label: 'X' }
  store.set(addPendingMentionsAtom, [a, b])
  expect(store.get(agentPendingMentionsAtom)).toEqual([a, b])
})

test('addPendingMentionsAtom: 不同 id 同 kind 视为不同项', () => {
  const store = createStore()
  store.set(addPendingMentionsAtom, [file('a.md'), file('b.md')])
  expect(store.get(agentPendingMentionsAtom)).toEqual([file('a.md'), file('b.md')])
})

test('addPendingMentionsAtom: 全去重时保持 atom 引用不变（避免无谓订阅刷新）', () => {
  const store = createStore()
  store.set(agentPendingMentionsAtom, [file('a.md'), file('b.md')])
  const before = store.get(agentPendingMentionsAtom)
  store.set(addPendingMentionsAtom, [file('a.md'), file('b.md')])
  expect(store.get(agentPendingMentionsAtom)).toBe(before)
})
