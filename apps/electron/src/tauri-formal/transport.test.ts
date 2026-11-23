import { describe, expect, test } from 'bun:test'
import { createFormalTransport } from './transport.ts'
import type { NativeBridge, NativeEvent, PlatformSnapshot } from './protocol.ts'

const snapshot = (): PlatformSnapshot => ({ version: 1, revision: 0, settings: { theme: 'system', language: 'en' }, userProfile: { userName: 'Local Mock', avatar: 'icon:user' }, workspaces: [], theme: { mode: 'system', isDark: false }, chrome: { platform: 'darwin', fullscreen: false } })
function fixture() {
  const calls: Record<string, unknown>[] = []
  let listener: (event: NativeEvent) => void = () => {}
  let current = snapshot()
  let restoreCount = 0
  const bridge: NativeBridge = {
    listen: async (cb) => { listener = cb; return () => {} },
    request: async <T>(request: Record<string, unknown>): Promise<T> => {
      calls.push(request)
      let value: unknown = null
      if (request.command === 'bootstrap') value = { generation: 'document-1', platformSnapshot: current, activeRuns: [] }
      if (request.command === 'attach') value = { attached: true, activeRuns: [] }
      if (request.command === 'restore') { restoreCount++; value = { restoreToken: 'restore-1', deliverySequence: 10, messages: ['history'], sdkMessages: ['sdk'], activeSnapshot: null, cursor: 1 } }
      if (request.command === 'invoke') {
        if (request.channel === 'settings:update') { current = { ...current, revision: current.revision + 1, settings: { ...current.settings, ...(request.args as object[])[0] } }; value = { value: current.settings, snapshot: current, revision: current.revision } }
        else if (request.channel === 'agent:send-message') throw { code: 'responseFailed' }
        else value = { value: request.args }
      }
      return value as T
    },
  }
  return { bridge, calls, emit: (event: NativeEvent) => listener(event), count: () => restoreCount }
}
const streams = ['agent:stream:event', 'agent:stream:complete', 'agent:stream:error']
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
describe('正式原生 transport', () => {
  test('等待三个订阅者、StrictMode 重挂载与旧 generation 隔离', async () => {
    const f = fixture(); const transport = await createFormalTransport(f.bridge, (code) => `translated:${code}`)
    const received: unknown[] = []
    const off = streams.slice(0, 2).map((c) => transport.subscribe(c, (v) => received.push(v)))
    await tick(); expect(f.calls.some((c) => c.command === 'attach')).toBe(false)
    off.push(transport.subscribe(streams[2]!, (v) => received.push(v)))
    await tick(); expect(f.calls.filter((c) => c.command === 'attach')).toHaveLength(1)
    f.emit({ version: 1, generation: 'old', deliverySequence: 1, channel: streams[0]!, payload: { sessionId: 's' } })
    expect(received).toEqual([])
    off.forEach((fn) => fn()); await tick()
    streams.forEach((c) => transport.subscribe(c, (v) => received.push(v)))
    await tick(); expect(f.calls.filter((c) => c.command === 'attach')).toHaveLength(2)
  })
  test('同步 ack 只承认已持久化内容，串行 mutation 更新 revision', async () => {
    const f = fixture(); const t = await createFormalTransport(f.bridge, (code) => code)
    expect(t.readSync('settings:update-sync', { language: 'zh' })).toBe(false)
    expect(t.readSync('settings:update-sync', { nonexistent: undefined })).toBe(false)
    expect(t.readSync('settings:update-sync', {})).toBe(false)
    await Promise.all([t.invoke('settings:update', { language: 'zh' }), t.invoke('settings:update', { theme: 'dark' })])
    expect(t.readSync('settings:update-sync', { language: 'zh' })).toBe(true)
    expect(f.calls.filter((c) => c.channel === 'settings:update').map((c) => c.mutation)).toEqual([
      { mutationId: expect.any(String), expectedRevision: 0 }, { mutationId: expect.any(String), expectedRevision: 1 },
    ])
  })
  test('history 两 API 同基线，消费者先于 resume；水位只影响该会话', async () => {
    const f = fixture(); const t = await createFormalTransport(f.bridge, (code) => code)
    const seen: unknown[] = []; streams.forEach((c) => t.subscribe(c, (v) => seen.push(v)))
    await tick()
    let historyConsumed = false
    const original = f.bridge.request
    f.bridge.request = async <T>(request: Record<string, unknown>) => {
      if (request.command === 'resume') expect(historyConsumed).toBe(true)
      return original<T>(request)
    }
    const a = t.invoke('agent:get-messages', 's').then((v) => { historyConsumed = true; return v })
    const b = t.invoke('agent:get-sdk-messages', 's')
    expect(await Promise.all([a, b])).toEqual([['history'], ['sdk']]); await tick()
    expect(f.count()).toBe(1)
    f.emit({ version: 1, generation: 'document-1', deliverySequence: 5, channel: streams[0]!, payload: { sessionId: 'other' } })
    f.emit({ version: 1, generation: 'document-1', deliverySequence: 9, channel: streams[1]!, payload: { sessionId: 's' } })
    expect(seen).toEqual([{ sessionId: 'other' }])
  })
  test('SEND 失败保持拒绝并映射原 i18n', async () => {
    const t = await createFormalTransport(fixture().bridge, (code) => `translated:${code}`)
    await expect(t.invoke('agent:send-message', {})).rejects.toThrow('translated:responseFailed')
  })
  test('同 revision 原生环境更新不会被迟到 mutation ack 覆盖', async () => {
    const f = fixture(); const t = await createFormalTransport(f.bridge, (code) => code)
    const original = f.bridge.request
    let release = () => {}
    let mutationSnapshot: PlatformSnapshot | undefined
    f.bridge.request = async <T>(request: Record<string, unknown>): Promise<T> => {
      const reply = await original<{ snapshot?: PlatformSnapshot }>(request)
      if (request.channel === 'settings:update') {
        mutationSnapshot = reply.snapshot
        await new Promise<void>((resolve) => { release = resolve })
      }
      return reply as T
    }
    const write = t.invoke('settings:update', { language: 'zh' })
    await tick()
    f.emit({ kind: 'environment', sequence: 2, snapshot: { ...mutationSnapshot!, theme: { mode: 'system', isDark: true } } })
    release(); await write
    f.emit({ kind: 'environment', sequence: 1, snapshot: mutationSnapshot! })
    expect(t.readSync('theme:resolve')).toEqual({ mode: 'system', isDark: true })
    expect(t.readSync('settings:update-sync', { language: 'zh' })).toBe(true)
  })
})

