import * as React from 'react'
import { afterEach, expect, test, mock } from 'bun:test'
import { render, cleanup, screen, act, fireEvent } from '@testing-library/react'
import type { SDKMessage, SDKUserMessage } from '@asci/shared'
import { UserInputMessage } from './UserInputMessage.tsx'
import { setAppLanguage } from '@/lib/i18n'
import { AgentSessionProvider } from '@/contexts/session-context'
import { StickToBottom } from 'use-stick-to-bottom'
import { MessageReferenceNavigation } from './message-reference-navigation.tsx'

afterEach(cleanup)
function Conversation({ children }: React.PropsWithChildren): React.ReactElement { return <StickToBottom>{children}</StickToBottom> }
const reference = { imageId: 'source-image', localPath: 'session-a/source.png', filename: 'source.png', mediaType: 'image/png' }
const text = '<attached_files>\n- upload.png: session-a/upload.png\n</attached_files>\nPlace her next to him.'
test('上传图片在气泡外，历史引用卡在气泡内；纯上传不能成为引用', async () => {
  await setAppLanguage('en')
  window.electronAPI = { readAttachment: mock(async () => 'cG5n'), saveImageAs: mock(async () => {}) } as unknown as Window['electronAPI']
  const message: SDKUserMessage = { type: 'user', parent_tool_use_id: null, uuid: 'reply', message: { content: [{ type: 'text', text }] }, imageEditReference: reference }
  const view = render(<UserInputMessage message={message} allMessages={[]} />, { wrapper: Conversation })
  await act(async () => {})
  expect(screen.getByText('Reference image')).toBeInTheDocument()
  const bubble = view.container.querySelector('.conversation-user__bubble')!
  expect(bubble.querySelector('[data-image-edit-reference]')).not.toBeNull()
  expect(bubble.querySelector('[data-local-image-attachment]')).toBeNull()
  expect(view.container.querySelector('[data-local-image-attachment]')).not.toBeNull()
  expect(screen.getByRole('button', { name: 'Original message unavailable' })).toBeDisabled()
  view.rerender(<UserInputMessage message={{ ...message, imageEditReference: undefined }} allMessages={[]} />)
  expect(screen.queryByText('Reference image')).toBeNull()
  expect(screen.getByText('Place her next to him.')).toBeInTheDocument()
})
test('引用读取失败保留卡片与明确 fallback，重试后可预览并关闭', async () => {
  await setAppLanguage('en')
  let failing = true
  window.electronAPI = { readAttachment: mock(async () => { if (failing) throw new Error('missing'); return 'cG5n' }), saveImageAs: mock(async () => {}) } as unknown as Window['electronAPI']
  render(<UserInputMessage message={{ type: 'user', parent_tool_use_id: null, imageEditReference: reference, message: { content: [{ type: 'text', text: 'Edit this.' }] } }} allMessages={[]} />, { wrapper: Conversation })
  await act(async () => {})
  expect(screen.getByText('Reference image')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Retry image preview' })).toBeInTheDocument()
  failing = false
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry image preview' })) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'View reference image' })) })
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close' })) })
  expect(screen.queryByRole('dialog')).toBeNull()
})
test('后续才出现的同 ID 和路径产物不能为更早的用户引用提供跳转', async () => {
  await setAppLanguage('en')
  window.electronAPI = { readAttachment: mock(async () => 'cG5n'), saveImageAs: mock(async () => {}) } as unknown as Window['electronAPI']
  const message: SDKUserMessage = { type: 'user', uuid: 'earlier-user', parent_tool_use_id: null, imageEditReference: { ...reference, sourceMessageId: 'future-source' }, message: { content: [{ type: 'text', text: 'Earlier request.' }] } }
  const future = [message, { type: 'assistant', uuid: 'future-source', message: { content: [{ type: 'tool_use', id: 'future-call', name: 'mcp__asci-image__generate_image', input: {} }] } }, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'future-call', content: JSON.stringify({ imageId: reference.imageId, generatedImage: reference }) }] } }] as SDKMessage[]
  render(<StickToBottom><MessageReferenceNavigation sessionId="future-test" targets={[{ groupId: "future-group", sourceIds: ["future-source"] }]}><StickToBottom.Content><div data-message-id="future-group" tabIndex={-1} /><UserInputMessage message={message} allMessages={future} /></StickToBottom.Content></MessageReferenceNavigation></StickToBottom>)
  await act(async () => {})
  expect(screen.getByRole('button', { name: 'Original message unavailable' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Return to the original message' })).toBeNull()
})

test('导入会话按宿主确认的表读取附件、以实际类型展示并原生保存，忽略正文伪造路径', async () => {
  const marker = window.__TAURI_FORMAL__
  const api = window.electronAPI
  const source = 'sid/legacy-' + 'b'.repeat(64)
  const read = mock(async (_path: string) => 'cG5n')
  const save = mock(async (_path: string) => true)
  try {
    window.__TAURI_FORMAL__ = { hydrated: () => {}, importSessions: mock(), imageFiles: { save, pick: mock() } }
    window.electronAPI = { readAttachment: read } as unknown as Window['electronAPI']
    const message = {
      type: 'user', parent_tool_use_id: null, session_id: 'sid', _electronImported: true,
      message: { content: [{ type: 'text', text }] },
      _importedFiles: [
        { filename: 'original.jpg', path: source + '.png', mediaType: 'image/png' },
        { filename: 'display-as-text.png', path: source + '.txt', mediaType: 'text/plain' },
        { filename: 'wrong-session.png', path: 'other/' + source.split('/')[1] + '.png', mediaType: 'image/png' },
        { filename: 'bad.png', path: '/private/bad.png', mediaType: 'image/png' },
      ],
    } as SDKUserMessage
    render(<AgentSessionProvider sessionId="sid"><UserInputMessage message={message} allMessages={[message]} /></AgentSessionProvider>, { wrapper: Conversation })
    expect(await screen.findByRole('img', { name: 'original.jpg' })).toHaveAttribute('src', 'data:image/png;base64,cG5n')
    expect(screen.getByText('display-as-text.png')).toBeInTheDocument()
    expect(read.mock.calls).toEqual([[source + '.png']])
    fireEvent.click(screen.getByRole('button', { name: 'Save image' }))
    expect(save).toHaveBeenCalledWith(source + '.png')
  } finally {
    window.__TAURI_FORMAL__ = marker
    window.electronAPI = api
  }
})

test('导入的助手历史保留单独来源与图片，正文中的外站图片和历史工具保持静态', async () => {
  const { SDKMessageRenderer, MessageGroupRenderer, groupIntoTurns } = await import('./SDKMessageRenderer')
  const marker = window.__TAURI_FORMAL__
  const api = window.electronAPI
  const path = 'session-a/legacy-' + 'c'.repeat(64) + '.png'
  try {
    window.__TAURI_FORMAL__ = { hydrated: () => {}, importSessions: mock() }
    window.electronAPI = { readAttachment: mock(async () => 'aGVsbG8=') } as unknown as Window['electronAPI']
    const base = {
      type: 'assistant', parent_tool_use_id: null, _electronImported: true, session_id: 'session-a',
      _importedFiles: [{ filename: 'old-generated.jpg', mediaType: 'image/png', path }],
    } as const
    const first = { ...base, uuid: 'image-only', message: { content: [{ type: 'text', text: '' }] } } as unknown as SDKMessage
    const second = { ...base, uuid: 'text-only', _importedFiles: [], message: { content: [
      { type: 'text', text: '![external](https://external.invalid/example.jpg)' },
      { type: 'tool_use', name: 'Write', id: 'old-tool', input: {} },
    ] } } as unknown as SDKMessage
    const history = [first, second]
    const groups = groupIntoTurns(history)
    expect(groups).toHaveLength(2)
    const view = render(<AgentSessionProvider sessionId="session-a">{groups.map((group, key) => (
      <MessageGroupRenderer key={key} group={group} allMessages={history} />
    ))}</AgentSessionProvider>, { wrapper: Conversation })
    expect(await screen.findByRole('img', { name: 'old-generated.jpg' })).toHaveAttribute('src', 'data:image/png;base64,aGVsbG8=')
    expect(view.container.querySelector('img[src^="http"]')).toBeNull()
    expect(view.container.querySelector('[data-message-id="text-only"]')).not.toBeNull()
    expect(screen.queryByText('Write')).toBeNull()
    view.rerender(<AgentSessionProvider sessionId="session-a"><SDKMessageRenderer message={first} allMessages={history} /></AgentSessionProvider>)
    expect(await screen.findByRole('img', { name: 'old-generated.jpg' })).toBeInTheDocument()
  } finally {
    window.__TAURI_FORMAL__ = marker
    window.electronAPI = api
  }
})
