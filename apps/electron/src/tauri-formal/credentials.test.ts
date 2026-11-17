import { expect, test } from 'bun:test'
import { createDesktopApi } from '../preload/api.ts'
import { createFormalTransport } from './transport.ts'
import type { NativeBridge } from './protocol.ts'
import type { Channel } from '@asci/shared'

const item: Channel = {
  id: 'owned',
  name: 'Owned',
  provider: 'custom-openai',
  baseUrl: 'https://owned.invalid/v1',
  apiKey: '',
  models: [{
    id: 'plain',
    name: 'Plain',
    enabled: true
  }],
  enabled: true,
  createdAt: 0,
  updatedAt: 0
}

function fixture() {
  const calls: Record<string, unknown>[] = []
  let revision = 0
  let lost = false
  let final: Record<string, unknown> | undefined
  let release: (() => void) | undefined
  const snapshot = () => ({
    version: 1,
    revision,
    settings: {},
    theme: {},
    chrome: {}
  })
  const bridge: NativeBridge = {
    listen: async () => () => {},
    request: async<T,>(r: Record<string, unknown>): Promise<T> => {
      calls.push(structuredClone(r))
      if (r.command === 'bootstrap') return {
        credentialedChannels: true,
        queueing: false,
        generation: 'doc',
        activeRuns: [],
        platformSnapshot: snapshot()
      } as T
      if (r.channel === 'channel:list') return {
        value: [{
          ...item,
          hasCredential: true
        }]
      } as T
      if (r.channel === 'channel:stage') {
        const input = (r.args as {
          request: Record<string, unknown>
          secret: string
        }[])[0]!
        const request = structuredClone(input.request)
        const a = request.args as {
          credential: unknown
        }[]
        a[0]!.credential = {
          replace: 'a'.repeat(32)
        }
        return {
          value: request
        } as T
      }
      if (r.channel === 'channel:create' || r.channel === 'channel:update' || r.channel === 'channel:delete') {
        if (release) {
          await new Promise<void>(resolve => {
            release = resolve
          })
          release = undefined
        }
        final = r
        if (lost) {
          lost = false
          throw {
            code: 'runtimeUnavailable'
          }
        }
        revision++
        return {
          value: item,
          snapshot: snapshot()
        } as T
      }
      return {
        value: null
      } as T
    }
  }
  return {
    calls,
    bridge,
    lose: () => {
      lost = true
    },
    hold: () => {
      release = () => {}
    },
    release: () => release?.(),
    last: () => final
  }
}

test('managed capability and explicit stage normalize original preload writes without public keys', async () => {
  const f = fixture()
  const t = await createFormalTransport(f.bridge, c => c)
  const api = createDesktopApi(t)
  expect(await api.getChannelCredentialMode?.()).toBe('managed')
  await api.listChannels()
  await api.updateChannel('owned', {
    name: 'Alias',
    apiKey: 'fake-unsaved'
  })
  const stage = f.calls.find(c => c.channel === 'channel:stage')!
  expect(stage).not.toHaveProperty('mutation')
  expect(stage.args).toMatchObject([{
    secret: 'fake-unsaved',
    request: {
      version: 1,
      channel: 'channel:update',
      mutation: {
        expectedRevision: 0
      },
      args: [{
        channel: {
          id: 'owned',
          name: 'Alias',
          protocol: 'openai-chat',
          models: [{
            modelId: 'plain',
            label: 'Plain',
            supportedEfforts: [],
            enabled: true
          }]
        },
        credential: 'keep'
      }]
    }
  }])
  const saved = f.calls.find(c => c.channel === 'channel:update')!
  expect(saved.args).toMatchObject([{
    credential: {
      replace: 'a'.repeat(32)
    }
  }])
  expect(JSON.stringify(saved)).not.toContain('fake-unsaved')
  expect(t.revision).toBe(1)
  t.dispose()
})