test('restore 超时会解除本地暂停，并以实际 observed 重挂载', async () => {
  const f = fixture(); const original = f.bridge.request
  f.bridge.request = <T>(request: Record<string, unknown>): Promise<T> => request.command === 'restore' ? new Promise<T>(() => {}) : original<T>(request)
  const t = await createFormalTransport(f.bridge, (code) => code, { restoreTimeoutMs: 5 })
  const seen: unknown[] = []; streams.forEach((c) => t.subscribe(c, (v) => seen.push(v)))
  const outcome = await Promise.race([t.invoke('agent:get-messages', 's').then(() => 'resolved', () => 'rejected'), new Promise<string>((resolve) => setTimeout(() => resolve('stuck'), 25))])
  expect(outcome).toBe('rejected')
  f.emit({ version: 1, generation: 'document-1', deliverySequence: 15, channel: streams[0]!, payload: { sessionId: 's' } })
  expect(seen).toEqual([{ sessionId: 's' }]); expect(f.calls.filter((c) => c.command === 'attach')).toHaveLength(2)
})

test('bootstrap 环境水位隔离旧 document 排队的同 revision 环境快照', async () => {
  const f = fixture(); const original = f.bridge.request
  f.bridge.request = async <T>(request: Record<string, unknown>): Promise<T> => {
    const result = await original<Record<string, unknown>>(request)
    if (request.command === 'bootstrap') return { ...result, environmentSequence: 5, platformSnapshot: { ...snapshot(), theme: { mode: 'system', isDark: true } } } as T
    return result as T
  }
  const t = await createFormalTransport(f.bridge, (code) => code)
  f.emit({ kind: 'environment', sequence: 4, snapshot: snapshot() })
  expect(t.readSync('theme:resolve')).toEqual({ mode: 'system', isDark: true })
})

