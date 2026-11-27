/** 引用只绑定同一历史中确定的图片产物和 SDK UUID，不能由显示文字或 latest 推断。 */
import type { SDKMessage, SDKUserMessage, SDKAssistantMessage, SDKToolResultBlock, UserImageEditReference } from '../types/agent.ts'
import { IMAGE_GENERATION_TOOL } from './image-request-authorization.ts'

function resultMatches(result: SDKToolResultBlock, reference: UserImageEditReference): boolean {
  if (result.is_error) return false
  const text = typeof result.content === 'string' ? result.content
    : Array.isArray(result.content) ? result.content.filter(block => block.type === 'text').map(block => 'text' in block ? block.text : '').join('\n') : ''
  try {
    const data = JSON.parse(text) as { imageId?: unknown; generatedImage?: { localPath?: unknown } }
    return data.imageId === reference.imageId && data.generatedImage?.localPath === reference.localPath
  } catch { return false }
}

export function resolveImageReferenceSource(reference: UserImageEditReference, messages: readonly SDKMessage[]): string | undefined {
  const results = new Map<string, SDKToolResultBlock[]>()
  for (const message of messages) {
    if (message.type !== 'user') continue
    const user = message as SDKUserMessage
    if (!Array.isArray(user.message?.content)) continue
    for (const block of user.message.content) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
      const matches = results.get(block.tool_use_id) ?? []
      matches.push(block as SDKToolResultBlock); results.set(block.tool_use_id, matches)
    }
  }
  const candidates = new Set<string>()
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    const assistant = message as SDKAssistantMessage
    if (typeof assistant.uuid !== 'string' || !assistant.uuid || !Array.isArray(assistant.message?.content)) continue
    for (const block of assistant.message.content) {
      if (block.type !== 'tool_use' || block.name !== IMAGE_GENERATION_TOOL || typeof block.id !== 'string') continue
      const matching = results.get(block.id)
      if (matching?.length === 1 && resultMatches(matching[0]!, reference)) candidates.add(assistant.uuid)
    }
  }
  if (reference.sourceMessageId && candidates.has(reference.sourceMessageId)) return reference.sourceMessageId
  return candidates.size === 1 ? candidates.values().next().value : undefined
}

/** 按时间顺序只验证已发生的来源；不改写历史、普通消息或调用者持有的对象。 */
export function bindImageReferenceSources(messages: SDKMessage[], history: readonly SDKMessage[]): SDKMessage[] {
  const preceding = [...history]
  return messages.map(message => {
    let bound = message
    const user = message.type === 'user' ? message as SDKUserMessage : undefined
    if (user?.imageEditReference) {
      const reference = user.imageEditReference
      const sourceMessageId = resolveImageReferenceSource(reference, preceding)
      if (reference.sourceMessageId !== sourceMessageId) bound = { ...message, imageEditReference: { ...reference, sourceMessageId } }
    }
    preceding.push(bound)
    return bound
  })
}

/** 历史渲染也只看该用户消息之前的来源，绝不把后来出现的同名产物当作旧引用。 */
export function resolveUserImageReferenceSource(message: SDKUserMessage, messages: readonly SDKMessage[], nativeSessionId?: string | null): string | undefined {
  if (!message.imageEditReference) return undefined
  let index = messages.indexOf(message)
  if (index < 0 && message.uuid) {
    const matches = messages.map((item, position) => ({ item, position })).filter(({ item }) => item.type === 'user' && (item as SDKUserMessage).uuid === message.uuid)
    if (matches.length === 1) index = matches[0]!.position
  }
  if (index < 0) return undefined
  const reference = message.imageEditReference
  if (nativeSessionId && (reference.localPath.split('/')[0] !== nativeSessionId
    || (message.session_id && message.session_id !== nativeSessionId))) return undefined
  const preceding = messages.slice(0, index)
  if (reference.sourceAttachmentPath === undefined) return resolveImageReferenceSource(reference, preceding)

  // 旧附件没有生图工具记录；只接受当前原生会话宿主投影的精确消息和托管附件。
  const { sourceMessageId, sourceAttachmentPath } = reference
  if (!nativeSessionId || !sourceMessageId
    || /^([\w-]+)\/legacy-[a-f0-9]{64}\.png$/.exec(sourceAttachmentPath)?.[1] !== nativeSessionId) return undefined
  const owners = preceding.filter((item): item is SDKUserMessage | SDKAssistantMessage =>
    (item.type === 'user' || item.type === 'assistant') && item.uuid === sourceMessageId)
  const owner = owners[0]
  if (owners.length !== 1 || owner?._electronImported !== true || owner.session_id !== nativeSessionId) return undefined
  return Array.isArray(owner._importedFiles) && owner._importedFiles.some(file => file?.path === sourceAttachmentPath && file.mediaType === 'image/png')
    ? sourceMessageId : undefined
}
