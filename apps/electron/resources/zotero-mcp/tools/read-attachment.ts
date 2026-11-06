/**
 * zotero_read_attachment: 读取 Zotero 附件的**提取后文本**
 *
 * 用途：让 Agent 一次调用就拿到文档内容，不再两步走（get_attachment_path → Read）。
 *
 * 支持类型：PDF / DOC / DOCX / XLSX / PPTX / ODT / ODP / ODS / TXT / MD / CSV / JSON /
 *   XML / HTML / 代码文件 等（走 document-extractor）
 *
 * 明确不支持（会结构化报错并指引到对应工具）：
 *   - image/*  → 先 zotero_get_attachment_path 拿路径，再 ocr_image（独立 asci-ocr MCP server）
 *   - audio/*  → 未来的 zotero_describe_audio（P2）
 *
 * 附件布局：
 *   - 嵌套附件：itemKey 是 parent，attachmentKey 是 child
 *   - 顶层附件：itemKey 本身就是 attachment（itemKey === attachmentKey 或省略 attachmentKey）
 *
 * 截断：默认 50000 字（stdio 友好、防止 token 打爆）；超出设 truncated=true，charCount 保留原始总长
 */

import { existsSync, statSync } from 'node:fs'
import { fetchZotero } from '../../../src/main/lib/zotero-client/api-client.ts'
import { buildAttachmentPath } from '../../../src/main/lib/zotero-client/data-dir.ts'
import { extractTextFromFile } from '../../../src/main/lib/document-extractor.ts'
import {
  isAttachmentItem,
  type ZoteroAttachment,
  type ZoteroItem,
} from '@asci/core/zotero'

export interface ReadAttachmentInput {
  itemKey: string
  attachmentKey?: string
  /** 返回文本最大字符数，默认 50000 */
  maxChars?: number
}

export interface ReadAttachmentOutput {
  text: string
  truncated: boolean
  contentType: string
  filename: string
  /** 提取出的原始文本总字符数（未截断前） */
  charCount: number
  /** 源文件大小（字节） */
  sourceSize: number
}

export class ReadAttachmentToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly retryable?: boolean,
  ) {
    super(message)
    this.name = 'ReadAttachmentToolError'
  }
}

const DEFAULT_MAX_CHARS = 50_000

export async function handleReadAttachment(input: ReadAttachmentInput): Promise<ReadAttachmentOutput> {
  const { itemKey, attachmentKey, maxChars = DEFAULT_MAX_CHARS } = input

  // 1. 解析附件 metadata（兼容顶层附件）
  const attachment = await resolveAttachment(itemKey, attachmentKey)

  // 2. 类型守卫：图片/音频走另外的工具
  const contentType = attachment.data.contentType
  if (contentType.startsWith('image/')) {
    throw new ReadAttachmentToolError(
      'ATTACHMENT_TYPE_UNSUPPORTED',
      `附件类型是 ${contentType}，图片请先用 zotero_get_attachment_path 拿路径，再调 ocr_image 工具识别（asci-ocr MCP server，本机 PaddleOCR）。`,
    )
  }
  if (contentType.startsWith('audio/')) {
    throw new ReadAttachmentToolError(
      'ATTACHMENT_TYPE_UNSUPPORTED',
      `附件类型是 ${contentType}，音频请先用 zotero_get_attachment_path 拿路径，再调 asr_audio 工具识别（asr MCP server，本机 sherpa-onnx + SenseVoice）。`,
    )
  }

  // 3. 取物理文件路径 + 验证存在
  const filePath = buildAttachmentPath(attachment.key, attachment.data.filename)
  if (!existsSync(filePath)) {
    throw new ReadAttachmentToolError(
      'ATTACHMENT_FILE_MISSING',
      `附件文件不在磁盘：${filePath}。可能是 linked_file、文件未同步、或 Zotero 存储路径不一致。`,
    )
  }
  const sourceSize = statSync(filePath).size

  // 4. 提取文本
  let fullText: string
  try {
    fullText = await extractTextFromFile(filePath)
  } catch (err) {
    throw new ReadAttachmentToolError(
      'EXTRACT_FAILED',
      `文本提取失败：${err instanceof Error ? err.message : String(err)}`,
      err,
    )
  }

  const charCount = fullText.length
  const truncated = charCount > maxChars
  const text = truncated ? fullText.slice(0, maxChars) : fullText

  return {
    text,
    truncated,
    contentType,
    filename: attachment.data.filename,
    charCount,
    sourceSize,
  }
}

