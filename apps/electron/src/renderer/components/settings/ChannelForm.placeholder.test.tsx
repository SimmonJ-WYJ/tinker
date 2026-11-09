import { afterEach, expect, mock, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Channel } from '@asci/shared'
import { ChannelForm } from './ChannelForm.tsx'
import { setAppLanguage } from '@/lib/i18n'

afterEach(async () => { cleanup(); await setAppLanguage('en') })

for (const [lang, example, hint, missing, testLabel] of [
  ['en', 'e.g. https://api.example.com', 'Enter your provider’s Base URL. The example is not saved.', 'Please fill in the Base URL', 'Test connection'],
  ['zh', '例如：https://api.example.com', '请输入服务商提供的 Base URL，示例不会作为配置保存。', '请填写 Base URL', '测试连接'],
] as const) {
  test(`${lang} 空 URL 明确是示例，填写与清空保留真实值和测试守门`, async () => {
    await setAppLanguage(lang)
    const probe = mock(async () => ({ success: false, message: 'Synthetic response' }))
    const update = mock(async () => ({}))
    window.electronAPI = {
      decryptApiKey: mock(async () => 'fixture-key'),
      testChannelDirect: probe, updateChannel: update, listChannels: mock(async () => []),
    } as unknown as Window['electronAPI']
    const channel: Channel = { id: 'placeholder-fixture', name: 'Relay', provider: 'custom-openai', baseUrl: '', apiKey: '', models: [{ id: 'synthetic-model', name: 'Synthetic', enabled: true }], enabled: true, createdAt: 0, updatedAt: 0 }
    render(<ChannelForm channel={channel} onSaved={() => {}} onCancel={() => {}} />)
    await screen.findByDisplayValue('fixture-key')
    const input = screen.getByLabelText('Base URL', { exact: false }) as HTMLInputElement
    expect(input.placeholder).toBe(example)
    expect(input.value).toBe('')
    expect(input.getAttribute('aria-describedby')).toBe(screen.getByText(hint).id)
    expect(screen.getByText(missing)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: testLabel })).toBeDisabled()
    expect(probe).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'https://fixture.test/v1' } })
    expect(input.value).toBe('https://fixture.test/v1')
    expect(screen.getByText(/https:\/\/fixture.test\/v1\/chat\/completions/)).toBeInTheDocument()
    expect(screen.queryByText(hint) === null).toBe(true)
    expect(screen.getByRole('button', { name: testLabel })).toBeEnabled()
    fireEvent.change(input, { target: { value: '  ' } })
    expect(screen.getByText(hint)).toBeInTheDocument()
    expect(screen.getByText(missing)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: testLabel })).toBeDisabled()
    expect(probe).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
}