test('managed blank Keep, saved GET, delete and settings share durable lane', async () => {
  const f = fixture()
  const t = await createFormalTransport(f.bridge, c => c)
  const api = createDesktopApi(t)
  await api.listChannels()
  await api.testChannel('owned')
  await api.fetchModels('owned')
  expect(f.calls.filter(c => c.channel === 'channel:stage')).toHaveLength(0)
  f.hold()
  const save = api.updateChannel('owned', {
    name: 'Alias',
    apiKey: ''
  })
  const settings = api.updateSettings({
    language: 'zh'
  })
  let quiet = false
  const q = t.quiesce().then(() => quiet = true)
  await new Promise(r => setTimeout(r, 0))
  expect(quiet).toBe(false)
  expect(t.revision).toBe(0)
  expect(f.calls.some(c => c.channel === 'settings:update')).toBe(false)
  expect(f.calls.find(c => c.channel === 'channel:update')?.args).toMatchObject([{
    credential: 'keep'
  }])
  f.release()
  await save
  await settings
  await q
  await api.deleteChannel('owned')
  expect(f.calls.find(c => c.channel === 'channel:delete')).toMatchObject({
    args: ['owned'],
    mutation: {
      expectedRevision: 1
    }
  })
  t.setClosing(true)
  await expect(api.testChannel('owned')).rejects.toThrow('closing')
  t.dispose()
})

test('lost final ack reuses exact normalized mutation and rejects changed intent before another stage', async () => {
  const f = fixture()
  const t = await createFormalTransport(f.bridge, c => c)
  const api = createDesktopApi(t)
  await api.listChannels()
  f.lose()
  await expect(api.updateChannel('owned', {
    name: 'Alias',
    apiKey: 'fake-one',
    credentialIntentId: 'save-one'
  })).rejects.toThrow('runtimeUnavailable')
  await expect(api.updateChannel('owned', {
    name: 'Alias',
    apiKey: 'fake-two'
  })).rejects.toThrow('mutationPending')
  expect(f.calls.filter(c => c.channel === 'channel:stage')).toHaveLength(1)
  expect(t.revision).toBe(0)
  await api.updateChannel('owned', {
    name: 'Alias',
    apiKey: 'fake-one',
    credentialIntentId: 'save-one'
  })
  const writes = f.calls.filter(c => c.channel === 'channel:update')
  expect(writes[1]).toEqual(writes[0])
  t.dispose()
})

test('managed changed binding without replacement rejects before stage or final mutation', async () => {
  const f = fixture()
  const t = await createFormalTransport(f.bridge, c => c)
  const api = createDesktopApi(t)
  await api.listChannels()
  await expect(api.updateChannel('owned', {
    baseUrl: 'https://other.invalid/v1',
    apiKey: ''
  })).rejects.toThrow('credentialReplacementRequired')
  expect(f.calls).toHaveLength(2)
  t.dispose()
})

test('private stage lost ack is frozen without restaging, new document restores only public state', async () => {
  const f = fixture()
  let fail = true
  const bridge: NativeBridge = {
    ...f.bridge,
    request: async<T,>(r: Record<string, unknown>): Promise<T> => {
      const value = await f.bridge.request<T>(r)
      if (fail && r.channel === 'channel:stage') {
        fail = false
        throw {
          code: 'runtimeUnavailable'
        }
      }
      return value
    }
  }
  const t = await createFormalTransport(bridge, c => c)
  const api = createDesktopApi(t)
  await api.listChannels()
  const patch = {
    name: 'Alias',
    apiKey: 'fake-one',
    credentialIntentId: 'intent'
  }
  await expect(api.updateChannel('owned', patch)).rejects.toThrow('runtimeUnavailable')
  await expect(api.updateChannel('owned', patch)).rejects.toThrow('stageUncertain')
  await expect(api.updateSettings({
    language: 'zh'
  })).rejects.toThrow('mutationPending')
  expect(f.calls.filter(c => c.channel === 'channel:stage')).toHaveLength(1)
  expect(f.calls.filter(c => c.channel === 'channel:update')).toHaveLength(0)
  t.dispose()
  const before = f.calls.length
  const reopened = await createFormalTransport(bridge, c => c)
  await createDesktopApi(reopened).listChannels()
  expect(f.calls.slice(before).filter(c => c.command !== 'detach').map(c => c.channel ?? c.command)).toEqual(['bootstrap', 'channel:list'])
  reopened.dispose()
})

