/**
 * Papers-RG MCP smoke test
 *
 * 直接用 papers-rg-tool 的 handler 函数对真实 wiki 目录跑一次 search + read context，
 * 跳过 SDK MCP 协议层，最快验证"安装的 rg / wiki 路径解析 / 端到端流程"是否通畅。
 *
 * 用法：
 *   bun run apps/electron/scripts/smoke-papers-rg.ts <关键词> [paperId]
 *
 * 例：
 *   bun run apps/electron/scripts/smoke-papers-rg.ts "transformer"
 *   bun run apps/electron/scripts/smoke-papers-rg.ts "attention" 5S3NFFM9
 *
 * wiki 目录解析：
 *   - 默认走 ASCI_DEV=1 时的 ~/.asci-dev/zotero/wiki/
 *   - 通过 ASCI_WIKI_DIR 显式覆盖（适合临时换目录）
 */

import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  createReadContextHandler,
  createSearchHandler,
  findRgBinFromPackage,
  resolveRgBin,
} from '../src/main/mcp/papers-rg-tool.ts'

function resolveWikiDir(): string {
  if (process.env.ASCI_WIKI_DIR) return process.env.ASCI_WIKI_DIR
  const isDev = process.env.ASCI_DEV === '1' || process.env.NODE_ENV !== 'production'
  const root = join(homedir(), isDev ? '.asci-dev' : '.asci', 'zotero', 'wiki')
  return root
}

async function main(): Promise<void> {
  const [, , query, paperId] = process.argv
  if (!query) {
    console.error('用法: bun run apps/electron/scripts/smoke-papers-rg.ts <关键词> [paperId]')
    process.exit(2)
  }

  const wikiDir = resolveWikiDir()
  console.log(`[smoke] wikiDir = ${wikiDir}`)
  console.log(`[smoke] rgBin   = ${resolveRgBin()}`)
  console.log(`[smoke] @vscode/ripgrep binary: ${findRgBinFromPackage() ?? '(未找到，回落系统 rg)'}`)

  if (!existsSync(wikiDir)) {
    console.error(`[smoke] wiki 目录不存在: ${wikiDir}`)
    console.error('  → 请先在应用里同步 Zotero 并跑一次 PDF 解析；或设置 ASCI_WIKI_DIR 指向已有 md 目录')
    process.exit(1)
  }

  const search = createSearchHandler({ wikiDir })
  const t0 = Date.now()
  const searchRes = await search(
    paperId
      ? { query, paperIds: [paperId], maxResults: 20 }
      : { query, maxResults: 20 },
    {},
  )
  const dt = Date.now() - t0

  if (searchRes.isError) {
    console.error(`[smoke] search 出错：${(searchRes.content[0] as { text: string }).text}`)
    process.exit(1)
  }

  const out = JSON.parse((searchRes.content[0] as { text: string }).text) as {
    query: string
    total: number
    truncated: boolean
    hits: Array<{ paperId: string; lineNumber: number; byteOffset: number; snippet: string }>
  }

  console.log(`\n[smoke] search 完成 (${dt} ms)：query="${out.query}" total=${out.total}${out.truncated ? ' (truncated)' : ''}`)
  for (const h of out.hits.slice(0, 10)) {
    console.log(`  · ${h.paperId} L${h.lineNumber} @${h.byteOffset}: ${h.snippet}`)
  }
  if (out.hits.length > 10) console.log(`  ... 另有 ${out.hits.length - 10} 条`)

  if (out.hits.length === 0) {
    console.log('\n[smoke] 没有命中，跳过 read_context 验证')
    return
  }

  const first = out.hits[0]!
  const reader = createReadContextHandler({ wikiDir })
  const ctxRes = await reader({ paperId: first.paperId, offset: first.byteOffset, n: 200 }, {})
  if (ctxRes.isError) {
    console.error(`\n[smoke] read_context 出错：${(ctxRes.content[0] as { text: string }).text}`)
    process.exit(1)
  }
  const ctx = JSON.parse((ctxRes.content[0] as { text: string }).text) as {
    paperId: string
    fileSize: number
    rangeStart: number
    rangeEnd: number
    cursorOffsetInText: number
    text: string
  }
  console.log(`\n[smoke] read_context (${first.paperId} @${first.byteOffset}, n=200)：`)
  console.log(`  fileSize=${ctx.fileSize} range=[${ctx.rangeStart}..${ctx.rangeEnd}] cursor@${ctx.cursorOffsetInText}`)
  const before = ctx.text.slice(0, ctx.cursorOffsetInText)
  const after = ctx.text.slice(ctx.cursorOffsetInText)
  console.log(`  ───── 前 ${before.length} 字节 ─────`)
  console.log(before)
  console.log(`  ───── ▼ offset 落点 ▼ ─────`)
  console.log(after)
}

main().catch((err) => {
  console.error('[smoke] 未捕获异常：', err)
  process.exit(1)
})
