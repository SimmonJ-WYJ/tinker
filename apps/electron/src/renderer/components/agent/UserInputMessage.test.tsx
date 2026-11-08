import * as React from 'react'
import { afterEach, expect, test, mock } from 'bun:test'
import { render, cleanup, screen, act, fireEvent } from '@testing-library/react'
import type { SDKMessage, SDKUserMessage } from '@asci/shared'
import { UserInputMessage } from './UserInputMessage.tsx'
import { setAppLanguage } from '@/lib/i18n'
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
