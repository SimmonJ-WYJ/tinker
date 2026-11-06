import { test, expect } from 'bun:test'
import { pickDefaultModelOnCreate } from './channel-defaults'
import type { Channel } from '@asci/shared'

/** 测试夹具:构造最小可用 Channel,只关心 id + models */
function makeChannel(id: string, models: Array<{ id: string; enabled: boolean }>): Channel {
  return {
    id,
    name: id,
    provider: 'anthropic',
    baseUrl: 'https://example.com',
    apiKey: 'encrypted-key',
    models: models.map((m) => ({ id: m.id, name: m.id, enabled: m.enabled })),
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  }
}

test('全局默认为空 + 渠道有 enabled 模型 → 返回该渠道首个 enabled 模型', () => {
  const channel = makeChannel('ch-1', [
    { id: 'm-disabled', enabled: false },
    { id: 'm-first-enabled', enabled: true },
    { id: 'm-second-enabled', enabled: true },
  ])
  const picked = pickDefaultModelOnCreate(channel, null, null)
  expect(picked).toEqual({ agentChannelId: 'ch-1', agentModelId: 'm-first-enabled' })
})

test('已有 agentChannelId → 不改写,返回 null', () => {
  const channel = makeChannel('ch-new', [{ id: 'm-enabled', enabled: true }])
  const picked = pickDefaultModelOnCreate(channel, 'ch-existing', null)
  expect(picked).toBeNull()
})

test('已有 agentModelId → 不改写,返回 null', () => {
  const channel = makeChannel('ch-new', [{ id: 'm-enabled', enabled: true }])
  const picked = pickDefaultModelOnCreate(channel, null, 'm-existing')
  expect(picked).toBeNull()
})

test('全局默认为空 + 渠道下无 enabled 模型 → 不强制写入,返回 null', () => {
  const channel = makeChannel('ch-1', [
    { id: 'm-a', enabled: false },
    { id: 'm-b', enabled: false },
  ])
  const picked = pickDefaultModelOnCreate(channel, null, null)
  expect(picked).toBeNull()
})

test('全局默认为空 + 渠道模型列表为空 → 返回 null', () => {
  const channel = makeChannel('ch-empty', [])
  const picked = pickDefaultModelOnCreate(channel, null, null)
  expect(picked).toBeNull()
})
