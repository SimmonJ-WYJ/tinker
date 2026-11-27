import * as React from 'react'
import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { StickToBottom } from 'use-stick-to-bottom'
import type { SDKAssistantMessage, SDKUserMessage } from '@asci/shared'
import { imageEditDraftsAtom, type SelectedImageVersion } from '@/atoms/image-edit-atoms'
import { AgentSessionProvider } from '@/contexts/session-context'
import { setAppLanguage } from '@/lib/i18n'
import { ImportedAssistantMessage, UserInputMessage } from './UserInputMessage'
import { MessageReferenceNavigation } from './message-reference-navigation'

const originalMarker = window.__TAURI_FORMAL__
const originalApi = window.electronAPI
const filename = 'legacy-' + 'a'.repeat(64) + '.png'
const path = 'sid/' + filename
const file = { filename: 'same.jpg', path, mediaType: 'image/png' } as const
const archive = { _electronImported: true, _importedFiles: [file], parent_tool_use_id: null, session_id: 'sid' }
const first: SDKUserMessage = { ...archive, type: 'user', uuid: 'first', message: { content: [] } }
const second: SDKAssistantMessage = { ...archive, type: 'assistant', uuid: 'second', message: { content: [] } }
const image = (id: string): SelectedImageVersion => ({
  imageId: id, generatedImage: { filename: id + '.png', localPath: 'sid/' + id + '.png', mediaType: 'image/png' },
  previewSrc: 'data:image/png;base64,YQ==',
})
afterEach(() => {
  cleanup()
  window.__TAURI_FORMAL__ = originalMarker
  window.electronAPI = originalApi
})

test('显式选中导入历史里的图片仅准备当前草稿，旧响应与退出会话后的响应均不能覆盖选择', async () => {
  await setAppLanguage('en')
  const pending: ((image: SelectedImageVersion) => void)[] = []
  const prepareHistoryImage = mock((_sid: string, _id: string, _file: string) =>
    new Promise<SelectedImageVersion>(resolve => pending.push(resolve)))
  window.__TAURI_FORMAL__ = { hydrated: () => {}, importSessions: mock(), imageFiles: { pick: mock(), save: mock(), prepareHistoryImage } }
  window.electronAPI = { readAttachment: mock(async () => 'YQ==') } as unknown as Window['electronAPI']
  const store = createStore()
  const content = <Provider store={store}><AgentSessionProvider sessionId="sid"><StickToBottom>
    <UserInputMessage message={first} allMessages={[first, second]} /><ImportedAssistantMessage message={second} />
  </StickToBottom></AgentSessionProvider></Provider>
  const view = render(content)
  await act(async () => {})
  const edits = screen.queryAllByRole('button', { name: 'Edit from this image' })
  expect(edits).toHaveLength(2)
  fireEvent.click(edits[0]!)
  fireEvent.click(edits[1]!)
  expect(prepareHistoryImage.mock.calls).toEqual([['sid', 'first', filename], ['sid', 'second', filename]])
  await act(async () => { pending[0]!(image('older')) })
  expect(store.get(imageEditDraftsAtom).size).toBe(0)
  await act(async () => { pending[1]!(image('newer')) })
  expect(store.get(imageEditDraftsAtom).get('sid')?.imageId).toBe('newer')
  fireEvent.click(edits[0]!)
  view.unmount()
  await act(async () => { pending[2]!(image('late')) })
  expect(store.get(imageEditDraftsAtom).get('sid')?.imageId).toBe('newer')
})

