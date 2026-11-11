/** 记录 Electron 原有 ABI，通过隔离 transport 验证工厂与入口的行为。 */
import { describe, expect, test } from 'bun:test'
// 此 fixture 在重构前从 Electron preload 通过隔离 adapter 记录，锁定既有 ABI。
import abiFixture from './api-abi.fixture.json'
import type { ElectronAPI } from './api.ts'
import type { PlatformTransport } from './transport.ts'

interface Call {
  kind: string
  channel: string
  args: unknown[]
}
interface Subscription {
  channel: string
  callback: (data: unknown) => void
  active: boolean
}
type AbiRow = [string, boolean] | [string, unknown[][], unknown[][]]

function recordTransport() {
  const calls: Call[] = []
  const subscriptions: Subscription[] = []
  const result = { fixture: 'result' }
  const syncValues = new Map<string, unknown>()
  let path = '/fixture/path with spaces'
  const transport: PlatformTransport = {
    invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
      calls.push({ kind: 'invoke', channel, args })
      return Promise.resolve(result as T)
    },
    readSync<T>(channel: string, ...args: unknown[]): T {
      calls.push({ kind: 'readSync', channel, args })
      return (syncValues.has(channel) ? syncValues.get(channel) : result) as T
    },
    subscribe<T>(channel: string, callback: (data: T) => void) {
      calls.push({ kind: 'subscribe', channel, args: [] })
      const subscription = { channel, callback: callback as (data: unknown) => void, active: true }
      subscriptions.push(subscription)
      return () => { subscription.active = false }
    },
    getPathForFile(file: File) {
      calls.push({ kind: 'getPathForFile', channel: '', args: [file] })
      return path
    },
  }
  return { transport, calls, subscriptions, syncValues, result, setPath(value: string) { path = value } }
}

// 缺少工厂时给出明确断言；不把 Electron 模块加载失败误当成业务回归。
async function loadFactory() {
  const module = await import('./api.ts').catch(() => undefined)
  expect(module?.createDesktopApi).toBeFunction()
  return module!.createDesktopApi
}

function members(object: object, prefix = ''): Map<string, unknown> {
  const result = new Map<string, unknown>()
  for (const [key, value] of Object.entries(object)) {
    const path = prefix + key
    if (value !== null && typeof value === 'object') {
      for (const [child, member] of members(value, path + '.')) result.set(child, member)
    } else result.set(path, value)
  }
  return result
}

function normalized(calls: Call[]): unknown[][] {
  return calls.map(({ kind, channel, args }) => [kind, channel, args.map(arg => arg === undefined ? '__undefined__' : arg)])
}

const fixture = abiFixture as unknown as AbiRow[]

