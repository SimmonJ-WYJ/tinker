import { expect, test } from 'bun:test'
import type { SDKMessage, SDKUserMessage, SDKAssistantMessage, SDKToolResultBlock, UserImageEditReference } from '../types/agent.ts'
import { resolveImageReferenceSource, bindImageReferenceSources, resolveUserImageReferenceSource } from './image-reference-source.ts'

const reference: UserImageEditReference = { imageId: 'image-a', localPath: 'session-a/image-a.png', filename: 'image-a.png', mediaType: 'image/png' }
function generated(uuid = 'source-a', image = reference): SDKMessage[] {
  return [
    { type: 'assistant', uuid, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: `tool-${uuid}`, name: 'mcp__asci-image__generate_image', input: {} }] } } as SDKMessage,
    { type: 'user', uuid: `result-${uuid}`, parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: `tool-${uuid}`, content: JSON.stringify({ imageId: image.imageId, generatedImage: { localPath: image.localPath, filename: image.filename, mediaType: image.mediaType } }) }] } },
  ]
}
const reply = (ref = reference): SDKUserMessage => ({ type: 'user', uuid: 'reply', parent_tool_use_id: null, imageEditReference: ref, message: { content: [{ type: 'text', text: 'Put the uploaded person beside him.' }] } })

test('旧引用按唯一成功的生图调用及精确图片/路径恢复真实来源 UUID', () => {
  expect(resolveImageReferenceSource(reference, generated())).toBe('source-a')
  expect(resolveImageReferenceSource({ ...reference, sourceMessageId: 'old-id' }, generated())).toBe('source-a')
  expect(resolveImageReferenceSource(reference, generated('other', { ...reference, localPath: 'other-session/image-a.png' }))).toBeUndefined()
  expect(resolveImageReferenceSource({ ...reference, imageId: 'latest' }, generated())).toBeUndefined()
})
test('缺失、失败、无稳定 UUID、被上传/正文伪造的来源不能变成跳转', () => {
  expect(resolveImageReferenceSource(reference, [])).toBeUndefined()
  const failed = generated(); ((failed[1] as SDKUserMessage).message!.content![0] as SDKToolResultBlock).is_error = true
  expect(resolveImageReferenceSource(reference, failed)).toBeUndefined()
  const noUuid = generated(); delete (noUuid[0] as SDKAssistantMessage).uuid
  expect(resolveImageReferenceSource(reference, noUuid)).toBeUndefined()
  const upload: SDKMessage = { type: 'user', uuid: 'upload', parent_tool_use_id: null, message: { content: [{ type: 'text', text: '<attached_files><file path="session-a/image-a.png">image-a.png</file></attached_files>' }] } }
  expect(resolveImageReferenceSource(reference, [upload])).toBeUndefined()
})
test('歧义旧记录不猜测，已验证的来源绑定可保留', () => {
  const messages = [...generated('source-a'), ...generated('source-b')]
  expect(resolveImageReferenceSource(reference, messages)).toBeUndefined()
  expect(resolveImageReferenceSource({ ...reference, sourceMessageId: 'source-a' }, messages)).toBe('source-a')
})
test('保存按消息时间顺序补齐来源，不修改历史或允许指向未来消息', () => {
  const history = generated(); const before = JSON.stringify(history)
  const persisted = bindImageReferenceSources([reply()], history)
  expect((persisted[0] as SDKUserMessage).imageEditReference?.sourceMessageId).toBe('source-a')
  expect(reply().imageEditReference).toEqual(reference)
  expect(JSON.stringify(history)).toBe(before)
  expect((bindImageReferenceSources([reply(), ...history], [])[0] as SDKUserMessage).imageEditReference?.sourceMessageId).toBeUndefined()
  expect((bindImageReferenceSources([...history, reply()], []).at(-1) as SDKUserMessage).imageEditReference?.sourceMessageId).toBe('source-a')
})
test('普通上传和无引用的旧消息保持原对象，不新增引用字段', () => {
  const plain = { ...reply(), imageEditReference: undefined }
  expect(bindImageReferenceSources([plain], generated())[0]).toBe(plain)
})
test('渲染恢复仅使用当前用户消息之前的历史，也兼容唯一 UUID 的重新加载对象', () => {
  const user = reply()
  expect(resolveUserImageReferenceSource(user, [user, ...generated()])).toBeUndefined()
  expect(resolveUserImageReferenceSource(user, [...generated(), user])).toBe('source-a')
  expect(resolveUserImageReferenceSource({ ...user }, [...generated(), user])).toBe('source-a')
  expect(resolveUserImageReferenceSource({ ...user }, [...generated(), user, { ...user }])).toBeUndefined()
  expect(resolveUserImageReferenceSource(user, generated())).toBeUndefined()
})

test('原生历史引用只接受同会话中精确的前序消息和托管 PNG，重名与相同字节不替代来源', () => {
  const sourceAttachmentPath = 'session-a/legacy-' + 'a'.repeat(64) + '.png'
  const archive: SDKUserMessage = { ...reply(), session_id: 'session-a', uuid: 'source-a', _electronImported: true, imageEditReference: undefined,
    _importedFiles: [{ filename: 'fixture.jpg', path: sourceAttachmentPath, mediaType: 'image/png' }] }
  const assistant = { ...archive, type: 'assistant', uuid: 'source-b' } as SDKAssistantMessage
  const ref = { ...reference, sourceMessageId: 'source-b', sourceAttachmentPath }
  const sent = reply(ref)
  const history = [archive, assistant, sent]
  expect(resolveUserImageReferenceSource(sent, history, 'session-a')).toBe('source-b')
  const userSource = reply({ ...ref, sourceMessageId: 'source-a' })
  expect(resolveUserImageReferenceSource(userSource, [archive, userSource], 'session-a')).toBe('source-a')
  expect(resolveUserImageReferenceSource(sent, history, 'session-b')).toBeUndefined()
  expect(resolveUserImageReferenceSource(sent, history)).toBeUndefined()
  expect(resolveUserImageReferenceSource(sent, [archive, sent, assistant], 'session-a')).toBeUndefined()
  expect(resolveUserImageReferenceSource(sent, [archive, { ...assistant, _importedFiles: [] }, sent], 'session-a')).toBeUndefined()
  expect(resolveUserImageReferenceSource(sent, [archive, assistant, assistant, sent], 'session-a')).toBeUndefined()
})

test('已生图的原生与 Electron 历史保持原跳转，原生上下文拒绝其他会话的产物', () => {
  const sent = reply({ ...reference, sourceMessageId: 'source-a' })
  const history = [...generated(), sent]
  expect(resolveUserImageReferenceSource(sent, history)).toBe('source-a')
  expect(resolveUserImageReferenceSource(sent, history, 'session-a')).toBe('source-a')
  expect(resolveUserImageReferenceSource(sent, history, 'session-b')).toBeUndefined()
})
