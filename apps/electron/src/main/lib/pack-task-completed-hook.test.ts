/**
 * pack-task-completed-hook 行为单测（spec §3.1 #9）
 *
 * 覆盖：
 *   - lookup 命中 capability-pack → emit pack.taskCompleted
 *   - lookup 未命中（builtin / user-config / 子 Agent）→ 不 emit
 *   - lookup 抛错 → swallow，不抛到调用方，不 emit
 *   - success 字段：undefined 默认 true；显式 false 透传
 */

import { afterEach, describe, expect, mock, test } from 'bun:test'

import type { WorkspaceEvent } from '@asci/shared'

import {
  createPackTaskCompletedHook,
  type ScenarioPackLookup,
} from './pack-task-completed-hook.ts'
import { workspaceEventBus } from './workspace-event-bus.ts'

interface StopInput {
  hook_event_name: 'SubagentStop'
  /** SDK 0.2.119 现行字段 */
  agent_type?: string
  /** SDK 旧字段（兜底） */
  subagent_type?: string
  success?: boolean
}

function captureEvents(): { events: WorkspaceEvent[]; off: () => void } {
  const events: WorkspaceEvent[] = []
  const off = workspaceEventBus.on('pack.taskCompleted', (e) => {
    events.push(e)
  })
  return { events, off }
}

afterEach(() => {
  workspaceEventBus.dispose()
})

