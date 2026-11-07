import { afterEach, beforeAll, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { StickToBottom } from 'use-stick-to-bottom'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { OnboardingSpotlightState, SpotlightStep } from '../../../types/onboarding-spotlight'
import { i18n } from '@/lib/i18n'
import { StarterChips } from '@/components/onboarding/StarterChips'
import { settingsTabAtom } from '@/atoms/settings-tab'
import { SpotlightOverlay } from '@/components/onboarding/SpotlightOverlay'
import { onboardingSpotlightAtom } from '@/atoms/onboarding-spotlight-atoms'
import { zoteroPingStatusAtom } from '@/atoms/zotero-atoms'
import { AssistantTurnRenderer, groupIntoTurns, type AssistantTurn } from './SDKMessageRenderer.tsx'

beforeAll(async () => {
  Object.assign(globalThis, { __APP_VERSION__: 'test', __TINKER_CANDIDATE__: true })
  await i18n.changeLanguage('zh')
})
afterEach(cleanup)

test('首次任务建议面向通用工作，只回填输入，不执行任务', () => {
  let prompt = ''
  render(<StarterChips onSelect={value => { prompt = value }} />)
  expect(screen.queryAllByRole('button', { name: /Zotero|蛋白|综述/ }).length).toBe(0)
  fireEvent.click(screen.getByRole('button', { name: /整理资料/ }))
  expect(prompt).toContain('文件')
  expect(prompt).not.toContain('Zotero')
})

test('普通回答移除科研证据集入口，保留复制和反馈', () => {
  const messages = [{ type: 'assistant', uuid: 'general-answer', message: { content: [{ type: 'text', text: '可以先整理附件，再完成你的任务。' }] } }] as unknown as SDKMessage[]
  const turn = groupIntoTurns(messages).find((group): group is AssistantTurn => group.type === 'assistant-turn')!
  render(<StickToBottom><AssistantTurnRenderer turn={turn} allMessages={messages} isStreaming={false} /></StickToBottom>)
  expect(screen.queryAllByRole('button', { name: '加入证据集' }).length).toBe(0)
  expect(screen.getAllByRole('button', { name: '复制' }).length).toBe(1)
  expect(screen.getAllByRole('button', { name: '回答不错' }).length).toBe(1)
})

test('设置主导航去掉 Zotero，保留通用、模型和 MCP 入口', async () => {
  const { SettingsPanel } = await import('@/components/settings/SettingsPanel')
  const store = createStore()
  store.set(settingsTabAtom, 'mcp')
  render(<Provider store={store}><SettingsPanel /></Provider>)
  expect(screen.queryAllByRole('button', { name: 'Zotero' }).length).toBe(0)
  for (const name of ['通用', '模型与渠道', 'MCP 服务器']) {
    expect(screen.getAllByRole('button', { name }).length).toBe(1)
  }
})

test('旧科研引导位置自动进入新任务，不重复跳过通用步骤', async () => {
  const store = createStore()
  const originalApi = window.electronAPI
  const calls: Array<{ from: SpotlightStep; fromSubStage: number }> = []
  store.set(onboardingSpotlightAtom, { status: 'in-progress', currentStep: 'connect-zotero', currentSubStage: 0 })
  store.set(zoteroPingStatusAtom, { running: true, remoteEnabled: true })
  window.electronAPI = {
    advanceOnboardingSpotlight: async (input: { from: SpotlightStep; fromSubStage: number }) => {
      calls.push(input)
      const next: OnboardingSpotlightState = { status: 'in-progress', currentStep: input.fromSubStage === 0 ? 'connect-zotero' : 'new-task', currentSubStage: input.fromSubStage === 0 ? 1 : 0 }
      store.set(onboardingSpotlightAtom, next)
      return next
    },
    skipOnboardingSpotlightSubStage: async () => { throw new Error('不应跳过通用步骤') },
  } as unknown as typeof window.electronAPI
  try {
    await act(async () => { render(<Provider store={store}><SpotlightOverlay /></Provider>) })
    expect(calls).toEqual([{ from: 'connect-zotero', fromSubStage: 0 }, { from: 'connect-zotero', fromSubStage: 1 }])
    expect(store.get(onboardingSpotlightAtom)?.currentStep).toBe('new-task')
    expect(store.get(onboardingSpotlightAtom)?.currentSubStage).toBe(0)
  } finally { cleanup(); window.electronAPI = originalApi }
})
