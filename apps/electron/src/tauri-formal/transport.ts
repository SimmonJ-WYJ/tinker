/** 单 native listener、串行平台写入、按会话恢复屏障；不包含 Node 或 Electron。 */
import { createQueueFrames } from './queue-frames.ts'
import { createQueueControl, NativeQueueError } from './queue-control.ts'
import { withDeadline } from './deadline.ts'
import type { PlatformTransport } from '../preload/transport.ts'
import type { ActiveRun, Bootstrap, NativeBridge, NativeEvent, PlatformSnapshot, RestoreBundle } from './protocol.ts'
import { MUTATION_CHANNELS, STREAM_CHANNELS } from './protocol.ts'

export interface FormalTransport extends PlatformTransport {
  readonly bootstrap: Bootstrap
  readonly revision: number
  command<T>(command: string, args?: Record<string, unknown>): Promise<T>
  quiesce(): Promise<void>
  setClosing(value: boolean): void
  onAction(callback: (action: 'close' | 'reload') => void): void
  dispose(): void
}
export async function createFormalTransport(native: NativeBridge, translate: (code: string) => string, options: { restoreTimeoutMs?: number; commandTimeoutMs?: number } = {}): Promise<FormalTransport> {
  const callbacks = new Map<string, Set<(value: unknown) => void>>()
  const observed: Record<string, number> = {}
  const watermarks = new Map<string, number>()
  const paused = new Set<string>()
  const completed = new Set<string>()
  const frames = createQueueFrames()
  const restores = new Map<string, Promise<RestoreBundle>>()
  const fast = new Set<Promise<unknown>>()
  let queue: ReturnType<typeof createQueueControl> | undefined
  let bootstrap: Bootstrap
  let cache: PlatformSnapshot
  let lane: Promise<unknown> = Promise.resolve()
  let environmentSequence = 0
  let attached: boolean | undefined = false
  let requested = false
  let controlLane: Promise<void> = Promise.resolve()
  const readyWaiters = new Set<() => void>()
  let pendingEnvironment: Extract<NativeEvent, { kind: 'environment' }> | undefined
  let disposed = false
  let closing = false
  let actionHandler: ((action: 'close' | 'reload') => void) | undefined
  const ready = () => STREAM_CHANNELS.every((c) => (callbacks.get(c)?.size ?? 0) > 0)
  const publish = (channel: string, value: unknown) => {
    for (const callback of callbacks.get(channel) ?? []) callback(projectErrors(value))
  }
  function dispatchStream(channel:string,payload:{sessionId:string;[key:string]:unknown}) {
    const identity=typeof payload.requestId==='string' ? JSON.stringify([payload.sessionId,payload.requestId]) : undefined
    if(identity && completed.has(identity))return
    if(identity && channel==='agent:stream:complete')completed.add(identity)
    queue?.observe(channel,payload)
    publish(channel,payload)
  }
  function projectErrors(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(projectErrors)
    if (!value || typeof value !== 'object') return value
    const result: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) result[key] = key === 'error' && typeof v === 'string' ? translate(v) : key === 'message' && (v === 'responseFailed' || v === 'catalogValidated') ? translate(v) : projectErrors(v)
    return result
  }
  function snapshot(next: PlatformSnapshot, environment = false) {
    if (next.revision < cache.revision || (!environment && next.revision === cache.revision)) return
    const previous = cache
    cache = next
    if (JSON.stringify(previous.theme) !== JSON.stringify(next.theme)) publish('theme:changed', next.theme)
    if (JSON.stringify(previous.chrome) !== JSON.stringify(next.chrome)) publish('window:chrome-changed', next.chrome)
    if (JSON.stringify(previous.settings.onboardingSpotlight) !== JSON.stringify(next.settings.onboardingSpotlight)) publish('onboarding-spotlight:changed', next.settings.onboardingSpotlight)
    if (JSON.stringify(previous.settings.conceptSpotlight) !== JSON.stringify(next.settings.conceptSpotlight)) publish('concept-spotlight:changed', next.settings.conceptSpotlight)
  }
  const unlisten = await native.listen((event: NativeEvent) => {
    if (disposed) return
    if (!bootstrap) {
      if ('kind' in event && event.kind === 'environment' && (!pendingEnvironment || event.snapshot.revision > pendingEnvironment.snapshot.revision || (event.snapshot.revision === pendingEnvironment.snapshot.revision && event.sequence > pendingEnvironment.sequence))) pendingEnvironment = event
      return
    }
    if ('kind' in event) {
      if (event.kind === 'environment' && event.sequence > environmentSequence) { environmentSequence = event.sequence; snapshot(event.snapshot, true) }
      else if (event.kind === 'action') {
        if (event.action === 'close-tab') { if (!closing) publish('menu:close-tab', undefined) }
        else actionHandler?.(event.action)
      }
      return
    }
    if (event.generation !== bootstrap.generation || !ready()) return
    const sid = event.payload.sessionId
    const identity = typeof event.payload.requestId === 'string' ? JSON.stringify([sid, event.payload.requestId]) : undefined
    if (identity && completed.has(identity)) return
    if (paused.has(sid) || event.deliverySequence <= (watermarks.get(sid) ?? 0) || event.deliverySequence <= (observed[sid] ?? 0)) return
    let assembled: typeof event | undefined
    try { assembled = frames.accept(event) }
    catch { frames.clear(sid); void recover(sid).catch(console.error); return }
    if (!assembled) return
    dispatchStream(assembled.channel,assembled.payload)
    observed[sid] = event.deliverySequence
  })
  try { bootstrap = await native.request<Bootstrap>({ command: 'bootstrap' }); cache = bootstrap.platformSnapshot; environmentSequence = bootstrap.environmentSequence ?? 0 }
  catch (error) { unlisten(); throw error }
  if (pendingEnvironment && pendingEnvironment.sequence > environmentSequence) { environmentSequence = pendingEnvironment.sequence; snapshot(pendingEnvironment.snapshot, true) }
  pendingEnvironment = undefined
  async function command<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const generation = bootstrap.generation
    try {
      const pending = native.request<T>({ command: name, generation, ...args })
      const result = name === 'closeWindow' ? await pending : await withDeadline(pending, name === 'restore' || name === 'resume' ? options.restoreTimeoutMs ?? 4500 : options.commandTimeoutMs ?? 130_000)
      if (disposed || generation !== bootstrap.generation) throw { code: 'staleGeneration' }
      return result
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'runtimeUnavailable'
      throw new NativeQueueError(code, translate(code))
    }
  }
  function control(next: boolean, force = false): Promise<void> {
    const operation = controlLane.then(async () => {
      if (next && disposed) return
      if (attached === next && !force) return
      // 无 renderer deadline：只有 native 确认已入 actor 队列后，才能发下一条控制。
      // native 等待即使超时，也是在 enqueue 之后；actor FIFO 保持最终状态。
      for (let attempt = 0; ; attempt++) {
        try {
          await native.request({ command: next ? 'attach' : 'detach', generation: bootstrap.generation, ...(next ? { observed: { ...observed } } : {}) })
          attached = next
          return
        } catch (error) {
          attached = undefined
          if (attempt || (next && disposed)) throw error
        }
      }
    })
    controlLane = operation.catch(() => {})
    return operation
  }
  function reconcile() {
    const next = ready() && !disposed
    if (next) { for (const resolve of readyWaiters) resolve(); readyWaiters.clear() }
    if (next === requested) return
    requested = next
    void control(next).catch((error) => { if (!disposed) console.error(error) })
  }
  async function ensureAttached() {
    if (!ready() && !disposed) {
      let notify = () => {}
      const waiting = new Promise<void>((resolve) => { notify = resolve; readyWaiters.add(resolve) })
      try { await withDeadline(waiting, options.restoreTimeoutMs ?? 4500) } finally { readyWaiters.delete(notify) }
    }
    if (disposed || !ready()) throw new Error(translate('notReady'))
    await withDeadline(control(true), options.restoreTimeoutMs ?? 4500)
  }
  function active(run: ActiveRun | null) { if (run && ready() && !completed.has(JSON.stringify([run.sessionId, run.requestId]))) publish(STREAM_CHANNELS[0], run.currentSnapshot) }
  async function recover(sid: string) {
    paused.delete(sid)
    if (!disposed && ready()) await control(true, true)
  }
  function history(sid: string): Promise<RestoreBundle> {
    const existing = restores.get(sid)
    if (existing) return existing
    const restoreOwner=queue?.owner(sid)
    const promise = Promise.resolve().then(async () => {
      paused.add(sid)
      frames.clear(sid)
      try {
        await ensureAttached()
        const bundle = await command<RestoreBundle>('restore', { sessionId: sid, observedDeliverySequence: observed[sid] ?? 0 })
        watermarks.set(sid, bundle.deliverySequence)
        const terminals=queue?.restoreStates((bundle.chainStates ?? []).filter(state=>state.sessionId===sid)) ?? []
        queue?.restore(bundle.activeSnapshot,restoreOwner)
        active(bundle.activeSnapshot)
        // 下一 task 让两层原 API Promise 的全部历史消费者先完成 microtask。
        setTimeout(() => {
          paused.delete(sid)
          restores.delete(sid)
          if(!disposed && ready())for(const proof of terminals)dispatchStream('agent:stream:complete',{...proof})
          // COMPLETE 可以先于 resume reply；其 history refresh 必须建立新基线。
          void command('resume', { restoreToken: bundle.restoreToken }).catch(() => {
            if (!restores.has(sid)) return recover(sid)
          })
        }, 0)
        return bundle
      } catch (error) { restores.delete(sid); void recover(sid).catch(console.error); throw error }
    })
    restores.set(sid, promise)
    return promise
  }
  const track = (pending: Promise<unknown>) => { fast.add(pending); void pending.finally(() => fast.delete(pending)).catch(() => {}) }
  if (bootstrap.queueing) queue = createQueueControl(bootstrap.activeRuns, async (channel, args, expectedChainId) => {
    const reply = await command<{value: unknown}>('invoke', {channel,args,expectedChainId})
    return reply.value
  }, track, translate, undefined, payload=>dispatchStream('agent:stream:complete',{...payload}))
  async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    if (closing && channel !== 'settings:update') throw new Error(translate('closing'))
    if (channel === 'agent:get-messages' || channel === 'agent:get-sdk-messages') {
      const bundle = await history(String(args[0]))
      return projectErrors(channel === 'agent:get-messages' ? bundle.messages : bundle.sdkMessages) as T
    }
    if (queue && ['agent:send-message','agent:queue-message','agent:stop'].includes(channel)) return queue.invoke(channel,args) as Promise<T>
    const execute = async (): Promise<T> => {
      // 原 UI 用显式 undefined 清除选择；JSON 省略前转换为成对空值。
      if (channel === 'settings:update' && args[0] && typeof args[0] === 'object') {
        const patch = args[0] as Record<string, unknown>
        if (['agentChannelId', 'agentModelId'].some(key => Object.hasOwn(patch, key) && patch[key] === undefined)) {
          args = [{ ...patch, agentChannelId: '', agentModelId: '' }, ...args.slice(1)]
        }
      }
      const mutation = MUTATION_CHANNELS.has(channel) ? { mutationId: crypto.randomUUID(), expectedRevision: cache.revision } : undefined
      const reply = await command<{ value: T; snapshot?: PlatformSnapshot }>('invoke', { channel, args, ...(mutation ? { mutation } : {}) })
      if (reply.snapshot) snapshot(reply.snapshot)
      return projectErrors(reply.value) as T
    }
    const pending = MUTATION_CHANNELS.has(channel) ? lane.then(execute) : execute()
    if (MUTATION_CHANNELS.has(channel)) lane = pending.catch(() => {})
    if (channel !== 'agent:send-message') { fast.add(pending); void pending.finally(() => fast.delete(pending)).catch(() => {}) }
    return pending
  }
  return {
    get bootstrap() { return { ...bootstrap, platformSnapshot: cache } },
    get revision() { return cache.revision },
    invoke,
    command,
    readSync<T>(channel: string, ...args: unknown[]): T {
      let result: unknown
      if (channel === 'theme:resolve') result = cache.theme
      else if (channel === 'window:chrome-state') result = cache.chrome
      else if (channel === 'telemetry:real-send-allowed') result = false
      else if (channel === 'settings:update-sync') {
        const entries = Object.entries((args[0] ?? {}) as Record<string, unknown>)
        result = !fast.size && entries.length > 0 && entries.every(([key, value]) =>
          Object.hasOwn(cache.settings, key) &&
          JSON.stringify(cache.settings[key as keyof typeof cache.settings]) === JSON.stringify(value),
        )
      }
      else throw new Error(translate('unsupported'))
      return structuredClone(result) as T
    },
    subscribe<T>(channel: string, callback: (value: T) => void) {
      let set = callbacks.get(channel)
      if (!set) { set = new Set(); callbacks.set(channel, set) }
      const cb = callback as (value: unknown) => void
      set.add(cb); reconcile()
      return () => { set.delete(cb); reconcile() }
    },
    getPathForFile() { throw new Error(translate('unsupported')) },
    async quiesce() { while (fast.size) await Promise.all([...fast]); await lane },
    setClosing(value) { closing = value },
    onAction(callback) { actionHandler = callback },
    dispose() { frames.clear(); queue?.dispose(); disposed = true; unlisten(); callbacks.clear(); for (const resolve of readyWaiters) resolve(); readyWaiters.clear(); requested = false; void control(false, true).catch(() => {}) },
  }
}