test('已发送归档图保留重新编辑按钮；无法定位来源仍可查看原图', async () => {
  await setAppLanguage('en')
  const selected = image('ref-' + '3'.repeat(32))
  const ref = { ...selected.generatedImage, imageId: selected.imageId, displayName: 'same.jpg', sourceMessageId: 'second', sourceAttachmentPath: path }
  const message: SDKUserMessage = { type: 'user', uuid: 'sent', parent_tool_use_id: null, imageEditReference: ref }
  window.__TAURI_FORMAL__ = { hydrated: () => {}, importSessions: mock(), imageFiles: { pick: mock(), save: mock() } }
  window.electronAPI = { readAttachment: mock(async () => 'YQ==') } as unknown as Window['electronAPI']
  const view = (found: boolean) => <AgentSessionProvider sessionId="sid"><StickToBottom>
    <MessageReferenceNavigation sessionId="sid" targets={[{ groupId: 'second', sourceIds: ['second'] }]}>
      <StickToBottom.Content><div data-message-id="second" tabIndex={-1} />
        <UserInputMessage message={message} allMessages={found ? [first, second, message] : [first, message]} />
      </StickToBottom.Content>
    </MessageReferenceNavigation>
  </StickToBottom></AgentSessionProvider>
  const rendered = render(view(true))
  await act(async () => {})
  expect(screen.queryByRole('button', { name: 'Return to the original message' })).not.toBeNull()
  expect(screen.getByRole('button', { name: 'Edit from this image' })).toBeEnabled()
  rendered.rerender(view(false))
  expect(screen.getByRole('button', { name: 'Original message unavailable' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'View reference image' }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
})

test('普通原生消息保留用户输入的附件标记，不从正文读取本会话或其他会话文件', async () => {
  const read = mock(async () => 'YQ==')
  window.__TAURI_FORMAL__ = { hydrated: () => {}, imageFiles: { pick: mock(), save: mock() } }
  window.electronAPI = { readAttachment: read } as unknown as Window['electronAPI']
  const text = '<attached_files>\n- own.png: sid/' + filename + '\n- other.png: other/' + filename + '\n</attached_files>\nKeep literally.'
  const message: SDKUserMessage = { type: 'user', uuid: 'ordinary', parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } }
  const rendered = render(<AgentSessionProvider sessionId="sid"><StickToBottom><UserInputMessage message={message} allMessages={[message]} /></StickToBottom></AgentSessionProvider>)
  await act(async () => {})
  expect(read).not.toHaveBeenCalled()
  expect(rendered.container.querySelector('[data-local-image-attachment]')).toBeNull()
  expect(rendered.container.querySelector('.conversation-user__text')?.textContent).toBe(text)
})

test('缺少活动会话或宿主消息属于其他会话时，不提供原生附件和引用图读取', async () => {
  const read = mock(async () => 'YQ==')
  window.__TAURI_FORMAL__ = { hydrated: () => {}, importSessions: mock(), imageFiles: { pick: mock(), save: mock() } }
  window.electronAPI = { readAttachment: read } as unknown as Window['electronAPI']
  const id = 'ref-' + '1'.repeat(32)
  const reference = { ...image(id).generatedImage, imageId: id }
  const message: SDKUserMessage = { ...first, imageEditReference: reference }
  const content = (row: SDKUserMessage) => <StickToBottom><UserInputMessage message={row} allMessages={[row]} /><ImportedAssistantMessage message={second} /></StickToBottom>
  const rendered = render(content(message))
  await act(async () => {})
  expect(read).not.toHaveBeenCalled()
  rendered.rerender(<AgentSessionProvider sessionId="other">{content(message)}</AgentSessionProvider>)
  await act(async () => {})
  expect(read).not.toHaveBeenCalled()
  const foreign = { ...message, session_id: 'other' }
  rendered.rerender(<AgentSessionProvider sessionId="sid"><StickToBottom><UserInputMessage message={foreign} allMessages={[foreign]} /></StickToBottom></AgentSessionProvider>)
  await act(async () => {})
  expect(read).not.toHaveBeenCalled()
})

test('普通原生消息没有附件标记时沿用 Markdown 格式', async () => {
  window.__TAURI_FORMAL__ = { hydrated: () => {} }
  const message: SDKUserMessage = { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'text', text: '**Keep bold**' }] } }
  const rendered = render(<AgentSessionProvider sessionId="sid"><StickToBottom><UserInputMessage message={message} allMessages={[message]} /></StickToBottom></AgentSessionProvider>)
  expect(rendered.container.querySelector('strong')?.textContent).toBe('Keep bold')
})