test('resume 的 COMPLETE 早于 RPC reply 时，刷新不能复用旧 history bundle', async () => {
  const f = fixture(); const original = f.bridge.request
  let release = () => {}; let restores = 0; let resumes = 0
  f.bridge.request = async <T>(request: Record<string, unknown>): Promise<T> => {
    const result = await original<Record<string, unknown>>(request)
    if (request.command === 'restore') return { ...result, sdkMessages: [`sdk-${++restores}`] } as T
    if (request.command === 'resume' && ++resumes === 1) await new Promise<void>((resolve) => { release = resolve })
    return result as T
  }
  const t = await createFormalTransport(f.bridge, (code) => code)
  t.subscribe(streams[0]!, () => {}); t.subscribe(streams[2]!, () => {})
  let refreshed: Promise<unknown> = Promise.resolve()
  t.subscribe(streams[1]!, () => { refreshed = t.invoke('agent:get-sdk-messages', 's') })
  expect(await t.invoke('agent:get-sdk-messages', 's')).toEqual(['sdk-1'])
  await tick()
  f.emit({ version: 1, generation: 'document-1', deliverySequence: 11, channel: streams[1]!, payload: { sessionId: 's', requestId: 'one' } })
  const result = await refreshed; release()
  expect(result).toEqual(['sdk-2'])
})

test('bootstrap 在途环境按 revision/sequence 重放，旧事件不能覆盖新事实', async () => {
  const f = fixture(); const original = f.bridge.request
  f.bridge.request = async <T>(request: Record<string, unknown>): Promise<T> => {
    const result = await original<Record<string, unknown>>(request)
    if (request.command === 'bootstrap') {
      f.emit({ kind: 'environment', sequence: 7, snapshot: { ...snapshot(), revision: 1, theme: { mode: 'system', isDark: true }, chrome: { platform: 'darwin', fullscreen: true } } })
      f.emit({ kind: 'environment', sequence: 6, snapshot: snapshot() })
      return { ...result, environmentSequence: 5 } as T
    }
    return result as T
  }
  const t = await createFormalTransport(f.bridge, (code) => code)
  expect(t.readSync('theme:resolve')).toEqual({ mode: 'system', isDark: true })
  expect(t.readSync('window:chrome-state')).toEqual({ platform: 'darwin', fullscreen: true })
  expect(t.bootstrap.platformSnapshot.theme.isDark).toBe(true)
  f.emit({ kind: 'environment', sequence: 8, snapshot: snapshot() })
  f.emit({ kind: 'environment', sequence: 7, snapshot: snapshot() })
  expect(t.revision).toBe(1)
  expect(t.readSync('theme:resolve')).toEqual({ mode: 'system', isDark: true })
})

test('attach/detach/attach 等待真实确认，restore 不得越过初次 attach', async () => {
  const f = fixture(); const original = f.bridge.request
  let release = () => {}; let attached = false; let first = true
  const dispatched: string[] = []
  f.bridge.request = async <T>(request: Record<string, unknown>): Promise<T> => {
    const name = String(request.command); dispatched.push(name)
    if (name === 'attach' && first) { first = false; await new Promise<void>((resolve) => { release = resolve }) }
    if (name === 'attach') attached = true
    if (name === 'detach') attached = false
    if (name === 'restore') expect(attached).toBe(true)
    return original<T>(request)
  }
  const t = await createFormalTransport(f.bridge, (code) => code)
  const off = streams.map((c) => t.subscribe(c, () => {}))
  await tick(); off.forEach((fn) => fn()); streams.forEach((c) => t.subscribe(c, () => {}))
  const history = t.invoke('agent:get-messages', 's')
  await tick()
  expect(dispatched).toEqual(['bootstrap', 'attach'])
  release(); await history; await tick()
  expect(dispatched.slice(0, 5)).toEqual(['bootstrap', 'attach', 'detach', 'attach', 'restore'])
  expect(attached).toBe(true)
  t.dispose(); await tick(); expect(attached).toBe(false)
})