describe('createPackTaskCompletedHook', () => {
  test('lookup 命中 capability-pack scenario Agent → emit pack.taskCompleted', () => {
    const lookup: ScenarioPackLookup = (name) =>
      name === 'lit-search' ? { packId: 'lit-search', scenarioAgentName: name } : null
    const hooks = createPackTaskCompletedHook('session-1', lookup)
    const { events } = captureEvents()

    const onStop = hooks.SubagentStop[0]!.hooks[0]!
    onStop({ hook_event_name: 'SubagentStop', agent_type: 'lit-search', success: true } as StopInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'pack.taskCompleted',
      packId: 'lit-search',
      scenarioAgentName: 'lit-search',
      sessionId: 'session-1',
      success: true,
    })
  })

  test('兜底：SDK 旧字段 subagent_type 仍能解析（防字段再漂移）', () => {
    const lookup: ScenarioPackLookup = (name) =>
      name === 'lit-search' ? { packId: 'lit-search', scenarioAgentName: name } : null
    const hooks = createPackTaskCompletedHook('session-1', lookup)
    const { events } = captureEvents()

    const onStop = hooks.SubagentStop[0]!.hooks[0]!
    onStop({ hook_event_name: 'SubagentStop', subagent_type: 'lit-search', success: true } as StopInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ packId: 'lit-search' })
  })

  test('lookup 未命中（builtin / 子 Agent）→ 不 emit', () => {
    const lookup: ScenarioPackLookup = () => null
    const hooks = createPackTaskCompletedHook('session-1', lookup)
    const { events } = captureEvents()

    const onStop = hooks.SubagentStop[0]!.hooks[0]!
    onStop({ hook_event_name: 'SubagentStop', agent_type: 'searcher', success: true } as StopInput)

    expect(events).toHaveLength(0)
  })

  test('lookup 抛错 → swallow，不抛到调用方，不 emit', () => {
    const lookup: ScenarioPackLookup = () => {
      throw new Error('registry 异常')
    }
    const hooks = createPackTaskCompletedHook('session-1', lookup)
    const { events } = captureEvents()
    const consoleError = console.error
    console.error = mock(() => {})
    try {
      const onStop = hooks.SubagentStop[0]!.hooks[0]!
      expect(() =>
        onStop({ hook_event_name: 'SubagentStop', agent_type: 'lit-search' } as StopInput),
      ).not.toThrow()
    } finally {
      console.error = consoleError
    }
    expect(events).toHaveLength(0)
  })

  test('success 缺省时默认 true；显式 false 透传', () => {
    const lookup: ScenarioPackLookup = (name) => ({ packId: name, scenarioAgentName: name })
    const hooks = createPackTaskCompletedHook('session-1', lookup)
    const { events } = captureEvents()
    const onStop = hooks.SubagentStop[0]!.hooks[0]!

    onStop({ hook_event_name: 'SubagentStop', agent_type: 'lit-search' } as StopInput)
    onStop({
      hook_event_name: 'SubagentStop',
      agent_type: 'lit-review',
      success: false,
    } as StopInput)

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ packId: 'lit-search', success: true })
    expect(events[1]).toMatchObject({ packId: 'lit-review', success: false })
  })

  describe('D2 sticky write (ADR-004 D-C)', () => {
    test('lookup 命中 + success 默认 true → 调 markSticky 写 packId', () => {
      const lookup: ScenarioPackLookup = (name) => ({ packId: name, scenarioAgentName: name })
      const sticky: string[] = []
      const hooks = createPackTaskCompletedHook('session-1', lookup, {
        markSticky: (packId) => sticky.push(packId),
      })
      captureEvents()
      const onStop = hooks.SubagentStop[0]!.hooks[0]!

      onStop({ hook_event_name: 'SubagentStop', agent_type: 'lit-search' } as StopInput)

      expect(sticky).toEqual(['lit-search'])
    })

    test('lookup 命中 + success === false → 不调 markSticky（事件仍 emit）', () => {
      const lookup: ScenarioPackLookup = (name) => ({ packId: name, scenarioAgentName: name })
      const sticky: string[] = []
      const hooks = createPackTaskCompletedHook('session-1', lookup, {
        markSticky: (packId) => sticky.push(packId),
      })
      const { events } = captureEvents()
      const onStop = hooks.SubagentStop[0]!.hooks[0]!

      onStop({
        hook_event_name: 'SubagentStop',
        agent_type: 'lit-search',
        success: false,
      } as StopInput)

      expect(sticky).toEqual([])
      // 事件仍按 success: false 透传（下游审计 / 重试需要看到失败收口）
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ packId: 'lit-search', success: false })
    })

    test('lookup 未命中（worker 子 Agent） → 不调 markSticky', () => {
      const lookup: ScenarioPackLookup = () => null
      const sticky: string[] = []
      const hooks = createPackTaskCompletedHook('session-1', lookup, {
        markSticky: (packId) => sticky.push(packId),
      })
      captureEvents()
      const onStop = hooks.SubagentStop[0]!.hooks[0]!

      onStop({
        hook_event_name: 'SubagentStop',
        agent_type: 'searcher',
        success: true,
      } as StopInput)

      expect(sticky).toEqual([])
    })

    test('多轮成功收口 → 每次都覆盖 sticky（D2 = 最近一次成功的包）', () => {
      const lookup: ScenarioPackLookup = (name) => ({ packId: name, scenarioAgentName: name })
      const sticky: string[] = []
      const hooks = createPackTaskCompletedHook('session-1', lookup, {
        markSticky: (packId) => sticky.push(packId),
      })
      captureEvents()
      const onStop = hooks.SubagentStop[0]!.hooks[0]!

      onStop({ hook_event_name: 'SubagentStop', agent_type: 'lit-search' } as StopInput)
      onStop({ hook_event_name: 'SubagentStop', agent_type: 'lit-review' } as StopInput)

      expect(sticky).toEqual(['lit-search', 'lit-review'])
    })

    test('未提供 markSticky → 行为完全等同旧 caller（不抛错）', () => {
      const lookup: ScenarioPackLookup = (name) => ({ packId: name, scenarioAgentName: name })
      const hooks = createPackTaskCompletedHook('session-1', lookup)
      captureEvents()
      const onStop = hooks.SubagentStop[0]!.hooks[0]!

      expect(() =>
        onStop({ hook_event_name: 'SubagentStop', agent_type: 'lit-search' } as StopInput),
      ).not.toThrow()
    })
  })
})
