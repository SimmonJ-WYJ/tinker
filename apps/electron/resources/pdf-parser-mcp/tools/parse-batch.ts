/**
 * pdf_parse_batch: 并行解析一批 PDF，产出 txt 到工作区 parsed-papers/ 目录
 *
 * 缓存策略（按约定）：
 *   - 目标路径 {ASCI_WORKSPACE_DIR}/parsed-papers/{itemKey}.txt
 *   - 若 txt 存在且 mtime >= pdf mtime → 视为缓存命中，status='cached'
 *   - 否则重新解析并覆盖
 *
 * 并发控制：同批最多 4 个 PDF 并行，避免大批量吃爆内存
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>

const CONCURRENCY = 4

export interface ParseItem {
  itemKey: string
  pdfPath: string
}

export interface ParseResult {
  itemKey: string
  pdfPath: string
  textPath?: string
  textBytes?: number
  status: 'ok' | 'cached' | 'error'
  error?: string
}

export interface BatchInput {
  items: ParseItem[]
}

export interface BatchOutput {
  results: ParseResult[]
}

function resolveWorkspaceDir(): string {
  const dir = process.env.ASCI_WORKSPACE_DIR
  if (!dir) {
    throw new Error(
      'ASCI_WORKSPACE_DIR 环境变量未设置；该 MCP 服务器必须由 ASCI agent-orchestrator 拉起。',
    )
  }
  return dir
}

function buildTextPath(workspaceDir: string, itemKey: string): string {
  return join(workspaceDir, 'parsed-papers', `${itemKey}.txt`)
}

async function parseOne(item: ParseItem, workspaceDir: string): Promise<ParseResult> {
  try {
    if (!existsSync(item.pdfPath)) {
      return {
        itemKey: item.itemKey,
        pdfPath: item.pdfPath,
        status: 'error',
        error: `PDF 文件不存在: ${item.pdfPath}`,
      }
    }

    const textPath = buildTextPath(workspaceDir, item.itemKey)

    // 缓存命中：txt 存在且 mtime >= pdf mtime
    if (existsSync(textPath)) {
      const pdfMtime = statSync(item.pdfPath).mtimeMs
      const txtStat = statSync(textPath)
      if (txtStat.mtimeMs >= pdfMtime) {
        return {
          itemKey: item.itemKey,
          pdfPath: item.pdfPath,
          textPath,
          textBytes: txtStat.size,
          status: 'cached',
        }
      }
    }

    // 解析 + 写盘
    const buf = readFileSync(item.pdfPath)
    const { text } = await pdfParse(buf)
    mkdirSync(dirname(textPath), { recursive: true })
    writeFileSync(textPath, text, 'utf-8')
    const size = statSync(textPath).size

    return {
      itemKey: item.itemKey,
      pdfPath: item.pdfPath,
      textPath,
      textBytes: size,
      status: 'ok',
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      itemKey: item.itemKey,
      pdfPath: item.pdfPath,
      status: 'error',
      error: message,
    }
  }
}

/**
 * 简易并发池：同时最多跑 CONCURRENCY 个 parseOne
 */
async function runWithConcurrency(
  items: ParseItem[],
  workspaceDir: string,
): Promise<ParseResult[]> {
  const results: ParseResult[] = new Array(items.length)
  let cursor = 0

  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) return
      const item = items[idx]!
      results[idx] = await parseOne(item, workspaceDir)
    }
  }

  const workerCount = Math.min(CONCURRENCY, items.length)
  const workers: Promise<void>[] = []
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker())
  }
  await Promise.all(workers)
  return results
}

export async function handleParseBatch(input: BatchInput): Promise<BatchOutput> {
  if (!Array.isArray(input?.items) || input.items.length === 0) {
    return { results: [] }
  }

  // 参数校验：每项必须有 itemKey + pdfPath
  for (const it of input.items) {
    if (!it || typeof it.itemKey !== 'string' || typeof it.pdfPath !== 'string') {
      throw new Error('items 中存在缺失 itemKey 或 pdfPath 的条目')
    }
  }

  const workspaceDir = resolveWorkspaceDir()
  const results = await runWithConcurrency(input.items, workspaceDir)
  return { results }
}

export const parseBatchToolDefinition = {
  name: 'pdf_parse_batch',
  description:
    '并行解析一批 PDF 为纯文本，结果落到工作区 parsed-papers/{itemKey}.txt。每次解析都有缓存（txt 新于 pdf 时复用）。返回每篇论文的 status（ok / cached / error）和 textPath。调用方（Agent）拿到 textPath 后用内置 Read 工具读取文本。',
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            itemKey: { type: 'string', description: 'Zotero item key，用作输出 txt 文件名' },
            pdfPath: { type: 'string', description: 'PDF 绝对路径' },
          },
          required: ['itemKey', 'pdfPath'],
          additionalProperties: false,
        },
        description: '待解析的 PDF 列表',
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
} as const
