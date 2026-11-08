/** 用户上传元数据与正文解析；不会把附件变为历史引用。 */
import type { SDKUserMessage } from '@asci/shared'

/** 解析的附件引用 */
export interface AttachedFileRef {
  filename: string
  path: string
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