describe('纯桌面 API 工厂', () => {
  test('无需 Electron 即可导入，且保留全部 270 个 ABI 成员与 namespace', async () => {
    const createDesktopApi = await loadFactory()
    const recorder = recordTransport()
    recorder.syncValues.set('telemetry:real-send-allowed', true)
    const api: ElectronAPI = createDesktopApi(recorder.transport)
    const actual = members(api)
    expect([...actual.keys()].sort()).toEqual(fixture.map(([path]) => path).sort())
    for (const [path, value] of fixture) {
      if (typeof value === 'boolean') expect(typeof actual.get(path)).toBe('boolean')
      else expect(actual.get(path)).toBeFunction()
    }
  })

  test('逐方法保留原通道、零参数、四联参数、默认值与返回值', async () => {
    const createDesktopApi = await loadFactory()
    const recorder = recordTransport()
    const actual = members(createDesktopApi(recorder.transport))
    for (const row of fixture) {
      if (typeof row[1] === 'boolean') continue
      const [path, empty, four] = row
      const method = actual.get(path) as (...args: unknown[]) => unknown
      if (/^on[A-Z]/.test(path.split('.').at(-1)!)) continue
      for (const [args, expected] of [[[], empty], [['arg0', 'arg1', 'arg2', 'arg3'], four]] as const) {
        recorder.calls.length = 0
        const result = method(...args)
        expect(normalized(recorder.calls), path).toEqual(expected)
        if (recorder.calls[0]?.kind === 'invoke') {
          expect(result, path).toBeInstanceOf(Promise)
          expect(await result, path).toBe(recorder.result)
        } else if (recorder.calls[0]?.kind === 'readSync') {
          expect(result, path).toBe(recorder.result)
        } else expect(result, path).toBe('/fixture/path with spaces')
      }
    }
  })

  test('逐事件保留订阅通道、原始 payload 与独立取消订阅', async () => {
    const createDesktopApi = await loadFactory()
    const recorder = recordTransport()
    const actual = members(createDesktopApi(recorder.transport))
    for (const row of fixture) {
      if (typeof row[1] === 'boolean' || !/^on[A-Z]/.test(row[0].split('.').at(-1)!)) continue
      const [path, expected] = row
      const received: unknown[] = []
      recorder.calls.length = 0
      const method = actual.get(path) as (callback: (data: unknown) => void) => () => void
      const unsubscribe = method(data => received.push(data))
      expect(normalized(recorder.calls), path).toEqual(expected)
      const subscription = recorder.subscriptions.at(-1)!
      subscription.callback(recorder.result)
      expect(received, path).toEqual([recorder.result])
      expect(unsubscribe, path).toBeFunction()
      unsubscribe()
      expect(subscription.active, path).toBe(false)
    }
  })

  test('创建时同步读取遥测门控，只有 true 才开启，且实例不共享 transport', async () => {
    const createDesktopApi = await loadFactory()
    for (const value of [true, false, undefined, 1, 'true']) {
      const recorder = recordTransport()
      recorder.syncValues.set('telemetry:real-send-allowed', value)
      const api = createDesktopApi(recorder.transport)
      expect(api.telemetryForceSend).toBe(value === true)
      expect(recorder.calls).toEqual([{ kind: 'readSync', channel: 'telemetry:real-send-allowed', args: [] }])
    }
    const first = recordTransport()
    const second = recordTransport()
    const firstApi = createDesktopApi(first.transport)
    const secondApi = createDesktopApi(second.transport)
    first.calls.length = 0
    second.calls.length = 0
    await firstApi.auth.logout()
    await secondApi.runtime.getStatus()
    expect(first.calls.map(call => call.channel)).toEqual(['auth:logout'])
    expect(second.calls.map(call => call.channel)).toEqual(['runtime-provisioner:get-status'])
  })

  test('File 对象和路径原样转发，包括没有磁盘路径的空字符串', async () => {
    const createDesktopApi = await loadFactory()
    const recorder = recordTransport()
    const api = createDesktopApi(recorder.transport)
    const file = new File(['fixture'], 'fixture.txt')
    expect(api.getPathForFile(file)).toBe('/fixture/path with spaces')
    expect(recorder.calls.at(-1)?.args[0]).toBe(file)
    recorder.setPath('')
    expect(api.getPathForFile(file)).toBe('')
  })

  test('transport 的异步拒绝和同步异常不被吞掉', async () => {
    const createDesktopApi = await loadFactory()
    const recorder = recordTransport()
    const error = new Error('fixture failure')
    recorder.transport.invoke = () => Promise.reject(error)
    const api = createDesktopApi(recorder.transport)
    await expect(api.listAgentSessions()).rejects.toBe(error)
    recorder.transport.readSync = () => { throw error }
    expect(() => api.resolveTheme()).toThrow(error)
    recorder.transport.getPathForFile = () => { throw error }
    expect(() => api.getPathForFile(new File([], 'fixture'))).toThrow(error)
  })


})

