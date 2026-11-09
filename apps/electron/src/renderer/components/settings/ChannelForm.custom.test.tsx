import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Channel, FetchModelsInput } from '@asci/shared'
import { ChannelForm } from './ChannelForm.tsx'
import { setAppLanguage } from '@/lib/i18n'

afterEach(() => cleanup())
test('自定义渠道在测试前可填写模型，模型测试失败仍保留输入且可重试', async () => {
  await setAppLanguage('en')
  const testDirect = mock(async (_input: FetchModelsInput) => ({ success: false, message: 'HTTP 404' }))
  window.electronAPI = {
    decryptApiKey: mock(async () => 'key'),
    testChannelDirect: testDirect,
    updateChannel: mock(async () => ({})),
    listChannels: mock(async () => []),
  } as unknown as Window['electronAPI']
  const channel: Channel = { id: 'test', name: 'Relay', provider: 'custom-openai', baseUrl: 'https://relay.test/v1', apiKey: '', models: [{ id: 'private', name: 'Private', enabled: true }], enabled: true, createdAt: 0, updatedAt: 0 }
  render(<ChannelForm channel={channel} onSaved={() => {}} onCancel={() => {}} />)
  expect(screen.getByText('Private').closest('[aria-disabled="true"]')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Add a custom model' }))
  expect(screen.getByPlaceholderText('Model ID (e.g. claude-opus-4-6)')).toBeInTheDocument()
  await waitFor(() => expect((screen.getByPlaceholderText('Leave empty to keep the existing key') as HTMLInputElement).value).toBe('key'))
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
  await waitFor(() => expect(testDirect).toHaveBeenCalled())
  await waitFor(() => expect(screen.getByText('HTTP 404')).toBeInTheDocument())
  expect(screen.getByText('Private')).toBeInTheDocument()
  expect(testDirect.mock.calls[0]?.[0]).toMatchObject({ provider: 'custom-openai', probeModel: 'private' })
})

test('编辑中转站 URL，先等待保存被门控，再测试成功仍会自动保存', async () => {
  await setAppLanguage('en')
  let complete!: (value: { success: boolean; message: string }) => void
  const result = new Promise<{ success: boolean; message: string }>(resolve => { complete = resolve })
  const update = mock(async () => ({}))
  window.electronAPI = {
    decryptApiKey: mock(async () => 'key'),
    testChannelDirect: mock(async (_input: FetchModelsInput) => result),
    updateChannel: update, listChannels: mock(async () => []),
  } as unknown as Window['electronAPI']
  const channel: Channel = { id: 'test', name: 'Relay', provider: 'custom-openai', baseUrl: 'https://relay.test/v1', apiKey: '', models: [{ id: 'private', name: 'Private', enabled: true }], enabled: true, createdAt: 0, updatedAt: 0 }
  render(<ChannelForm channel={channel} onSaved={() => {}} onCancel={() => {}} />)
  await waitFor(() => expect((screen.getByPlaceholderText('Leave empty to keep the existing key') as HTMLInputElement).value).toBe('key'))
  await act(async () => { await Bun.sleep(130) })
  fireEvent.change(screen.getByLabelText('Base URL', { exact: false }), { target: { value: 'https://new-relay.test/v1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
  await act(async () => { await Bun.sleep(700) })
  expect(update).not.toHaveBeenCalled()
  await act(async () => { complete({ success: true, message: 'Connection successful' }) })
  await waitFor(() => expect(update).toHaveBeenCalledWith('test', expect.objectContaining({ baseUrl: 'https://new-relay.test/v1' })), { timeout: 1300 })
})

test('生图配置只在点击测试后发出付费探针，展示正确图片端点', async () => {
  await setAppLanguage('en')
  const probe = mock(async (_input: FetchModelsInput) => ({success:false,message:'Image API test'}))
  window.electronAPI = {decryptApiKey:mock(async ()=>'key'),testChannelDirect:probe,updateChannel:mock(async()=>({})),listChannels:mock(async()=>[])} as unknown as Window['electronAPI']
  const channel: Channel = {id:'images',name:'Images',provider:'custom-image',baseUrl:'https://relay.test',apiKey:'',models:[{id:'gpt-image-2-o',name:'gpt-image-2-o',enabled:true}],enabled:true,createdAt:0,updatedAt:0}
  render(<ChannelForm channel={channel} onSaved={()=>{}} onCancel={()=>{}} />)
  await waitFor(()=>expect((screen.getByPlaceholderText('Leave empty to keep the existing key') as HTMLInputElement).value).toBe('key'))
  expect(screen.getByText('Preview: https://relay.test/v1/images/generations')).toBeInTheDocument()
  await act(async()=>{await Bun.sleep(1600)})
  expect(probe).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'Generate test image · paid'}))
  await waitFor(()=>expect(probe).toHaveBeenCalledWith(expect.objectContaining({provider:'custom-image',probeModel:'gpt-image-2-o'})))
})

test('图片渠道未付费验证也能保存编辑，保存会等待持久化而非仅关闭',async()=>{
 await setAppLanguage('en')
 const update=mock(async()=>({}));const probe=mock(async()=>({success:false,message:'unused'}));const saved=mock(()=>{})
 window.electronAPI={decryptApiKey:mock(async()=>'key'),testChannelDirect:probe,updateChannel:update,listChannels:mock(async()=>[])} as unknown as Window['electronAPI']
 const channel:Channel={id:'image-save',name:'Images',provider:'custom-image',baseUrl:'https://relay.test',apiKey:'',models:[{id:'m',name:'m',enabled:true}],enabled:true,createdAt:0,updatedAt:0}
 render(<ChannelForm channel={channel} onSaved={saved} onCancel={()=>{}} />)
 await waitFor(()=>expect((screen.getByPlaceholderText('Leave empty to keep the existing key') as HTMLInputElement).value).toBe('key'))
 fireEvent.change(screen.getByDisplayValue('https://relay.test'),{target:{value:'file:///tmp'}})
 expect(screen.getByRole('button',{name:'Save'})).toBeDisabled()
 fireEvent.change(screen.getByDisplayValue('file:///tmp'),{target:{value:'https://relay.test'}})
 expect(screen.getByRole('button',{name:'Save'})).toBeEnabled()
 fireEvent.change(screen.getByDisplayValue('Images'),{target:{value:'Renamed'}})
 fireEvent.click(screen.getByRole('button',{name:'Save'}))
 await waitFor(()=>expect(update).toHaveBeenCalledWith('image-save',expect.objectContaining({name:'Renamed'})))
 await waitFor(()=>expect(saved).toHaveBeenCalled())
 expect(probe).not.toHaveBeenCalled()
 expect(screen.getByText(/Saving does not test/)).toBeInTheDocument()
})

test('已通过连接测试的文字渠道立即点保存会提交最新名称，再退出编辑', async () => {
  await setAppLanguage('en')
  let finishUpdate!: () => void
  const writing = new Promise<void>(resolve => { finishUpdate = resolve })
  const update = mock(async () => { await writing })
  const saved = mock(() => {})
  window.electronAPI = {
    decryptApiKey: mock(async () => 'fixture-key'),
    testChannelDirect: mock(async () => ({ success: true, message: 'Connection successful' })),
    updateChannel: update,
    listChannels: mock(async () => []),
  } as unknown as Window['electronAPI']
  const channel: Channel = { id: 'chat-save', name: 'Original', provider: 'custom-openai', baseUrl: 'https://relay.test', apiKey: '', models: [{ id: 'model', name: 'Model', enabled: true }], enabled: true, createdAt: 0, updatedAt: 0 }
  render(<ChannelForm channel={channel} onSaved={saved} onCancel={() => {}} />)
  await screen.findByDisplayValue('fixture-key')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Test connection' })) })
  expect(screen.getByText('Connection successful')).toBeInTheDocument()
  fireEvent.change(screen.getByDisplayValue('Original'), { target: { value: 'Latest name' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  try {
    expect(update).toHaveBeenCalledWith('chat-save', expect.objectContaining({ name: 'Latest name' }))
    expect(saved).not.toHaveBeenCalled()
  } finally {
    await act(async () => { finishUpdate() })
  }
  expect(saved).toHaveBeenCalledTimes(1)
})