test('new original channel uses explicit codec and complete models, invalid provider never stages', async () => {
  const f = fixture()
  const t = await createFormalTransport(f.bridge, c => c)
  const api = createDesktopApi(t)
  await api.createChannel({
    name: 'New',
    provider: 'custom-anthropic',
    baseUrl: item.baseUrl,
    apiKey: 'fake-new',
    models: item.models,
    enabled: true
  })
  expect(f.calls.find(c => c.channel === 'channel:create')).toMatchObject({
    args: [{
      channel: {
        name: 'New',
        protocol: 'anthropic-messages',
        models: [{
          modelId: 'plain',
          label: 'Plain',
          supportedEfforts: [],
          enabled: true
        }]
      },
      credential: {
        replace: 'a'.repeat(32)
      }
    }]
  })
  const count = f.calls.length
  await expect(api.createChannel({
    name: 'Unknown',
    provider: 'custom-image',
    baseUrl: item.baseUrl,
    apiKey: 'fake-new',
    models: item.models,
    enabled: true
  })).rejects.toThrow('unsupportedProvider')
  expect(f.calls).toHaveLength(count)
  t.dispose()
})

test('actual transport timeout preserves final mutation and staged reference for unchanged explicit retry', async () => {
  const f = fixture()
  let hold = true
  const bridge: NativeBridge = {
    ...f.bridge,
    request: async<T,>(r: Record<string, unknown>): Promise<T> => {
      if (r.channel === 'channel:update' && hold) {
        hold = false
        await f.bridge.request(r)
        return await new Promise<T>(() => {})
      }
      return f.bridge.request<T>(r)
    }
  }
  const t = await createFormalTransport(bridge, c => c, {
    commandTimeoutMs: 10
  })
  const api = createDesktopApi(t)
  await api.listChannels()
  const patch = {
    name: 'Alias',
    apiKey: 'fake-timeout',
    credentialIntentId: 'timeout-intent'
  }
  await expect(api.updateChannel('owned', patch)).rejects.toThrow('transportTimeout')
  await api.updateChannel('owned', patch)
  expect(f.calls.filter(c => c.channel === 'channel:stage')).toHaveLength(1)
  const writes = f.calls.filter(c => c.channel === 'channel:update')
  expect(writes[1]).toEqual(writes[0])
  t.dispose()
})

test('explicit managed probe waits for staged mutation lane and quiesce waits for both', async () => {
  const f = fixture()
  const t = await createFormalTransport(f.bridge, c => c)
  const api = createDesktopApi(t)
  await api.listChannels()
  f.hold()
  const save = api.updateChannel('owned', {
    apiKey: 'fake-held'
  })
  const probe = api.testChannel('owned')
  let quiet = false
  const q = t.quiesce().then(() => quiet = true)
  await new Promise(r => setTimeout(r, 0))
  expect(f.calls.some(c => c.channel === 'channel:test')).toBe(false)
  expect(quiet).toBe(false)
  f.release()
  await save
  await probe
  await q
  expect(f.calls.filter(c => c.channel === 'channel:test')).toHaveLength(1)
  t.dispose()
})

test('queued explicit probe rechecks local intent cancellation before any host GET', async () => {
  const f = fixture()
  const t = await createFormalTransport(f.bridge, c => c)
  const api = createDesktopApi(t)
  await api.listChannels()
  f.hold()
  const save = api.updateChannel('owned', {
    apiKey: 'fake-held'
  })
  const intent = new AbortController()
  const probe = api.testChannel('owned', {
    signal: intent.signal
  })
  const observed = probe.then(() => ({
    code: 'resolved'
  }), (error: unknown) => error)
  await new Promise(r => setTimeout(r, 0))
  intent.abort()
  f.release()
  await save
  const error = await observed
  expect(error).toMatchObject({
    code: 'probeCancelled'
  })
  expect(f.calls.some(c => c.channel === 'channel:test')).toBe(false)
  t.dispose()
})