// 对唯一 Electron 入口打包注入本地替身，不替换全局模块缓存，不启动 Electron。
test('纯 API 可打包为浏览器模块，Electron adapter 保留 ABI、启动快照与精确移除', async () => {
  const recorder = recordTransport()
  const exposed = new Map<string, unknown>()
  const listeners: Array<{ channel: string; callback: (event: unknown, data: unknown) => void }> = []
  const removed: typeof listeners = []
  const initialTheme = { preference: 'system', resolved: 'dark' }
  recorder.syncValues.set('telemetry:real-send-allowed', true)
  recorder.syncValues.set('theme:resolve', initialTheme)
  recorder.syncValues.set('desktop-runtime:preview-status', true)
  const probe = {
    contextBridge: { exposeInMainWorld(key: string, value: unknown) { exposed.set(key, value) } },
    ipcRenderer: {
      invoke: recorder.transport.invoke,
      sendSync: recorder.transport.readSync,
      on(channel: string, callback: (event: unknown, data: unknown) => void) {
        recorder.calls.push({ kind: 'subscribe', channel, args: [] })
        listeners.push({ channel, callback })
      },
      removeListener(channel: string, callback: (event: unknown, data: unknown) => void) {
        removed.push({ channel, callback })
        const index = listeners.findIndex(listener => listener.channel === channel && listener.callback === callback)
        expect(index).toBeGreaterThanOrEqual(0)
        listeners.splice(index, 1)
      },
    },
    webUtils: { getPathForFile: recorder.transport.getPathForFile },
  }
  const build = await Bun.build({
    // 两个入口在同次构建检查，避免 Bun 连续构建共享源码时的缓存读错误。
    entrypoints: [import.meta.dir + '/api.ts', import.meta.dir + '/index.ts'],
    target: 'browser', format: 'iife',
    plugins: [{ name: 'electron-entry-fixture', setup(builder) {
      builder.onResolve({ filter: /^(electron$|node:|@sentry\/electron)/ }, ({ path, importer }) => {
        if (importer !== import.meta.dir + '/index.ts' || path.startsWith('node:')) {
          throw new Error('平台依赖进入纯工厂: ' + path)
        }
        return { path, namespace: 'entry-fixture' }
      })
      builder.onLoad({ filter: /.*/, namespace: 'entry-fixture' }, ({ path }) => ({
        loader: 'js', contents: path === 'electron'
          ? 'export const { contextBridge, ipcRenderer, webUtils } = probe'
          : '',
      }))
    } }],
  })
  expect(build.logs).toEqual([])
  expect(build.success).toBe(true)
  expect(build.outputs.some(output => output.path.endsWith('/api.js'))).toBe(true)
  const entry = build.outputs.find(output => output.path.endsWith('/index.js'))!
  new Function('probe', await entry.text())(probe)
  const api = exposed.get('electronAPI') as ElectronAPI
  expect(exposed.get('__INITIAL_THEME__')).toBe(initialTheme)
  expect(exposed.get('__DESKTOP_RUNTIME_PREVIEW__')).toBe(true)
  expect(recorder.calls).toEqual([
    { kind: 'readSync', channel: 'telemetry:real-send-allowed', args: [] },
    { kind: 'readSync', channel: 'theme:resolve', args: [] },
    { kind: 'readSync', channel: 'desktop-runtime:preview-status', args: [] },
  ])
  const actual = members(api)
  expect([...actual.keys()].sort()).toEqual(fixture.map(([path]) => path).sort())
  for (const row of fixture) {
    if (typeof row[1] === 'boolean') continue
    const [path, empty, four] = row
    const method = actual.get(path) as (...args: unknown[]) => unknown
    const isEvent = /^on[A-Z]/.test(path.split('.').at(-1)!)
    for (const [args, expected] of [[[], empty], [['arg0', 'arg1', 'arg2', 'arg3'], four]] as const) {
      recorder.calls.length = 0
      const received: unknown[][] = []
      const result = method(...(isEvent ? [(...data: unknown[]) => received.push(data)] : args))
      expect(normalized(recorder.calls), path).toEqual(expected)
      if (isEvent) {
        const listener = listeners.at(-1)!
        listener.callback({ privateElectronEvent: true }, recorder.result)
        expect(received, path).toEqual([[recorder.result]])
        ;(result as () => void)()
        expect(removed.at(-1), path).toEqual(listener)
        expect(listeners).toHaveLength(0)
      } else if (recorder.calls[0]?.kind === 'invoke') expect(await result, path).toBe(recorder.result)
    }
  }
  const received: unknown[] = []
  const unsubscribeFirst = api.onWindowChromeChanged(state => received.push(state))
  const unsubscribeSecond = api.onWindowChromeChanged(state => received.push(state))
  const secondListener = listeners[1]!
  unsubscribeFirst()
  expect(listeners).toEqual([secondListener])
  secondListener.callback({}, recorder.result)
  expect(received).toEqual([recorder.result])
  unsubscribeSecond()
  expect(listeners).toHaveLength(0)
})