test('attach 失败恢复和 dispose 的晚 ack 均经同一有序通道', async () => {
  const f = fixture(); const original = f.bridge.request
  let attempts = 0; let release = () => {}; let attached = false
  f.bridge.request = async <T>(request: Record<string, unknown>): Promise<T> => {
    if (request.command === 'attach') {
      if (++attempts === 1) throw { code: 'hostBusy' }
      await new Promise<void>((resolve) => { release = resolve }); attached = true
    }
    if (request.command === 'detach') attached = false
    return original<T>(request)
  }
  const t = await createFormalTransport(f.bridge, (code) => code)
  streams.forEach((c) => t.subscribe(c, () => {})); await tick()
  expect(attempts).toBe(2)
  t.dispose(); release(); await tick(); await tick()
  expect(attached).toBe(false)
})

test('初次 attach 确认迟到时 history 仍有期限，恢复不能越过原控制请求', async () => {
  const f = fixture(); const original = f.bridge.request
  let release = () => {}; let first = true
  f.bridge.request = async <T>(request: Record<string, unknown>): Promise<T> => {
    if (request.command === 'attach' && first) { first = false; await new Promise<void>((resolve) => { release = resolve }) }
    return original<T>(request)
  }
  const t = await createFormalTransport(f.bridge, (code) => code, { restoreTimeoutMs: 5 })
  streams.forEach((c) => t.subscribe(c, () => {}))
  const outcome = await Promise.race([t.invoke('agent:get-messages', 's').then(() => 'resolved', () => 'rejected'), new Promise<string>((resolve) => setTimeout(() => resolve('stuck'), 30))])
  release(); await tick(); await tick()
  expect(outcome).toBe('rejected')
  expect(f.calls.some((c) => c.command === 'restore')).toBe(false)
  t.dispose()
})

test('未完成的只读搜索不阻塞关闭；已释放窗口拒绝迟到结果', async () => {
  const f = fixture()
  const request = f.bridge.request
  let finish!: () => void
  f.bridge.request = async <T,>(command: Record<string, unknown>): Promise<T> => {
    if (command.channel !== 'agent:search-messages') return request<T>(command)
    await new Promise<void>(resolve => { finish = resolve })
    return { value: [] } as T
  }
  const t = await createFormalTransport(f.bridge, code => code)
  const search = t.invoke('agent:search-messages', 'hello')
  try {
    t.setClosing(true)
    const drained = await Promise.race([t.quiesce().then(() => true), tick().then(() => false)])
    expect(drained).toBe(true)
  } finally {
    t.dispose()
    finish()
    await expect(search).rejects.toThrow('staleGeneration')
  }
})

test('restore translates fixed provider errors only in error fields and failed tool results', async () => {
  const bridge:NativeBridge={
    listen:async()=>()=>{},
    async request<T>(req:Record<string, unknown>):Promise<T> {
      if(req.command==='bootstrap') return {generation:'doc',platformSnapshot:snapshot(),activeRuns:[]} as T
      if(req.command==='restore') return {restoreToken:'r',deliverySequence:0,messages:[],sdkMessages:[
        {type:'user',message:{content:'channelUnauthorized'}},
        {type:'assistant',error:{message:'channelTimeout',errorType:'httpTimeout'}},
        {type:'user',message:{content:[
          {type:'tool_result',is_error:true,content:'channelPaymentRequired'},
          {type:'tool_result',is_error:false,content:'channelPaymentRequired'},
        ]}},
      ],activeSnapshot:null} as T
      return {} as T
    }
  }
  const t=await createFormalTransport(bridge,code=>'localized:'+code)
  for(const event of ['event','error','complete']) t.subscribe('agent:stream:'+event,()=>{})
  expect(await t.invoke('agent:get-sdk-messages','s')).toMatchObject([
    {message:{content:'channelUnauthorized'}},{error:{message:'localized:channelTimeout',errorType:'httpTimeout'}},
    {message:{content:[{content:'localized:channelPaymentRequired'},{content:'channelPaymentRequired'}]}},
  ])
  t.dispose()
})
