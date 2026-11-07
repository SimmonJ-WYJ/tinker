import { expect, test } from 'bun:test'
import type { SDKMessage } from '@asci/shared'
import * as imageRetryPolicy from './image-retry-policy.ts'

const user = (id?: string): SDKMessage => ({
  type: 'user', parent_tool_use_id: null,
  message: { content: [{ type: 'text', text: 'edit' }] },
  ...(id && { imageEditReference: { imageId: id, localPath: 'session/first.png', filename: 'first.png', mediaType: 'image/png' } }),
})

test('重试绑定已发送用户消息的确定图片，不受新草稿和工具/合成消息干扰', () => {
  const messages: SDKMessage[] = [user('sent-first'), {
    type: 'user', parent_tool_use_id: null,
    message: { content: [{ type: 'tool_result', tool_use_id: 'tool', content: 'result' }] },
  }, { ...user('synthetic-other'), isSynthetic: true }, { ...user('subagent-other'), parent_tool_use_id: 'parent' }]
  expect(imageRetryPolicy.latestUserImageEditReferenceId(messages)).toBe('sent-first')
  expect(imageRetryPolicy.latestTurnAttemptedImage(messages)).toBe(false)
})

test('最新人类消息没有新字段时不倒找更旧图片；保留生图尝试后的人工复核保护', () => {
  expect(imageRetryPolicy.latestUserImageEditReferenceId([user('old-image'), user()])).toBeUndefined()
  const attempted: SDKMessage[] = [user('sent-first'), {
    type: 'assistant', parent_tool_use_id: null,
    message: { content: [{ type: 'tool_use', id: 'generate', name: 'mcp__asci-image__generate_image', input: {} }] },
  }]
  expect(imageRetryPolicy.latestUserImageEditReferenceId(attempted)).toBe('sent-first')
  expect(imageRetryPolicy.latestTurnAttemptedImage(attempted)).toBe(true)
})