/**
 * 解析附件 metadata：
 * - itemKey 自身是 attachment（顶层） → 返回它；attachmentKey 指定则必须一致
 * - itemKey 是 parent → 查 /children，找匹配的 attachmentKey；不传 key 时取首个 attachment
 */
/**
 * 当 itemKey 似乎不存在或不是合法的 Zotero item 时给的统一引导，
 * 让 agent 不再在错误的 key 上重试，而是先去 search/list 拿真实 key。
 */
const NEXT_ACTION_HINT =
  '下一步：先调用 zotero_search_items（按标题/作者搜索）或 zotero_list_collection_items（列集合内条目）拿到真实存在的 itemKey 再调用 zotero_read_attachment，禁止从对话上下文推测/编造 itemKey。'

async function resolveAttachment(itemKey: string, attachmentKey?: string): Promise<ZoteroAttachment> {
  let item: ZoteroItem
  try {
    item = await fetchZotero<ZoteroItem>(`/users/0/items/${itemKey}?format=json`)
  } catch (err) {
    // Zotero API 404（item 不存在）会抛 fetchZotero 内部错误；统一改为有引导的 NOT_FOUND
    throw new ReadAttachmentToolError(
      'ATTACHMENT_NOT_FOUND',
      `Zotero 条目 ${itemKey} 不存在或读取失败：${err instanceof Error ? err.message : String(err)}。${NEXT_ACTION_HINT}`,
      err,
    )
  }
  if (isAttachmentItem(item)) {
    if (attachmentKey && attachmentKey !== item.key) {
      throw new ReadAttachmentToolError(
        'ATTACHMENT_NOT_FOUND',
        `itemKey (${itemKey}) 本身是顶层附件，但与 attachmentKey (${attachmentKey}) 不匹配。${NEXT_ACTION_HINT}`,
      )
    }
    return item
  }

  const children = await fetchZotero<ZoteroItem[]>(`/users/0/items/${itemKey}/children?format=json`)
  const attachments = children.filter(isAttachmentItem)

  if (attachmentKey) {
    const target = attachments.find((a) => a.key === attachmentKey)
    if (!target) {
      throw new ReadAttachmentToolError(
        'ATTACHMENT_NOT_FOUND',
        `Zotero 条目 ${itemKey} 下未找到附件 ${attachmentKey}。${NEXT_ACTION_HINT}`,
      )
    }
    return target
  }

  // 不传 attachmentKey → 取首个 attachment（PDF 优先，否则第一个）
  if (attachments.length === 0) {
    throw new ReadAttachmentToolError(
      'ATTACHMENT_NOT_FOUND',
      `Zotero 条目 ${itemKey} 没有任何附件。${NEXT_ACTION_HINT}`,
    )
  }
  const pdf = attachments.find((a) => a.data.contentType === 'application/pdf')
  return pdf ?? attachments[0]
}

export const readAttachmentToolDefinition = {
  name: 'zotero_read_attachment',
  description:
    '读取 Zotero 附件的提取后文本内容（PDF/Word/Excel/PPT/OpenDocument/纯文本/Markdown/代码等）。'
    + '一次调用直接拿到文本，不需要再用 Read 工具读路径。'
    + '不传 attachmentKey 时优先返回该条目下的 PDF，否则是第一个附件。'
    + '图片附件请先 zotero_get_attachment_path 拿路径再 ocr_image（asci-ocr MCP server）；音频识别未来版本支持。'
    + '默认最多返回 50000 字符，超出会设 truncated=true 并在 charCount 里保留原始总长。',
  inputSchema: {
    type: 'object',
    properties: {
      itemKey: { type: 'string' },
      attachmentKey: { type: 'string' },
      maxChars: { type: 'number', minimum: 1 },
    },
    required: ['itemKey'],
    additionalProperties: false,
  },
} as const
