import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StickToBottom } from 'use-stick-to-bottom'
import type { SDKMessage } from '@asci/shared'
import { ImageAssets } from '../../../main/mcp/image-assets.ts'
import { validateImageEditSelection } from '../../../main/mcp/image-edit-selection.ts'
import { SDKMessageRenderer, MessageGroupRenderer, groupIntoTurns } from './SDKMessageRenderer.tsx'
import { setAppLanguage } from '@/lib/i18n'

const reference = { imageId: 'chosen-first', localPath: 'session-1/first.png', filename: 'first.png', mediaType: 'image/png' }
const userMessage = (): SDKMessage => JSON.parse(JSON.stringify({
  type: 'user', parent_tool_use_id: null,
  message: { content: [{ type: 'text', text: '换成英文版' }] },
  imageEditReference: reference,
})) as SDKMessage

afterEach(async () => {
  cleanup()
  await act(async () => { await setAppLanguage('en') })
})

test('宿主从确定版本返回持久附件信息，不能误取 latest', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sent-image-selection-'))
  try {
    const assets = new ImageAssets(directory)
    for (const [id, filename] of [['chosen-first', 'first.png'], ['unrelated-latest', 'latest.webp']] as const) {
      writeFileSync(join(directory, filename), 'fixture')
      assets.add({ id, filename, model: 'm', channelId: 'c', prompt: 'fixture', referenceIds: [] })
    }
    expect(validateImageEditSelection(directory, 'chosen-first')).toEqual({
      imageId: 'chosen-first', filename: 'first.png', mediaType: 'image/png',
      localPath: `${directory.split('/').at(-1)}/first.png`,
    })
    expect(validateImageEditSelection(directory, undefined)).toBeUndefined()
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('发送消息和重新读取历史分组都显示精确图片缩略图及原始文字', async () => {
  await setAppLanguage('en')
  const read = mock(async (_path: string) => 'Zmlyc3Q=')
  window.electronAPI = { readAttachment: read } as unknown as Window['electronAPI']
  const message = userMessage()
  const view = render(<StickToBottom><SDKMessageRenderer message={message} allMessages={[message]} /></StickToBottom>)
  expect(await screen.findByRole('img', { name: 'first.png' })).toHaveAttribute('src', 'data:image/png;base64,Zmlyc3Q=')
  expect(screen.getByText('换成英文版')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('img', { name: 'first.png' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  view.unmount()

  const restored = JSON.parse(JSON.stringify(message)) as SDKMessage
  const group = groupIntoTurns([restored])[0]!
  render(<StickToBottom><MessageGroupRenderer group={group} allMessages={[restored]} /></StickToBottom>)
  expect(await screen.findByRole('img', { name: 'first.png' })).toBeInTheDocument()
  expect(read.mock.calls.every(([path]) => path === reference.localPath)).toBe(true)
})

test('历史图片文件缺失或解码失败时中英文友好降级，旧消息仍只有原文字', async () => {
  await setAppLanguage('en')
  window.electronAPI = { readAttachment: mock(async () => { throw new Error('missing') }) } as unknown as Window['electronAPI']
  const message = userMessage()
  const view = render(<StickToBottom><SDKMessageRenderer message={message} allMessages={[message]} /></StickToBottom>)
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable')
  await act(async () => { await setAppLanguage('zh') })
  expect(screen.getByRole('alert')).toHaveTextContent('不可用')
  expect(screen.getByText('换成英文版')).toBeInTheDocument()
  const legacy: SDKMessage = { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'text', text: '旧消息' }] } }
  view.rerender(<StickToBottom><SDKMessageRenderer message={legacy} allMessages={[legacy]} /></StickToBottom>)
  expect(screen.getByText('旧消息')).toBeInTheDocument()
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

test('临时会话 JSONL 持久化再读取仍指向原版本，保留已有记录和引用关系', async () => {
  const home = mkdtempSync(join(tmpdir(), 'sent-image-history-'))
  const originalHome = process.env.ASCI_CONFIG_HOME
  const originalSdkConfig = process.env.CLAUDE_CONFIG_DIR
  process.env.ASCI_CONFIG_HOME = home
  delete process.env.CLAUDE_CONFIG_DIR
  try {
    // 顶层配置副作用和全部 fixture 都限定在临时目录，绝不加载真实会话。
    const { appendSDKMessages, getAgentSessionSDKMessages } = await import('../../../main/lib/agent-session-manager.ts')
    const { getAgentSessionsDir, getAgentSessionMessagesPath, getConversationAttachmentsDir } = await import('../../../main/lib/config-paths.ts')
    getAgentSessionsDir()
    const session = 'synthetic-history'
    const directory = getConversationAttachmentsDir(session)
    const assets = new ImageAssets(directory)
    for (const [id, filename] of [['parent-original', 'original.png'], ['chosen-first', 'first.png'], ['latest-unrelated', 'latest.webp']] as const) {
      writeFileSync(join(directory, filename), id)
      assets.add({ id, filename, model: 'm', channelId: 'c', prompt: 'fixture', referenceIds: id === 'chosen-first' ? ['parent-original'] : [], baseImageId: id === 'chosen-first' ? 'parent-original' : undefined })
    }
    const oldMessage: SDKMessage = { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'text', text: '旧消息' }] } }
    appendSDKMessages(session, [oldMessage])
    const path = getAgentSessionMessagesPath(session)
    const oldBytes = readFileSync(path, 'utf8')
    const ledgerBytes = readFileSync(join(directory, 'image-assets.jsonl'), 'utf8')
    const selected = validateImageEditSelection(directory, 'chosen-first')
    const sent: SDKMessage = { ...userMessage(), imageEditReference: selected }
    appendSDKMessages(session, [sent])
    expect(readFileSync(path, 'utf8').startsWith(oldBytes)).toBe(true)
    expect(readFileSync(join(directory, 'image-assets.jsonl'), 'utf8')).toBe(ledgerBytes)

    const restored = getAgentSessionSDKMessages(session)
    expect(restored[0]).toEqual(oldMessage)
    expect(restored[1]).toEqual(sent)
    const read = mock(async (localPath: string) => {
      expect(localPath).toBe(`${session}/first.png`)
      return readFileSync(join(directory, localPath.split('/')[1]!)).toString('base64')
    })
    window.electronAPI = { readAttachment: read } as unknown as Window['electronAPI']
    const group = groupIntoTurns(restored)[1]!
    render(<StickToBottom><MessageGroupRenderer group={group} allMessages={restored} /></StickToBottom>)
    expect(await screen.findByRole('img', { name: 'first.png' })).toHaveAttribute('src', `data:image/png;base64,${Buffer.from('chosen-first').toString('base64')}`)
    expect(read).toHaveBeenCalledTimes(1)
  } finally {
    if (originalHome === undefined) delete process.env.ASCI_CONFIG_HOME
    else process.env.ASCI_CONFIG_HOME = originalHome
    if (originalSdkConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalSdkConfig
    rmSync(home, { recursive: true, force: true })
  }
})

test('图片解码失败显示降级提示；旧异步读取不能覆盖切换后的确定版本', async () => {
  let resolveFirst!: (data: string) => void
  const first = new Promise<string>(resolve => { resolveFirst = resolve })
  const read = mock(async (path: string) => path === reference.localPath ? first : 'bmV3')
  window.electronAPI = { readAttachment: read } as unknown as Window['electronAPI']
  const message = userMessage()
  const view = render(<StickToBottom><SDKMessageRenderer message={message} allMessages={[message]} /></StickToBottom>)
  const next = { ...message, imageEditReference: { ...reference, imageId: 'selected-next', filename: 'next.webp', localPath: 'session-1/next.webp', mediaType: 'image/webp' } }
  view.rerender(<StickToBottom><SDKMessageRenderer message={next} allMessages={[next]} /></StickToBottom>)
  expect(await screen.findByRole('img', { name: 'next.webp' })).toHaveAttribute('src', 'data:image/webp;base64,bmV3')
  await act(async () => { resolveFirst('b2xk'); await first })
  expect(screen.getByRole('img', { name: 'next.webp' })).toHaveAttribute('src', 'data:image/webp;base64,bmV3')
  fireEvent.error(screen.getByRole('img', { name: 'next.webp' }))
  expect(screen.getByRole('alert')).toHaveTextContent('unavailable')
  expect(screen.queryByRole('img')).toBeNull()
})
