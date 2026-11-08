import { expect, test } from 'bun:test'
import { decodeRunPage, decodeRunSnapshot } from './run-contract.ts'
import type { RunPage, RunRecord, RunSnapshot } from './run-contract.ts'

const snapshot: RunSnapshot = { protocolVersion: 1, runId: 'run-1', requestId: 'run-1', providerKind: 'offlineFixture', scenario: 'success', input: '合成输入', output: '部分输出', status: 'running', sequence: 2, errorCode: null, recoveryRequired: false }
const event: RunRecord = { protocolVersion: 1, runId: 'run-1', sequence: 2, kind: 'delta', text: '部分输出', errorCode: null }
const page: RunPage = { protocolVersion: 1, snapshot, events: [event], nextAfterSequence: 2, hasMore: false }

test('离线执行契约保留合法快照及有界事件页', () => {
  expect(decodeRunSnapshot(snapshot)).toEqual(snapshot)
  expect(decodeRunPage(page, 1)).toEqual(page)
  expect(decodeRunPage({ ...page, events: [], nextAfterSequence: 2 }, 2).events).toEqual([])
})

test('离线快照拒绝未来协议、非法身份、状态及 UTF-8 超限', () => {
  for (const change of [
    { protocolVersion: 2 }, { runId: '../run' }, { runId: 'r'.repeat(65) }, { requestId: '' },
    { providerKind: 'model' }, { scenario: 'network' }, { status: 'unknown' }, { sequence: -1 },
    { sequence: Number.MAX_SAFE_INTEGER + 1 }, { input: '中'.repeat(21846) },
    { output: '中'.repeat(87382) }, { errorCode: undefined }, { recoveryRequired: 1 },
  ]) expect(() => decodeRunSnapshot({ ...snapshot, ...change })).toThrow('protocolMismatch')
})

test('离线事件页拒绝过大、混入其他 run、乱序和超前游标', () => {
  for (const change of [
    { events: Array(257).fill(event) }, { events: [{ ...event, protocolVersion: 2 }] },
    { events: [{ ...event, runId: 'other' }] }, { events: [{ ...event, kind: 'unknown' }] },
    { events: [{ ...event, text: '中'.repeat(5500) }] }, { events: [event, event] },
    { events: [{ ...event, sequence: 3 }] }, { nextAfterSequence: 1 }, { nextAfterSequence: 3 },
    { hasMore: true }, { hasMore: 'yes' }, { protocolVersion: 2 },
    { events: [], nextAfterSequence: 1, hasMore: true },
  ]) expect(() => decodeRunPage({ ...page, ...change }, 1)).toThrow('protocolMismatch')
  expect(() => decodeRunPage(page, 2)).toThrow('protocolMismatch')
})


test('离线快照身份必须一致，事件连续且符合种类语义', () => {
  expect(() => decodeRunSnapshot({ ...snapshot, requestId: 'other-request' })).toThrow('protocolMismatch')
  expect(() => decodeRunPage(page, 0)).toThrow('protocolMismatch')
  for (const change of [
    { text: null }, { errorCode: 'unexpected' },
    { kind: 'started', text: 'invalid' }, { kind: 'started', text: null, errorCode: 'unexpected' },
    { kind: 'completed', text: 'invalid' }, { kind: 'completed', text: null, errorCode: 'unexpected' },
    { kind: 'cancelled', text: 'invalid' }, { kind: 'cancelled', text: null, errorCode: 'unexpected' },
    { kind: 'failed', text: 'invalid' }, { kind: 'interrupted', text: 'invalid' },
  ]) expect(() => decodeRunPage({ ...page, events: [{ ...event, ...change }] }, 1)).toThrow('protocolMismatch')
})
