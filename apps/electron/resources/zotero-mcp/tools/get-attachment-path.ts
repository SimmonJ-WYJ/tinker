/**
 * zotero_get_attachment_path: 取 Zotero 附件的绝对文件路径
 *
 * 调用方式：
 *   1. { itemKey } — 默认返回该 item 下第一个 imported PDF（保持向后兼容）
 *   2. { itemKey, attachmentKey } — 返回指定附件的路径，不限 contentType；
 *      支持 imported_file / imported_url / linked_file 三种 linkMode
 *
 * linked_file 解析：
 *   - 绝对路径 → 原样返回
 *   - `attachments:relative/path` 前缀 → 需要 ZOTERO_LINKED_BASE_DIR 环境变量拼接
 *   - 缺 path 字段或 base dir 未配置 → 返回 reason 让调用方知晓
 *
 * Agent 拿到路径后用内置 Read 工具读取；若是图片建议走 ocr_image（asci-ocr MCP server）。
 */

import { isAbsolute, join as pathJoin } from 'node:path'
import { fetchZotero } from '../../../src/main/lib/zotero-client/api-client.ts'
import { buildAttachmentPath } from '../../../src/main/lib/zotero-client/data-dir.ts'
import {
  isAttachmentItem,
  type GetAttachmentPathResult,
  type ZoteroAttachment,
  type ZoteroItem,
} from '@asci/core/zotero'

export type { GetAttachmentPathResult }

export interface GetAttachmentPathInput {
  itemKey: string
  attachmentKey?: string
}

export async function handleGetAttachmentPath(input: GetAttachmentPathInput): Promise<GetAttachmentPathResult> {
  // 先看 itemKey 本身是不是 attachment（顶层附件，典型用法：图片/音频直接作为 Zotero item）
  const item = await fetchZotero<ZoteroItem>(`/users/0/items/${input.itemKey}?format=json`)
  if (isAttachmentItem(item)) {
    if (input.attachmentKey && input.attachmentKey !== item.key) {
      return { found: false, reason: 'not_found' }
    }
    return resolveAttachmentPath(item)
  }

  // itemKey 是 parent item（journalArticle 等），去 /children 取附件
  const children = await fetchZotero<ZoteroItem[]>(`/users/0/items/${input.itemKey}/children?format=json`)
  const attachments = children.filter(isAttachmentItem)

  if (attachments.length === 0) {
    return { found: false }
  }

  if (input.attachmentKey) {
    const target = attachments.find((a) => a.key === input.attachmentKey)
    if (!target) {
      return { found: false, reason: 'not_found' }
    }
    return resolveAttachmentPath(target)
  }

  // 默认：首个 imported PDF（旧调用方期望）
  const pdf = attachments.find((a) =>
    a.data.contentType === 'application/pdf'
    && (a.data.linkMode === 'imported_file' || a.data.linkMode === 'imported_url'),
  )
  if (!pdf) {
    return { found: false, reason: 'unsupported_type' }
  }

  return resolveAttachmentPath(pdf)
}

function resolveAttachmentPath(att: ZoteroAttachment): GetAttachmentPathResult {
  const { key, data } = att
  switch (data.linkMode) {
    case 'imported_file':
    case 'imported_url':
      return {
        found: true,
        path: buildAttachmentPath(key, data.filename),
        filename: data.filename,
        contentType: data.contentType,
      }
    case 'linked_file': {
      const raw = typeof data.path === 'string' ? data.path : ''
      if (!raw) return { found: false, reason: 'linked_file_path_missing' }
      if (raw.startsWith('attachments:')) {
        const base = process.env.ZOTERO_LINKED_BASE_DIR
        if (!base) return { found: false, reason: 'linked_file_base_dir_unset' }
        return {
          found: true,
          path: pathJoin(base, raw.slice('attachments:'.length)),
          filename: data.filename,
          contentType: data.contentType,
        }
      }
      if (!isAbsolute(raw)) return { found: false, reason: 'linked_file_base_dir_unset' }
      return {
        found: true,
        path: raw,
        filename: data.filename,
        contentType: data.contentType,
      }
    }
    case 'linked_url':
      return { found: false, reason: 'linked_url_no_file' }
  }
}

export const getAttachmentPathToolDefinition = {
  name: 'zotero_get_attachment_path',
  description:
    '取 Zotero 条目下附件的绝对文件路径。'
    + '不传 attachmentKey 时返回第一个 imported PDF（向后兼容）；'
    + '传 attachmentKey 可返回任意 contentType 的附件（PDF/图片/Office/HTML 均可），'
    + '并支持 linked_file（外部链接文件，需要 ZOTERO_LINKED_BASE_DIR 环境变量解析 attachments: 相对前缀）。'
    + 'linked_url 无本地文件返回 found:false。'
    + '图片附件拿到路径后推荐使用 ocr_image 工具识别内容（asci-ocr MCP server，本机 PaddleOCR，离线）。',
  inputSchema: {
    type: 'object',
    properties: {
      itemKey: { type: 'string' },
      attachmentKey: { type: 'string' },
    },
    required: ['itemKey'],
    additionalProperties: false,
  },
} as const
