/** 原生图片动作只来自当前用户请求。恢复 SDK 行时仅提取最近一轮的确定版本，不发起生成。 */
import { requestsImage, visibleImageInstruction, type SDKMessage, type SDKUserMessage } from '@asci/shared'
import { collectImageVersions } from '../renderer/components/agent/image-versions.ts'

export function restoredTurnImageId(messages: SDKMessage[], sessionId: string): string | undefined {
  const start = messages.findLastIndex(item => {
    if (item.type !== 'user') return false
    const user = item as SDKUserMessage
    if (user.parent_tool_use_id || user.isSynthetic) return false
    const blocks = user.message?.content
    return typeof blocks === 'string' || Array.isArray(blocks)
      && !blocks.some(block => block.type === 'tool_result') && blocks.some(block => block.type === 'text')
  })
  if (start < 0) return undefined
  return collectImageVersions(messages.slice(start))
    .findLast(version => version.generatedImage.localPath.split('/')[0] === sessionId)?.imageId
}

export function classifyNativeImageSend(input: Record<string, unknown>, previousId?: string) {
  if (typeof input.userMessage !== 'string') return undefined
  const userMessage = input.userMessage
  const instruction = visibleImageInstruction(userMessage)
  const selected = typeof input.imageEditReferenceId === 'string' ? input.imageEditReferenceId : undefined
  const source = selected ?? previousId
  const mentionsSource = /(?:基于|根据|参考|在)\s*(?:这|刚才那?|之前那?|上[一张])(?:一?张)?(?:图片|图像|海报|照片|图)|\b(?:based on|using|from)\s+(?:(?:the|my)\s+)?(?:this|previous|last|selected|original)\s+(?:image|picture|photo|poster)\b/i.test(instruction)
  // 指明沿用源图时，交给宿主验证该会话的已提交来源；不能静默退化为独立新图。
  if (requestsImage({ userMessage })) {
    if (selected || mentionsSource) return { nativeImageAction: 'edit', ...(source && { imageEditReferenceId: source }) } as const
    return { nativeImageAction: 'generate' } as const
  }
  if (!source) return undefined
  // 展开省略的视觉宾语后仍走同一请求策略，保留整句中的疑问、撤回与讨论限定。
  const contextualText = instruction.replace(/^(?:please\s+)?(?:change|replace|turn|make)\s+(?:the\s+)?(?:background|foreground|colou?r|title|caption|font)\b/i, 'edit this image $&')
  if (requestsImage({
    userMessage: contextualText, selectedImageId: source, referenceImageIds: [source], previousImageTask: Boolean(previousId || selected),
  })) return { nativeImageAction: 'edit', imageEditReferenceId: source } as const
  return undefined
}

/** 讨论计费和授权时保留选图草稿，只发送用户文字；看图分析需要视觉模型。 */
export function selectedImageUse(userMessage: string, imageId: string): 'edit' | 'text' | 'inspect' {
  if (classifyNativeImageSend({ userMessage, imageEditReferenceId: imageId })) return 'edit'
  return /(?:计费|费用|收费|价格|多少钱|账单|权限|批准|教程|命令)|\b(?:cost|costs|pricing|price|billing|charge|charges|permission|approval|tutorial)\b/i.test(userMessage) ? 'text' : 'inspect'
}

interface ImageContext { imageId?: string; sending?: true }

/** 每次写入更换会话身份，旧的恢复响应与超时的发送都不能覆盖新一轮的来源。 */
export function createNativeImageContexts() {
  const sessions = new Map<string, ImageContext>()
  function setImage(sessionId: string, imageId?: string) {
    if (imageId) sessions.set(sessionId, { imageId })
    else sessions.delete(sessionId)
  }
  return {
    restore(sessionId: string) {
      const observed = sessions.get(sessionId) ?? {}
      sessions.set(sessionId, observed)
      return (messages?: SDKMessage[]) => {
        if (!observed.sending && sessions.get(sessionId) === observed) {
          if (messages) setImage(sessionId, restoredTurnImageId(messages, sessionId))
          else if (!observed.imageId) sessions.delete(sessionId)
        }
      }
    },
    async send<T>(
      input: Record<string, unknown>, invoke: (input: Record<string, unknown>) => Promise<{value:T; imageId?:string}>,
      invalidSelection: () => Error, changed: () => void,
    ): Promise<T> {
      if (typeof input.sessionId !== 'string') return (await invoke(input)).value
      const sid = input.sessionId
      const action = classifyNativeImageSend(input, sessions.get(sid)?.imageId)
      let outgoing = input
      if (action) outgoing = { ...input, ...action }
      else if (typeof input.imageEditReferenceId === 'string') {
        if (typeof input.userMessage !== 'string' || selectedImageUse(input.userMessage, input.imageEditReferenceId) !== 'text') throw invalidSelection()
        outgoing = { ...input }
        delete outgoing.imageEditReferenceId
      }
      const owner: ImageContext = { sending: true }
      sessions.set(sid, owner)
      try {
        const reply = await invoke(outgoing)
        if (action && typeof reply.imageId === 'string' && sessions.get(sid) === owner) setImage(sid, reply.imageId)
        if (action) changed()
        return reply.value
      } finally {
        if (sessions.get(sid) === owner) sessions.delete(sid)
      }
    },
    forget(sessionId: string) { sessions.delete(sessionId) },
  }
}
