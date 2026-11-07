import * as React from 'react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { StickToBottom } from 'use-stick-to-bottom'
import type { SDKMessage } from '@asci/shared'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { AssistantTurnRenderer, groupIntoTurns, type AssistantTurn } from './SDKMessageRenderer.tsx'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const originalAPI = window.electronAPI
afterEach(() => { cleanup(); window.electronAPI = originalAPI })

interface ImageFixture { id: string; filename?: string; owner?: string; error?: boolean }

function fixture(images: ImageFixture[], text: string): SDKMessage[] {
  const messages: unknown[] = [{ type: 'user', uuid: 'user-input', message: { content: [{ type: 'text', text: 'make an image' }] } }]
  for (const image of images) {
    messages.push(
      { type: 'assistant', uuid: `use-${image.id}`, message: { content: [{ type: 'tool_use', name: 'mcp__asci-image__generate_image', id: image.id, input: {} }] } },
      { type: 'user', uuid: `result-${image.id}`, message: { content: [{ type: 'tool_result', tool_use_id: image.id, is_error: image.error, content: JSON.stringify({ imageId: image.id, generatedImage: { localPath: `${image.owner ?? 'session-1'}/${image.id}.png`, filename: image.filename ?? `${image.id}.png`, mediaType: 'image/png' } }) }] } },
    )
  }
  messages.push({ type: 'assistant', uuid: 'answer', message: { content: [{ type: 'text', text }] } })
  return messages as SDKMessage[]
}

async function renderTurn(images: ImageFixture[], text: string, history: SDKMessage[] = []): Promise<{ read: ReturnType<typeof mock<(path: string) => Promise<string>>>; container: HTMLElement; store: ReturnType<typeof createStore> }> {
  const read = mock(async (_path: string) => PNG)
  window.electronAPI = { readAttachment: read, previewReadText: mock(async () => ({ content: '', truncated: false })), statFile: mock(async () => ({ size: 68, isDirectory: false })) } as unknown as Window['electronAPI']
  const messages = [...history, ...fixture(images, text)]
  const turn = groupIntoTurns(messages).filter((item): item is AssistantTurn => item.type === 'assistant-turn').at(-1)!
  const store = createStore()
  store.set(currentAgentSessionIdAtom, 'session-1')
  let container!: HTMLElement
  await act(async () => {
    container = render(<Provider store={store}><StickToBottom><AssistantTurnRenderer turn={turn} allMessages={messages} basePath="/tmp/synthetic-session-cwd" isStreaming /></StickToBottom></Provider>).container
  })
  read.mockClear()
  return { read, container, store }
}

