/** Rust 实际投影核对同一 golden；原 transport/hook/消息列表消费，不复制投影实现。 */
import { afterEach, expect, spyOn, test } from 'bun:test'
import { act, cleanup, render } from '@testing-library/react'
import { createStore, Provider, useAtomValue } from 'jotai'
import type { AgentMessage, SDKMessage, ToolRunSnapshotEvent } from '@asci/shared'
import contract from '../../../../packages/shared/src/fixtures/tool-restore-projection.json'
import { createDesktopApi } from '../preload/api.ts'
import { createFormalTransport } from './transport.ts'
import type { NativeBridge, NativeEvent } from './protocol.ts'
import { AgentMessages } from '../renderer/components/agent/AgentMessages.tsx'
import { groupIntoTurns } from '../renderer/components/agent/SDKMessageRenderer.tsx'
import { TooltipProvider } from '../renderer/components/ui/tooltip.tsx'
import { liveMessagesMapAtom, agentStreamingStatesAtom } from '../renderer/atoms/agent-atoms.ts'
import { useGlobalAgentListeners } from '../renderer/hooks/useGlobalAgentListeners.ts'
import { mergeToolRunMessages } from '../renderer/hooks/tool-run-snapshot.ts'
import * as notifications from '../renderer/atoms/notifications.ts'

afterEach(cleanup)
test('pending restore renders one human bubble from paired Rust history and active snapshot, including replay', async () => {
  const { sessionId, requestId, startedAt } = contract.turn
  const snapshot = contract.snapshot as ToolRunSnapshotEvent
  let emit: (event: NativeEvent) => void = () => {}
  const active = { sessionId, requestId, startedAt, currentSnapshot: { sessionId, requestId, startedAt, payload: { kind: 'asci_event', event: snapshot } }, cursor: contract.turn.sequence }
  const bridge: NativeBridge = {
    listen: async cb => { emit = cb; return () => {} },
    request: async <T,>(request: Record<string, unknown>): Promise<T> => {
      const result = request.command === 'bootstrap'
        ? { generation: 'g', activeRuns: [active], platformSnapshot: { version: 1, revision: 0, settings: {}, userProfile: {}, workspaces: [], theme: { mode: 'system', isDark: false }, chrome: { platform: 'darwin', fullscreen: false } } }
        : request.command === 'restore'
          ? { ...contract.history, activeSnapshot: active, deliverySequence: 0, restoreToken: 'restore-tools', cursor: contract.turn.sequence }
          : request.command === 'invoke' ? { value: [] } : { attached: true, activeRuns: [active] }
      return structuredClone(result) as T
    },
  }
  const transport = await createFormalTransport(bridge, code => code)
  const oldApi = window.electronAPI
  window.electronAPI = createDesktopApi(transport)
  const store = createStore()
  const notify = spyOn(notifications, 'sendDesktopNotification').mockImplementation(() => {})
  function View({ messages, sdk }: { messages: AgentMessage[]; sdk: SDKMessage[] }) {
    useGlobalAgentListeners()
    const live = useAtomValue(liveMessagesMapAtom).get(sessionId) ?? []
    const stream = useAtomValue(agentStreamingStatesAtom).get(sessionId)
    return <TooltipProvider><AgentMessages sessionId={sessionId} messages={messages} messagesLoaded persistedSDKMessages={sdk} liveMessages={live} streaming streamState={stream} /></TooltipProvider>
  }
  try {
    const mounted = render(<Provider store={store}><View messages={[]} sdk={[]} /></Provider>)
    let messages: AgentMessage[] = []
    let sdk: SDKMessage[] = []
    await act(async () => {
      ;[messages, sdk] = await Promise.all([window.electronAPI.getAgentSessionMessages(sessionId), window.electronAPI.getAgentSessionSDKMessages(sessionId)])
    })
    mounted.rerender(<Provider store={store}><View messages={messages} sdk={sdk} /></Provider>)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    const check = () => {
      const live = store.get(liveMessagesMapAtom).get(sessionId) ?? []
      expect(live).toHaveLength(2)
      expect(groupIntoTurns(mergeToolRunMessages(sdk, live)).filter(group => group.type === 'user')).toHaveLength(1)
      expect(mounted.getAllByText(contract.turn.userMessage, { exact: true })).toHaveLength(1)
    }
    check()
    const replayPayload = { ...active.currentSnapshot, payload: { kind: 'asci_event', event: { ...snapshot, activeText: 'replayed partial' } } }
    await act(async () => {
      emit({ version: 1, generation: 'g', deliverySequence: 1, channel: 'agent:stream:event', payload: replayPayload })
    })
    expect(store.get(agentStreamingStatesAtom).get(sessionId)?.content).toBe('replayed partial')
    const beforeReplay = notify.mock.calls.length
    let observations = 0
    const unsubscribe = store.sub(liveMessagesMapAtom, () => { observations++ })
    await act(async () => {
      emit({ version: 1, generation: 'g', deliverySequence: 2, channel: 'agent:stream:event', payload: replayPayload })
      emit({ version: 1, generation: 'g', deliverySequence: 3, channel: 'agent:stream:event', payload: replayPayload })
    })
    unsubscribe()
    check()
    expect(observations).toBe(0)
    expect(notify).toHaveBeenCalledTimes(beforeReplay)
  } finally {
    cleanup(); transport.dispose(); notify.mockRestore(); window.electronAPI = oldApi
  }
})
