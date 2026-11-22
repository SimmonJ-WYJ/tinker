/**
 * ChannelSettings 首次空态行为测试。
 *
 * 首次无渠道时，页面应只保留 header 主 CTA，并展示保守收敛空态。
 */

import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { setAppLanguage } from '@/lib/i18n'
import { ChannelSettings } from './ChannelSettings.tsx'

afterEach(async () => {
  cleanup()
  await setAppLanguage('en')
})

describe('ChannelSettings 首次空态', () => {
  test('无渠道时展示保守收敛空态且只有一个添加配置按钮', async () => {
    await setAppLanguage('zh')
    window.electronAPI = {
      listChannels: mock(async () => []),
    } as unknown as Window['electronAPI']

    const { container } = render(<ChannelSettings />)

    await waitFor(() => {
      expect(screen.getByText('渠道配置')).toBeInTheDocument()
    })

    expect(screen.getByText('管理 AI 供应商连接与可用模型。')).toBeInTheDocument()
    expect(screen.getByText('暂无模型配置')).toBeInTheDocument()
    expect(screen.queryByText('Anthropic')).not.toBeInTheDocument()
    expect(screen.queryByText('DeepSeek')).not.toBeInTheDocument()
    expect(screen.queryByText('Kimi')).not.toBeInTheDocument()
    expect(screen.queryByText('OpenRouter')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '添加配置' })).toHaveLength(1)
    expect(container.querySelector('[data-first-run-empty-icon]')).toBeInTheDocument()
  })
})

test('自定义渠道列表使用中文协议名称', async () => {
  await setAppLanguage('zh')
  window.electronAPI = {
    listChannels: mock(async () => [{ id: 'relay', name: 'Relay', provider: 'custom-openai', baseUrl: 'https://relay.test', apiKey: '', models: [{ id: 'm', name: 'm', enabled: true }], enabled: true, createdAt: 0, updatedAt: 0 }]),
  } as unknown as Window['electronAPI']
  render(<ChannelSettings />)
  await waitFor(() => expect(screen.getByText(/自定义中转站 · OpenAI/)).toBeInTheDocument())
})

test('按用途分组；启停渠道不会进入编辑，点击渠道可编辑并返回', async () => {
  await setAppLanguage('en')
  const base = { baseUrl: 'https://relay.test', apiKey: '', models: [{ id: 'm', name: 'm', enabled: true }], enabled: true, createdAt: 0, updatedAt: 0 }
  let channels = [
    { ...base, id: 'images', name: 'Image Relay', provider: 'custom-image' },
    { ...base, id: 'chat', name: 'Chat Relay', provider: 'custom-openai' },
  ]
  const updateChannel = mock(async (id: string, patch: { enabled: boolean }) => {
    channels = channels.map((channel) => channel.id === id ? { ...channel, ...patch } : channel)
  })
  window.electronAPI = {
    listChannels: mock(async () => channels),
    updateChannel,
    updateSettings: mock(async () => ({})),
    decryptApiKey: mock(async () => 'fixture-key'),
  } as unknown as Window['electronAPI']

  render(<ChannelSettings />)
  const images = await screen.findByRole('region', { name: 'Image generation' })
  const chat = screen.getByRole('region', { name: 'Chat' })
  expect(within(chat).getByRole('button', { name: 'Edit Chat Relay' })).toBeInTheDocument()
  expect(within(images).getByRole('button', { name: 'Edit Image Relay' }).querySelector('[role="switch"]')).toBeNull()
  fireEvent.click(within(images).getByRole('switch', { name: 'Disable Image Relay' }))
  expect(await within(images).findByRole('switch', { name: 'Enable Image Relay' })).not.toBeChecked()
  expect(updateChannel).toHaveBeenCalledWith('images', { enabled: false })
  expect(screen.queryByText('Edit model provider')).toBeNull()
  expect(screen.queryByText(/test generates one image/)).toBeNull()

  fireEvent.click(within(images).getByRole('button', { name: 'Edit Image Relay' }))
  expect(screen.getByText('Edit model provider')).toBeInTheDocument()
  await screen.findByDisplayValue('fixture-key')
  fireEvent.click(screen.getByRole('button', { name: 'Back to providers' }))
  expect(await screen.findByRole('button', { name: 'Edit Image Relay' })).toBeInTheDocument()
})

test('托管渠道只在确认后删除，取消后可以重新发起', async () => {
  await setAppLanguage('en')
  const channel = { id: 'qa', name: 'QA Relay', provider: 'custom-openai', enabled: true, models: [] }
  const deleteChannel = mock(async (_id: string) => undefined)
  window.electronAPI = {
    getChannelCredentialMode: async () => 'managed',
    listChannels: async () => deleteChannel.mock.calls.length ? [] : [channel],
    deleteChannel,
    updateSettings: async () => ({}),
  } as unknown as Window['electronAPI']

  render(<ChannelSettings />)
  const remove = await screen.findByRole('button', { name: 'Delete QA Relay' })
  fireEvent.click(remove)
  const prompt = await screen.findByRole('alertdialog', { name: /QA Relay/ })
  expect(deleteChannel).not.toHaveBeenCalled()
  fireEvent.click(within(prompt).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  await waitFor(() => expect(document.activeElement === remove).toBe(true))
  expect(deleteChannel).not.toHaveBeenCalled()
  fireEvent.click(remove)
  const retry = await screen.findByRole('alertdialog', { name: /QA Relay/ })
  fireEvent.click(within(retry).getByRole('button', { name: 'Delete' }))
  await screen.findByText('No model providers')
  expect(deleteChannel.mock.calls).toEqual([['qa']])
  await waitFor(() => expect(document.activeElement === screen.getByRole('button', { name: 'Add provider' })).toBe(true))
})

test('Electron 继续使用窗口确认，取消不删除，确认仅删除选中的渠道', async () => {
  await setAppLanguage('en')
  const channel = { id: 'legacy', name: 'Legacy Relay', provider: 'custom-openai', enabled: true, models: [] }
  const deleteChannel = mock(async (_id: string) => undefined)
  window.electronAPI = {
    listChannels: async () => deleteChannel.mock.calls.length ? [] : [channel],
    deleteChannel, updateSettings: async () => ({}),
  } as unknown as Window['electronAPI']
  const confirm = spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  try {
    render(<ChannelSettings />)
    const remove = await screen.findByRole('button', { name: 'Delete Legacy Relay' })
    fireEvent.click(remove)
    expect(deleteChannel).not.toHaveBeenCalled()
    fireEvent.click(remove)
    await screen.findByText('No model providers')
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(deleteChannel.mock.calls).toEqual([['legacy']])
  } finally {
    confirm.mockRestore()
  }
})
