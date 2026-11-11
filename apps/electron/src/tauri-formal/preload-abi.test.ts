import { expect, test } from 'bun:test'
import { createDesktopApi } from '../preload/api.ts'
import { createFormalTransport } from './transport.ts'
import type { NativeBridge } from './protocol.ts'
import fixture from './preload-abi.fixture.json'
test('原 createDesktopApi 经正式 transport 生成 Rust handler 共用 ABI 夹具', async () => {
  const calls: Record<string, unknown>[] = []
  const native: NativeBridge = {
    listen: async () => () => {},
    request: async <T>(request: Record<string, unknown>): Promise<T> => {
      calls.push(request)
      return (request.command === 'bootstrap' ? { generation: 'document-1', activeRuns: [], platformSnapshot: { revision: 0, settings: {}, theme: { mode: 'system', isDark: false }, chrome: { platform: 'darwin', fullscreen: false } } } : { value: null }) as T
    },
  }
  const transport = await createFormalTransport(native, (code) => code)
  const api = createDesktopApi(transport)
  await api.getAgentSessionPath('local-mock-workspace-id', 'session-1')
  await api.updateSettings({ language: 'zh' })
  expect(calls.slice(1).map(({ channel, args }) => ({ channel, args }))).toEqual([fixture.path, fixture.settings])
  transport.dispose()
})
