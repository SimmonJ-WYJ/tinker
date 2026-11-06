/**
 * ChannelSettings 首次空态行为测试。
 *
 * 首次无渠道时，页面应只保留 header 主 CTA，并展示保守收敛空态。
 */

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
      expect(screen.getByText('模型配置')).toBeInTheDocument()
    })

    expect(screen.getByText('管理 AI 供应商连接，配置 API Key 和可用模型。')).toBeInTheDocument()
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

test('渠道编辑入口不包含开关，图片能力与协议说明分开', async () => {
  await setAppLanguage('en')
  window.electronAPI = { listChannels: mock(async () => [{ id: 'images', name: 'Image Relay', provider: 'custom-image', baseUrl: 'https://relay.test', apiKey: '', models: [{ id: 'image', name: 'image', enabled: true }], enabled: true, createdAt: 0, updatedAt: 0 }]) } as unknown as Window['electronAPI']
  render(<ChannelSettings />)
  const edit = await screen.findByRole('button', { name: 'Edit Image Relay' })
  expect(edit.querySelector('[role="switch"]')).toBeNull()
  expect(screen.getByRole('switch', { name: 'Disable Image Relay' })).toBeInTheDocument()
  expect(screen.getByText('Image generation', { exact: true })).toBeInTheDocument()
  expect(screen.queryByText(/test generates one image/)).toBeNull()
})