describe('当前回合生成图片引用', () => {
  it('裸 basename Markdown 链接读取明确附件并放大，不按 cwd 或另一张最新图片猜测', async () => {
    const { read } = await renderTurn([{ id: 'first' }, { id: 'later' }], '[Preview exact image](first.png)')
    fireEvent.click(screen.getByRole('link', { name: 'Preview exact image' }))
    await waitFor(() => expect(read).toHaveBeenCalledWith('session-1/first.png'))
    expect(read).toHaveBeenCalledTimes(1)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('img', { name: 'first.png' }).getAttribute('src')).toBe(`data:image/png;base64,${PNG}`)
  })

  it('下方生成图片文件卡打开同一明确附件，跳过不存在的 cwd 图片路径', async () => {
    const { read, container } = await renderTurn([{ id: 'first' }], '[Preview exact image](first.png)')
    const cardButton = container.querySelector<HTMLButtonElement>('button[title="first.png"]')!
    fireEvent.click(cardButton)
    await waitFor(() => expect(read).toHaveBeenCalledWith('session-1/first.png'))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('完整 localPath 唯一匹配，即便两个产物有相同展示文件名', async () => {
    const { read } = await renderTurn([{ id: 'first', filename: 'same.png' }, { id: 'second', filename: 'same.png' }], '[Exact](session-1/first.png)')
    fireEvent.click(screen.getByRole('link', { name: 'Exact' }))
    await waitFor(() => expect(read).toHaveBeenCalledWith('session-1/first.png'))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('同名歧义不读取任意一个附件', async () => {
    const { read } = await renderTurn([{ id: 'first', filename: 'same.png' }, { id: 'second', filename: 'same.png' }], '[Ambiguous](same.png)')
    fireEvent.click(screen.getByRole('link', { name: 'Ambiguous' }))
    expect(read).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('没有本回合成功图片、跨会话或无关 basename 都不使用附件读取', async () => {
    for (const images of [[], [{ id: 'first', error: true }], [{ id: 'first', owner: 'other-session' }], [{ id: 'unrelated' }]]) {
      const { read } = await renderTurn(images, '[Unresolved](first.png)')
      fireEvent.click(screen.getByRole('link', { name: 'Unresolved' }))
      expect(read).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).toBeNull()
      cleanup()
    }
  })

  it('附件缺失时显示本地化失败并可再次点击原引用重试', async () => {
    const { read } = await renderTurn([{ id: 'first' }], '[Retry this image](first.png)')
    read.mockRejectedValueOnce(new Error('ENOENT: synthetic missing attachment'))
    fireEvent.click(screen.getByRole('link', { name: 'Retry this image' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load image')
    expect(screen.queryByText(/ENOENT/)).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: 'Retry this image' }))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('历史其他回合的图片不用于修补当前回合的裸文件名', async () => {
    const { read } = await renderTurn([], '[Old image](first.png)', fixture([{ id: 'first' }], 'old result'))
    fireEvent.click(screen.getByRole('link', { name: 'Old image' }))
    expect(read).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('快速点击两个明确引用时，较晚返回的旧读取不会替换最新选择', async () => {
    const { read } = await renderTurn([{ id: 'first' }, { id: 'second' }], '[First](first.png) [Second](second.png)')
    let resolveFirst!: (value: string) => void
    let resolveSecond!: (value: string) => void
    read.mockImplementation((path) => new Promise<string>((resolve) => {
      if (path.endsWith('first.png')) resolveFirst = resolve
      else resolveSecond = resolve
    }))
    fireEvent.click(screen.getByRole('link', { name: 'First' }))
    fireEvent.click(screen.getByRole('link', { name: 'Second' }))
    await act(async () => resolveSecond(PNG))
    expect(await screen.findByRole('dialog', { name: 'second.png' })).toBeTruthy()
    await act(async () => resolveFirst(PNG))
    expect(screen.queryByRole('dialog', { name: 'first.png' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'second.png' })).toBeTruthy()
  })

  it('切换会话后忽略未完成的旧附件读取', async () => {
    const { read, store } = await renderTurn([{ id: 'first' }], '[First](first.png)')
    let resolve!: (value: string) => void
    read.mockImplementation(() => new Promise<string>((res) => { resolve = res }))
    fireEvent.click(screen.getByRole('link', { name: 'First' }))
    await act(async () => store.set(currentAgentSessionIdAtom, 'other-session'))
    await act(async () => resolve(PNG))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('附件字节无法解码时由共用查看器显示本地化失败', async () => {
    const { read } = await renderTurn([{ id: 'first' }], '[Broken](first.png)')
    read.mockResolvedValueOnce(btoa('synthetic invalid image'))
    fireEvent.click(screen.getByRole('link', { name: 'Broken' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.error(within(dialog).getByRole('img', { name: 'first.png' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Failed to load image')
  })
  it('关闭后清除原图并重新读取，恢复原链接焦点', async () => {
    const { read } = await renderTurn([{ id: 'first' }], '[Open original](first.png)')
    const link = screen.getByRole('link', { name: 'Open original' })
    link.focus();fireEvent.click(link)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(link))
    fireEvent.click(link)
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

})
