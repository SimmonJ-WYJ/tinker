/** 单 native listener、串行平台写入、按会话恢复屏障；不包含 Node 或 Electron。 */
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
export async function createFormalTransport(native: NativeBridge, translate: (code: string) => string, options: { restoreTimeoutMs?: number } = {}): Promise<FormalTransport> {
  const callbacks = new Map<string, Set<(value: unknown) => void>>()
  const observed: Record<string, number> = {}
  const watermarks = new Map<string, number>()
  const paused = new Set<string>()
  const completed = new Set<string>()
  const restores = new Map<string, Promise<RestoreBundle>>()
  const fast = new Set<Promise<unknown>>()
  let bootstrap: Bootstrap
  let cache: PlatformSnapshot
  let lane: Promise<unknown> = Promise.resolve()
  let environmentSequence = 0
  let attached = false
  let disposed = false
  let closing = false
  let actionHandler: ((action: 'close' | 'reload') => void) | undefined
  const ready = () => STREAM_CHANNELS.every((c) => (callbacks.get(c)?.size ?? 0) > 0)
  const publish = (channel: string, value: unknown) => {
    for (const callback of callbacks.get(channel) ?? []) callback(projectErrors(value))
  }
  function projectErrors(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(projectErrors)
    if (!value || typeof value !== 'object') return value
    const result: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) result[key] = key === 'error' && typeof v === 'string' ? translate(v) : key === 'message' && v === 'responseFailed' ? translate(v) : projectErrors(v)
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
    if (!bootstrap || disposed) return
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
    publish(event.channel, event.payload)
    if (identity && event.channel === 'agent:stream:complete') completed.add(identity)
    observed[sid] = event.deliverySequence
  })
  try { bootstrap = await native.request<Bootstrap>({ command: 'bootstrap' }); cache = bootstrap.platformSnapshot; environmentSequence = bootstrap.environmentSequence ?? 0 }
  catch (error) { unlisten(); throw error }
  async function command<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const generation = bootstrap.generation
    try {
      const result = await withDeadline(native.request<T>({ command: name, generation, ...args }), name === 'restore' || name === 'resume' ? options.restoreTimeoutMs ?? 4500 : 130_000)
      if (disposed || generation !== bootstrap.generation) throw { code: 'staleGeneration' }
      return result
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'runtimeUnavailable'
      throw new Error(translate(code))
    }
  }
  function reconcile() {
    const next = ready() && !disposed
    if (next === attached) return
    attached = next
    // 同步发命令，StrictMode 的 detach/attach 顺序不依赖 RPC 返回顺序。
    void command(next ? 'attach' : 'detach', next ? { observed: { ...observed } } : {}).catch((error) => { if (!disposed) console.error(error) })
  }
  function active(run: ActiveRun | null) { if (run && ready() && !completed.has(JSON.stringify([run.sessionId, run.requestId]))) publish(STREAM_CHANNELS[0], run.currentSnapshot) }
  async function recover(sid: string) {
    paused.delete(sid)
    if (!disposed && ready()) await command('attach', { observed: { ...observed } })
  }
  function history(sid: string): Promise<RestoreBundle> {
    const existing = restores.get(sid)
    if (existing) return existing
    const promise = Promise.resolve().then(async () => {
      paused.add(sid)
      try {
        const bundle = await command<RestoreBundle>('restore', { sessionId: sid, observedDeliverySequence: observed[sid] ?? 0 })
        watermarks.set(sid, bundle.deliverySequence)
        active(bundle.activeSnapshot)
        // 下一 task 让两层原 API Promise 的全部历史消费者先完成 microtask。
        setTimeout(() => {
          paused.delete(sid)
          restores.delete(sid)
          // COMPLETE 可以先于 resume reply；其 history refresh 必须建立新基线。
          void command('resume', { restoreToken: bundle.restoreToken }).catch(() => {
            if (!restores.has(sid)) return recover(sid)
          })
        }, 0)
        return bundle
      } catch (error) { restores.delete(sid); await recover(sid); throw error }
    })
    restores.set(sid, promise)
    return promise
  }
  async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    if (closing && channel !== 'settings:update') throw new Error(translate('closing'))
    if (channel === 'agent:get-messages' || channel === 'agent:get-sdk-messages') {
      const bundle = await history(String(args[0]))
      return projectErrors(channel === 'agent:get-messages' ? bundle.messages : bundle.sdkMessages) as T
    }
    const execute = async (): Promise<T> => {
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
    bootstrap,
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
    dispose() { disposed = true; unlisten(); callbacks.clear() },
  }
}
