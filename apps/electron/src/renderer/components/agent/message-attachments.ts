/** 用户上传元数据与正文解析；不会把附件变为历史引用。 */
import type { SDKUserMessage, SDKAssistantMessage } from '@asci/shared'

/** 解析的附件引用 */
export interface AttachedFileRef {
  filename: string
  path: string
  mediaType?: string
}

/** 解析消息中的 <attached_files> 块，返回文件列表和剩余文本 */
export function parseAttachedFiles(content: string): { files: AttachedFileRef[]; text: string } {
  const regex = /<attached_files>\n?([\s\S]*?)\n?<\/attached_files>\n*/
  const match = content.match(regex)
  if (!match) return { files: [], text: content }

  const files: AttachedFileRef[] = []
  const lines = match[1]!.split('\n')
  for (const line of lines) {
    const lineMatch = line.match(/^-\s+(.+?):\s+(.+)$/)
    if (lineMatch) {
      files.push({ filename: lineMatch[1]!.trim(), path: lineMatch[2]!.trim() })
    }
  }

  const text = content.replace(regex, '').trim()
  return { files, text }
}

/** 判断文件是否为图片类型 */
export function isImageFile(filename: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(filename)
}


export function extractUserText(message: SDKUserMessage): string | null {
  const content = message.message?.content
  if (!Array.isArray(content)) return null

  const texts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && 'text' in block) {
      texts.push((block as { text: string }).text)
    }
  }

  return texts.length > 0 ? texts.join('\n') : null
}

export function isImportedConversationMessage(message: SDKUserMessage | SDKAssistantMessage): boolean {
  return typeof window !== 'undefined' && !!window.__TAURI_FORMAL__?.importSessions
    && (message._electronImported === true || '_importedFiles' in message)
}

/** 导入会话的图片/文本只来自宿主清单；显示名不会决定解码格式或读取路径。 */
export function importedAttachmentFiles(message: SDKUserMessage | SDKAssistantMessage): AttachedFileRef[] {
  if (!Array.isArray(message._importedFiles) || !message.session_id) return []
  const result: AttachedFileRef[] = []
  const seen = new Set<string>()
  for (const file of message._importedFiles) {
    if (!file || typeof file.filename !== 'string' || !file.filename || typeof file.path !== 'string') continue
    const match = /^([\w-]+)\/legacy-[a-f0-9]{64}\.(png|txt)$/.exec(file.path)
    if (!match || match[1] !== message.session_id || seen.has(file.path)) continue
    const allowed = match[2] === 'png'
      ? file.mediaType === 'image/png'
      : file.mediaType === 'text/plain' || file.mediaType === 'text/markdown'
    if (!allowed) continue
    result.push(file)
    seen.add(file.path)
  }
  return result
}
