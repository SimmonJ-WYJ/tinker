/**
 * WorkspaceEventBus 行为单测（spec §3）
 *
 * 覆盖：
 *   - 9 kind 全量监听 + 按 kind 过滤
 *   - 取消监听
 *   - handler 抛错时其他监听器不受影响
 *   - dispose 清场
 */

import { describe, expect, mock, test } from 'bun:test'

import type { ObjectId, WorkspaceEvent } from '@asci/shared'

import { WorkspaceEventBus, workspaceEventBus } from './workspace-event-bus.ts'

const paperId = 'p1' as ObjectId
const setId = 's1' as ObjectId

function paperCreated(at = '2026-05-25T00:00:00.000Z'): WorkspaceEvent {
  return { kind: 'paper.created', paperId, at }
}
function evidenceSetCreated(at = '2026-05-25T00:00:00.000Z'): WorkspaceEvent {
  return { kind: 'evidenceSet.created', evidenceSetId: setId, persisted: true, at }
}

describe('WorkspaceEventBus', () => {
  test('全量监听：所有 kind 都触发同一 handler', () => {
    const bus = new WorkspaceEventBus()
    const handler = mock(() => {})
    bus.on(handler)

    bus.emit(paperCreated())
    bus.emit(evidenceSetCreated())

    expect(handler).toHaveBeenCalledTimes(2)
  })

  test('按 kind 过滤：仅匹配 kind 的 handler 被触发', () => {
    const bus = new WorkspaceEventBus()
    const paperHandler = mock(() => {})
    const setHandler = mock(() => {})
    bus.on('paper.created', paperHandler)
    bus.on('evidenceSet.created', setHandler)

    bus.emit(paperCreated())

    expect(paperHandler).toHaveBeenCalledTimes(1)
    expect(setHandler).not.toHaveBeenCalled()
  })

  test('取消监听返回的 unsubscribe 函数生效', () => {
    const bus = new WorkspaceEventBus()
    const handler = mock(() => {})
    const off = bus.on(handler)

    bus.emit(paperCreated())
    off()
    bus.emit(paperCreated())

    expect(handler).toHaveBeenCalledTimes(1)
  })

  test('全量 + kind 监听并存：两个 handler 都会触发', () => {
    const bus = new WorkspaceEventBus()
    const all = mock(() => {})
    const onlyPaper = mock(() => {})
    bus.on(all)
    bus.on('paper.created', onlyPaper)

    bus.emit(paperCreated())

    expect(all).toHaveBeenCalledTimes(1)
    expect(onlyPaper).toHaveBeenCalledTimes(1)
  })

  test('handler 抛错不影响其他 handler 也不传播到 emit 调用方', () => {
    const bus = new WorkspaceEventBus()
    const consoleError = console.error
    console.error = mock(() => {})
    try {
      const throwing = mock(() => {
        throw new Error('boom')
      })
      const safe = mock(() => {})
      bus.on(throwing)
      bus.on(safe)

      expect(() => bus.emit(paperCreated())).not.toThrow()
      expect(throwing).toHaveBeenCalledTimes(1)
      expect(safe).toHaveBeenCalledTimes(1)
    } finally {
      console.error = consoleError
    }
  })

  test('dispose 后所有 handler 不再触发', () => {
    const bus = new WorkspaceEventBus()
    const handler = mock(() => {})
    bus.on(handler)
    bus.dispose()

    bus.emit(paperCreated())

    expect(handler).not.toHaveBeenCalled()
  })

  test('payload 携带 9 kind 之一的字面量 + 必填字段', () => {
    const bus = new WorkspaceEventBus()
    let captured: WorkspaceEvent | undefined
    bus.on((e) => {
      captured = e
    })

    bus.emit(paperCreated('2026-05-25T01:00:00.000Z'))

    expect(captured?.kind).toBe('paper.created')
    expect(captured && 'paperId' in captured ? captured.paperId : undefined).toBe(paperId)
    expect(captured?.at).toBe('2026-05-25T01:00:00.000Z')
  })

  test('模块级单例存在且可独立 dispose', () => {
    const handler = mock(() => {})
    workspaceEventBus.on(handler)
    workspaceEventBus.emit(paperCreated())
    expect(handler).toHaveBeenCalledTimes(1)
    workspaceEventBus.dispose()
    workspaceEventBus.emit(paperCreated())
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
