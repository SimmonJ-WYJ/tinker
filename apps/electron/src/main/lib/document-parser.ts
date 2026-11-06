/**
 * 文档解析服务（主进程入口）
 *
 * 纯文本提取逻辑已拆到 ./document-extractor.ts（无 Electron 依赖，可被 MCP 子进程复用）。
 * 本文件保留用到 Electron `app` 路径的 `extractTextFromAttachment`，并 re-export 其它纯函数。
 */

import { resolveAttachmentPath } from './config-paths'
import { extractTextFromFile } from './document-extractor'

export {
  extractTextFromFile,
  isSupportedDocumentExtension,
  isDocumentAttachment,
} from './document-extractor'

/**
 * 从附件相对路径提取文本（IPC 层使用）
 *
 * 将附件的 localPath（如 {conversationId}/{uuid}.ext）
 * 解析为完整路径后提取文本。
 */
export async function extractTextFromAttachment(localPath: string): Promise<string> {
  const fullPath = resolveAttachmentPath(localPath)
  return extractTextFromFile(fullPath)
}
