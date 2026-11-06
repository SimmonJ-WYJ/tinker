import { describe, it, expect } from 'bun:test'
import { createStore } from 'jotai'
import {
  queuedMessageUuidsAtom,
  enqueueMessageUuidAtom,
  clearQueuedMessageUuidsAtom,
  removeMessageUuidAtom,
} from './agent-atoms.ts'

/** 取某会话队列的 uuid 顺序，便于断言（队列项为 { uuid, text }） */
const uuids = (store: ReturnType<typeof createStore>, sessionId: string): string[] | undefined =>
  store.get(queuedMessageUuidsAtom).get(sessionId)?.map((m) => m.uuid)

describe('排队中消息队列', () => {
  it('tail 入队按顺序追加到队尾', () => {
    const store = createStore()
    store.set(enqueueMessageUuidAtom, { sessionId: 's1', uuid: 'a', text: 'A', mode: 'tail' })
    store.set(enqueueMessageUuidAtom, { sessionId: 's1', uuid: 'b', text: 'B', mode: 'tail' })
    expect(uuids(store, 's1')).toEqual(['a', 'b'])
  })

  it('入队即带上展示文本', () => {
    const store = createStore()
    store.set(enqueueMessageUuidAtom, { sessionId: 's1', uuid: 'a', text: '你好', mode: 'tail' })
    expect(store.get(queuedMessageUuidsAtom).get('s1')).toEqual([{ uuid: 'a', text: '你好' }])
  })

  it('head 入队（打断）插到队头', () => {
    const store = createStore()
    store.set(enqueueMessageUuidAtom, { sessionId: 's1', uuid: 'b', text: 'B', mode: 'tail' })
    store.set(enqueueMessageUuidAtom, { sessionId: 's1', uuid: 'c', text: 'C', mode: 'tail' })
    store.set(enqueueMessageUuidAtom, { sessionId: 's1', uuid: 'd', text: 'D', mode: 'head' })
    expect(uuids(store, 's1')).toEqual(['d', 'b', 'c'])
  })

  it('clear 清空某会话队列', () => {
    const store = createStore()
    store.set(enqueueMessageUuidAtom, { sessionId: 's1', uuid: 'a', text: 'A', mode: 'tail' })
    store.set(clearQueuedMessageUuidsAtom, 's1')
    expect(store.get(queuedMessageUuidsAtom).has('s1')).toBe(false)
  })

  it('会话隔离：s2 入队不影响 s1', () => {
    const store = createStore()
    store.set(enqueueMessageUuidAtom, { sessionId: 's1', uuid: 'a', text: 'A', mode: 'tail' })
    store.set(enqueueMessageUuidAtom, { sessionId: 's2', uuid: 'x', text: 'X', mode: 'tail' })
    expect(uuids(store, 's1')).toEqual(['a'])
    expect(uuids(store, 's2')).toEqual(['x'])
  })

  it('removeMessageUuid 按 uuid 移除（中间项）', () => {
    const store = createStore()
    store.set(enqueueMessageUuidAtom, { sessionId: 's1', uuid: 'a', text: 'A', mode: 'tail' })
    store.set(enqueueMessageUuidAtom, { sessionId: 's1', uuid: 'b', text: 'B', mode: 'tail' })
    store.set(enqueueMessageUuidAtom, { sessionId: 's1', uuid: 'c', text: 'C', mode: 'tail' })
    store.set(removeMessageUuidAtom, { sessionId: 's1', uuid: 'b' })
    expect(uuids(store, 's1')).toEqual(['a', 'c'])
  })

  it('removeMessageUuid 移除最后一项时删除整个 session key（与 clear 一致）', () => {
    const store = createStore()
    store.set(enqueueMessageUuidAtom, { sessionId: 's1', uuid: 'a', text: 'A', mode: 'tail' })
    store.set(removeMessageUuidAtom, { sessionId: 's1', uuid: 'a' })
    expect(store.get(queuedMessageUuidsAtom).has('s1')).toBe(false)
  })

  it('removeMessageUuid 不存在的 uuid 是 no-op', () => {
    const store = createStore()
    store.set(enqueueMessageUuidAtom, { sessionId: 's1', uuid: 'a', text: 'A', mode: 'tail' })
    store.set(removeMessageUuidAtom, { sessionId: 's1', uuid: 'zzz' })
    expect(uuids(store, 's1')).toEqual(['a'])
  })
})
