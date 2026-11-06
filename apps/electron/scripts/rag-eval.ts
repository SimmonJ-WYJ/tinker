/**
 * RAG 检索链路对比评估（dev-only 工具，committed 但**不进打包**——scripts/ 不在 electron-builder files 白名单）
 *
 * 目的：在**真实** `~/.asci(-dev)` 语料 + 索引库 + 本地模型上，对同一批 query 对齐对比五条检索链路
 * 返回的证据条目，量化「向量库到底比 ripgrep 老路强在哪 / 弱在哪」。与 `docs/superpowers/`
 * 下的「综述链路 playbook」互补：本脚本测**召回层**（证据条目对齐），playbook 测**任务层**（最终综述）。
 *
 * 五路：
 *   1. ripgrep.md   —— 老路 papers_search_keywords 的真实行为（rg 搜 wiki/*.md，含 .article.md）
 *   2. ripgrep.txt  —— 同样 rg，但搜排版感知的 structured *.txt（实测优于 .md）
 *   3. FTS5         —— 向量库里清洗切好的 chunk 上的 BM25（trigram）
 *   4. 向量          —— e5-small 语义 KNN（vec0）
 *   5. 混合          —— 向量 ∪ FTS5 经 RRF 融合（= papers_semantic_search 的真实行为）
 *
 * 为什么不是 `bun test`：真实语义召回要加载 onnx 模型 + onnxruntime-node / better-sqlite3 / sqlite-vec
 * 三个 Electron-ABI native 模块，bun 测试运行时加载不了；故经 `ELECTRON_RUN_AS_NODE=1 electron` 执行。
 *
 * 跑法（见 package.json 的 eval:rag）：
 *   bun run eval:rag                                              # 用内置默认 query 集
 *   bun run eval:rag -- "GQA" "KV cache"                          # 指定 query
 *   bun run eval:rag -- --file scripts/rag-eval-queries.txt       # 从文件读（一行一个 `query | 分类`）
 *   bun run eval:rag -- --file scripts/rag-eval-queries.txt --out ../../docs/superpowers/rag-eval-results
 *   bun run eval:rag -- --top 8 "注意力 显存 优化"
 *
 * --out <dir>：把每条 query 的五路结果写成可人工判断准确度的 markdown（每路一张带「相关?」列的表），
 *              并生成 summary.md（命中数矩阵 + 各路覆盖率）。控制台始终打印简表。
 * --jsonl <baseDir>：在 baseDir/<runId>/run.jsonl 写**版本化机器可读 JSONL**（line0=RunMeta 指纹，
 *              其后每行一个 query 的五路 ranked hits）。这是「召回层」的稳定契约，供未来全 TS judge
 *              消费打分（重打分不重检索 / 跨索引版本 diff）。与 --out 并存、互不替换。
 *
 * 数据源：ASCI_DEV=1 → 读 ~/.asci-dev（与 `bun run dev` 一致）；不设则读 ~/.asci。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { createRequire } from 'node:module'

import {
  getEmbeddingModelsDir,
  getZoteroVectorIndexPath,
  getZoteroWikiDir,
} from '../src/main/lib/config-paths.ts'
import { isLowQualityText } from '../src/main/lib/zotero-embedding-index/chunker.ts'
import { E5Embedder, EMBEDDING_MODEL } from '../src/main/lib/zotero-embedding-index/embedder.ts'
import { ZoteroVectorDb } from '../src/main/lib/zotero-embedding-index/vector-db.ts'
import type { ZoteroSemanticSearchHit } from '@asci/shared'

/** 内置默认 query 集：覆盖精确术语 / 自然语言英文 / 跨语言中文，专踩 ripgrep 已知挂零场景 */
const DEFAULT_QUERIES: QuerySpec[] = [
  { query: 'GQA', category: '精确术语' },
  { query: 'KV cache', category: '精确术语' },
  { query: 'reducing memory cost while maintaining accuracy', category: '自然语言英文' },
  { query: '小模型 少样本学习', category: '跨语言中文' },
  { query: '注意力 显存 优化', category: '跨语言中文' },
]

/** 五路标签（固定顺序，报告与文件按此对齐） */
const PATH_LABELS = ['ripgrep.md', 'ripgrep.txt', 'FTS5', 'vector', 'hybrid'] as const
type PathLabel = (typeof PATH_LABELS)[number]

interface QuerySpec {
  query: string
  category: string
}

interface CliArgs {
  queries: QuerySpec[]
  top: number
  outDir: string | null
  /** --jsonl <baseDir>：脚本在其下 mint <runId>/run.jsonl（机器可读，供未来 judge 消费） */
  jsonlBaseDir: string | null
  /** --file 路径（写进 JSONL meta，便于追溯用了哪个 query 集；inline query 为 null） */
  queryFile: string | null
  audit: boolean
}

/** 归一化后的单条命中（rg 路无 anchor/score/textKind） */
interface Hit {
  paperId: string
  textKind: string | null
  anchor: string | null
  score: number | null
  snippet: string
}

/** JSONL 契约 schema 版本：未来 judge 读时断言一致，破坏性改字段时 +1 */
const JSONL_SCHEMA_VERSION = 1

interface QueryResult {
  query: string
  category: string
  byPath: Record<PathLabel, Hit[]>
}

function parseArgs(argv: string[]): CliArgs {
  let top = 5
  let outDir: string | null = null
  let jsonlBaseDir: string | null = null
  let queryFile: string | null = null
  let audit = false
  const queries: QuerySpec[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--audit') {
      audit = true
    } else if (a === '--top') {
      top = Number(argv[++i] ?? '5') || 5
    } else if (a === '--out') {
      const d = argv[++i]
      if (d) outDir = isAbsolute(d) ? d : resolve(process.cwd(), d)
    } else if (a === '--jsonl') {
      const d = argv[++i]
      if (d) jsonlBaseDir = isAbsolute(d) ? d : resolve(process.cwd(), d)
    } else if (a === '--file') {
      const file = argv[++i]
      if (file && existsSync(file)) {
        queryFile = file
        for (const line of readFileSync(file, 'utf-8').split('\n')) {
          const raw = line.trim()
          if (!raw || raw.startsWith('#')) continue
          const sep = raw.indexOf(' | ')
          if (sep >= 0) {
            queries.push({ query: raw.slice(0, sep).trim(), category: raw.slice(sep + 3).trim() })
          } else {
            queries.push({ query: raw, category: '未分类' })
          }
        }
      } else {
        console.error(`⚠ --file 指定的文件不存在：${file}`)
      }
    } else if (a) {
      queries.push({ query: a, category: '未分类' })
    }
  }
  return {
    queries: queries.length > 0 ? queries : DEFAULT_QUERIES,
    top,
    outDir,
    jsonlBaseDir,
    queryFile,
    audit,
  }
}

/**
 * 只读审计当前索引库：统计有多少 chunk 会被新版 isLowQualityText 判为垃圾。
 * 用于在「重建索引」前估算清理收益（重建后这些 chunk 不再入库）。
 * 直接开第二个只读 better-sqlite3 连接（WAL 允许并发读，应用开着也安全）。
 */
function auditIndex(indexPath: string): void {
  const req = createRequire(__filename)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = req('better-sqlite3') as new (p: string, o?: { readonly?: boolean }) => {
    prepare: (sql: string) => { all: () => Array<{ text_kind: string; content: string }> }
    close: () => void
  }
  const db = new Database(indexPath, { readonly: true })
  const rows = db.prepare('SELECT text_kind, content FROM chunks').all()
  db.close()

  // 生产里只有 raw / article 层经 chunkWikiMarkdown → isLowQualityText 过滤；
  // title_abstract 走 buildTitleAbstractChunk，不过滤（标题+摘要本就是粗召回，故豁免）
  const FILTERED_KINDS = new Set(['raw', 'article'])
  const byKind = new Map<string, { total: number; bad: number }>()
  const examples: string[] = []
  for (const r of rows) {
    const k = byKind.get(r.text_kind) ?? { total: 0, bad: 0 }
    k.total++
    if (isLowQualityText(r.content)) {
      k.bad++
      if (FILTERED_KINDS.has(r.text_kind) && examples.length < 12) {
        examples.push(`[${r.text_kind}] ${clip(r.content, 100)}`)
      }
    }
    byKind.set(r.text_kind, k)
  }
  const total = rows.length
  const removable = [...byKind.entries()]
    .filter(([k]) => FILTERED_KINDS.has(k))
    .reduce((a, [, v]) => a + v.bad, 0)
  const filteredTotal = [...byKind.entries()]
    .filter(([k]) => FILTERED_KINDS.has(k))
    .reduce((a, [, v]) => a + v.total, 0)

  console.log(`\n${'═'.repeat(72)}\n索引垃圾审计（只读，按当前 isLowQualityText 判定）\n${'═'.repeat(72)}`)
  console.log(`总 chunk：${total}`)
  console.log(
    `生产过滤层(raw/article)：${removable}/${filteredTotal} 垃圾 (${((removable / filteredTotal) * 100).toFixed(1)}%) → 重建后移除 ${removable}、保留 ${total - removable}`,
  )
  console.log('\n分层：')
  for (const [k, v] of byKind) {
    const exempt = FILTERED_KINDS.has(k) ? '' : '  (生产豁免，不移除)'
    console.log(`  ${k.padEnd(15)} ${v.bad}/${v.total}  (${((v.bad / v.total) * 100).toFixed(1)}%)${exempt}`)
  }
  console.log('\n样例（raw/article 层，将被剔除）：')
  for (const e of examples) console.log(`  · ${e}`)
  console.log(`\n说明：chunker 改动不改 content_hash，需在设置页「重建索引」后这些 chunk 才真正移除。`)
}

/** ripgrep 二进制定位：ASCI_RG_BIN > @vscode/ripgrep 包内置 > PATH 上的 'rg' */
function resolveRgBin(): string {
  if (process.env.ASCI_RG_BIN) return process.env.ASCI_RG_BIN
  try {
    const req = createRequire(__filename)
    const indexJs = req.resolve('@vscode/ripgrep')
    const binName = process.platform === 'win32' ? 'rg.exe' : 'rg'
    const binPath = join(dirname(dirname(indexJs)), 'bin', binName)
    if (existsSync(binPath)) return binPath
  } catch {
    /* 落到 PATH */
  }
  return 'rg'
}

/**
 * 用 ripgrep 搜 wikiDir 下指定 glob 的文件，返回 fixed-strings + ignore-case 命中。
 * 复刻 papers_search_keywords 的 rg 参数口径（--fixed-strings --ignore-case -g <glob>）。
 */
function rgSearch(rgBin: string, wikiDir: string, glob: string, query: string, max: number): Hit[] {
  const res = spawnSync(
    rgBin,
    [
      '--json',
      '--no-heading',
      '--no-messages',
      '--max-columns',
      '512',
      '--fixed-strings',
      '--ignore-case',
      '-g',
      glob,
      '--',
      query,
      wikiDir,
    ],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
  )
  const hits: Hit[] = []
  for (const line of (res.stdout ?? '').split('\n')) {
    if (!line.trim()) continue
    let parsed: { type?: string; data?: { path?: { text?: string }; lines?: { text?: string } } }
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (parsed.type !== 'match') continue
    const path = parsed.data?.path?.text ?? ''
    if (!path) continue
    const paperId = basename(path).replace(/\.(article\.md|md|txt)$/, '')
    const snippet = (parsed.data?.lines?.text ?? '').replace(/\s+/g, ' ').trim()
    hits.push({ paperId, textKind: null, anchor: null, score: null, snippet })
    if (hits.length >= max) break
  }
  return hits
}

/** vdb 命中归一化为 Hit */
function toHits(raw: ZoteroSemanticSearchHit[]): Hit[] {
  return raw.map((h) => ({
    paperId: h.paperId,
    textKind: h.textKind,
    anchor: h.anchorStart ?? null,
    score: h.score,
    snippet: h.snippet,
  }))
}

/** 单行截断（多语言安全，按 code point 截） */
function clip(s: string, n: number): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  const arr = [...flat]
  return arr.length > n ? `${arr.slice(0, n).join('')}…` : flat
}

function printPath(label: string, hits: Hit[], top: number): void {
  console.log(`[${label.padEnd(11)}] ${hits.length} hits`)
  for (const h of hits.slice(0, top)) {
    const anchor = (h.anchor ?? '-').padEnd(8)
    const score = h.score === null ? '   -  ' : h.score.toFixed(4)
    console.log(`   · ${h.paperId.padEnd(10)} ${anchor} ${score} | ${clip(h.snippet, 84)}`)
  }
}

/** 文件安全 slug（用于 per-query 文件名） */
function slug(s: string): string {
  return [...s.replace(/[\s/\\:*?"<>|]+/g, '-')].slice(0, 40).join('').replace(/^-+|-+$/g, '')
}

/** markdown 表格转义 */
function md(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

/** 写单条 query 的五路结果文件（带「相关?」列供人工判断） */
function writeQueryFile(dir: string, idx: number, r: QueryResult): string {
  const lines: string[] = []
  lines.push(`# Q${String(idx).padStart(2, '0')}: ${r.query}`)
  lines.push('')
  lines.push(`- 分类：${r.category}`)
  lines.push(`- 命中数：${PATH_LABELS.map((p) => `${p} ${r.byPath[p].length}`).join(' · ')}`)
  lines.push('')
  lines.push('> 人工判断：在每条的「相关?」列填 Y/N（该条 snippet 是否真与查询相关）。')
  lines.push('')
  for (const p of PATH_LABELS) {
    const hits = r.byPath[p]
    lines.push(`## ${p} （${hits.length}）`)
    lines.push('')
    if (hits.length === 0) {
      lines.push('_（无命中）_')
      lines.push('')
      continue
    }
    lines.push('| # | 相关? | paperId | anchor | score | snippet |')
    lines.push('|---|-------|---------|--------|-------|---------|')
    hits.forEach((h, i) => {
      const score = h.score === null ? '-' : h.score.toFixed(4)
      lines.push(
        `| ${i + 1} |  | ${h.paperId} | ${h.anchor ?? '-'} | ${score} | ${md(clip(h.snippet, 160))} |`,
      )
    })
    lines.push('')
  }
  const file = join(dir, `q${String(idx).padStart(2, '0')}-${slug(r.query)}.md`)
  writeFileSync(file, lines.join('\n'), 'utf-8')
  return file
}

/** 写汇总：命中数矩阵 + 各路覆盖率 + 分类聚合 */
function writeSummary(dir: string, results: QueryResult[], meta: Record<string, string>): string {
  const lines: string[] = []
  lines.push('# RAG 五路检索对比 —— 汇总')
  lines.push('')
  for (const [k, v] of Object.entries(meta)) lines.push(`- ${k}：${v}`)
  lines.push('')
  lines.push('## 命中数矩阵')
  lines.push('')
  lines.push(`| # | 分类 | query | ${PATH_LABELS.join(' | ')} |`)
  lines.push(`|---|------|-------|${PATH_LABELS.map(() => '---').join('|')}|`)
  results.forEach((r, i) => {
    const cells = PATH_LABELS.map((p) => r.byPath[p].length).join(' | ')
    lines.push(`| ${i + 1} | ${r.category} | ${md(clip(r.query, 40))} | ${cells} |`)
  })
  lines.push('')

  // 各路覆盖率：有 ≥1 命中的 query 数 / 总数
  lines.push('## 各路覆盖率（有 ≥1 命中的 query 数 / 总数）')
  lines.push('')
  lines.push(`| 链路 | 覆盖 query 数 | 覆盖率 | 总命中数 |`)
  lines.push('|------|------|------|------|')
  for (const p of PATH_LABELS) {
    const covered = results.filter((r) => r.byPath[p].length > 0).length
    const totalHits = results.reduce((a, r) => a + r.byPath[p].length, 0)
    lines.push(`| ${p} | ${covered}/${results.length} | ${((covered / results.length) * 100).toFixed(0)}% | ${totalHits} |`)
  }
  lines.push('')

  // 分类 × 链路覆盖率
  const cats = [...new Set(results.map((r) => r.category))]
  lines.push('## 分类 × 链路覆盖率')
  lines.push('')
  lines.push(`| 分类 | query 数 | ${PATH_LABELS.join(' | ')} |`)
  lines.push(`|------|------|${PATH_LABELS.map(() => '---').join('|')}|`)
  for (const c of cats) {
    const sub = results.filter((r) => r.category === c)
    const cells = PATH_LABELS.map((p) => `${sub.filter((r) => r.byPath[p].length > 0).length}/${sub.length}`).join(' | ')
    lines.push(`| ${c} | ${sub.length} | ${cells} |`)
  }
  lines.push('')
  lines.push('> 覆盖率只看「有没有命中」，**不代表命中是否相关**——相关性请在各 q*.md 的「相关?」列人工判断后再统计精确度。')

  const file = join(dir, 'summary.md')
  writeFileSync(file, lines.join('\n'), 'utf-8')
  return file
}

/** JSONL meta 头（line 0），= run 指纹（索引/模型/参数），供 judge 判断两次 run 是否可比 */
interface RunMeta {
  type: 'meta'
  schemaVersion: number
  runId: string
  timestamp: string
  indexPath: string
  chunkCount: number
  modelId: string
  embedDim: number
  vecAvailable: boolean
  embedderReady: boolean
  top: number
  paths: readonly string[]
  queryCount: number
  queryFile: string | null
}

/**
 * 写版本化 JSONL：line0 = RunMeta，其后每行一个 query（含每路 ranked hits）。
 * 这是「召回层」机器可读契约——未来全 TS judge 直接消费它打分（重打分不重检索）。
 * 在 baseDir 下按 runId mint 子目录（package.json 脚本里无法展开时间戳，故由脚本自己生成）。
 */
function writeJsonl(baseDir: string, runId: string, results: QueryResult[], meta: RunMeta): string {
  const dir = join(baseDir, runId)
  mkdirSync(dir, { recursive: true })
  const lines: string[] = [JSON.stringify(meta)]
  results.forEach((r, i) => {
    const byPath: Record<string, { hitCount: number; hits: unknown[] }> = {}
    for (const p of PATH_LABELS) {
      const hits = r.byPath[p]
      byPath[p] = {
        hitCount: hits.length,
        hits: hits.map((h, rank) => ({
          rank: rank + 1,
          paperId: h.paperId,
          textKind: h.textKind,
          anchorStart: h.anchor,
          score: h.score,
          snippet: h.snippet,
        })),
      }
    }
    lines.push(
      JSON.stringify({ type: 'query', index: i + 1, query: r.query, category: r.category, byPath }),
    )
  })
  const file = join(dir, 'run.jsonl')
  writeFileSync(file, lines.join('\n') + '\n', 'utf-8')
  return file
}

async function main(): Promise<void> {
  const { queries, top, outDir, jsonlBaseDir, queryFile, audit } = parseArgs(process.argv.slice(2))
  const wikiDir = getZoteroWikiDir()
  const indexPath = getZoteroVectorIndexPath()

  if (audit) {
    if (!existsSync(indexPath)) {
      console.error(`✗ 索引库不存在：${indexPath}`)
      process.exit(1)
    }
    auditIndex(indexPath)
    return
  }
  const modelDir = join(getEmbeddingModelsDir(), EMBEDDING_MODEL.modelId)
  const rgBin = resolveRgBin()

  console.log('═'.repeat(72))
  console.log('RAG 五路检索对比评估')
  console.log(`  wiki   : ${wikiDir}`)
  console.log(`  index  : ${indexPath}`)
  console.log(`  model  : ${modelDir}`)
  console.log(`  rg     : ${rgBin}`)
  console.log(`  top    : ${top}  ·  queries: ${queries.length}  ·  out: ${outDir ?? '(无)'}  ·  jsonl: ${jsonlBaseDir ?? '(无)'}`)
  console.log('═'.repeat(72))

  if (!existsSync(indexPath)) {
    console.error(`✗ 索引库不存在：${indexPath}\n  请先在设置页开启语义检索并等索引构建完成（或确认 ASCI_DEV 是否一致）。`)
    process.exit(1)
  }

  const vdb = ZoteroVectorDb.open(indexPath, {
    modelId: EMBEDDING_MODEL.modelId,
    embedDim: EMBEDDING_MODEL.embedDim,
  })
  console.log(`库内 chunk 总数：${vdb.countChunks()}  ·  vec0 ${vdb.vecAvailable ? '可用' : '不可用（退化纯 FTS）'}`)

  let embedder: E5Embedder | null = null
  try {
    embedder = await E5Embedder.load(modelDir)
  } catch (err) {
    console.warn(`⚠ 模型加载失败，向量/混合两路将退化为纯 FTS：${err instanceof Error ? err.message : String(err)}`)
  }

  const results: QueryResult[] = []

  for (const { query, category } of queries) {
    console.log(`\n${'━'.repeat(72)}\nQUERY: "${query}"  [${category}]\n${'━'.repeat(72)}`)

    const rgMd = rgSearch(rgBin, wikiDir, '*.md', query, top)
    const rgTxt = rgSearch(rgBin, wikiDir, '*.txt', query, top)
    const fts = toHits(vdb.search({ queryText: query, maxResults: top }))

    let qvec: Float32Array | undefined
    if (embedder) {
      const [vec] = await embedder.embed([query], 'query')
      qvec = vec
    }
    const vector = qvec ? toHits(vdb.search({ queryEmbedding: qvec, maxResults: top })) : []
    const hybrid = qvec
      ? toHits(vdb.search({ queryEmbedding: qvec, queryText: query, maxResults: top }))
      : []

    printPath('ripgrep.md', rgMd, top)
    printPath('ripgrep.txt', rgTxt, top)
    printPath('FTS5', fts, top)
    printPath('vector', vector, top)
    printPath('hybrid', hybrid, top)

    results.push({
      query,
      category,
      byPath: { 'ripgrep.md': rgMd, 'ripgrep.txt': rgTxt, FTS5: fts, vector, hybrid },
    })
  }

  const chunkCount = vdb.countChunks()
  const vecAvailable = vdb.vecAvailable
  vdb.close()

  const nowIso = new Date().toISOString()
  // runId 用作目录名：把 ISO 里的 ':' '.' 换成 '-'（文件系统安全）
  const runId = nowIso.replace(/:/g, '-').replace(/\.\d+/, '')

  if (outDir) {
    mkdirSync(outDir, { recursive: true })
    results.forEach((r, i) => writeQueryFile(outDir, i + 1, r))
    const summaryFile = writeSummary(outDir, results, {
      时间: nowIso,
      索引库: indexPath,
      chunk数: String(chunkCount),
      模型: EMBEDDING_MODEL.modelId,
      top: String(top),
      query数: String(results.length),
    })
    console.log(`\n✓ markdown：${results.length} 个 query 文件 + ${basename(summaryFile)} → ${outDir}`)
  }

  if (jsonlBaseDir) {
    const meta: RunMeta = {
      type: 'meta',
      schemaVersion: JSONL_SCHEMA_VERSION,
      runId,
      timestamp: nowIso,
      indexPath,
      chunkCount,
      modelId: EMBEDDING_MODEL.modelId,
      embedDim: EMBEDDING_MODEL.embedDim,
      vecAvailable,
      embedderReady: embedder !== null,
      top,
      paths: PATH_LABELS,
      queryCount: results.length,
      queryFile,
    }
    const jsonlFile = writeJsonl(jsonlBaseDir, runId, results, meta)
    // 同目录附一份 summary.md 供人快速扫一眼（机器看 run.jsonl，人看 summary.md）
    writeSummary(dirname(jsonlFile), results, {
      时间: nowIso,
      runId,
      索引库: indexPath,
      chunk数: String(chunkCount),
      模型: EMBEDDING_MODEL.modelId,
      top: String(top),
      query数: String(results.length),
    })
    console.log(`✓ jsonl（schemaVersion ${JSONL_SCHEMA_VERSION}）+ summary.md → ${dirname(jsonlFile)}`)
  }

  console.log(`\n${'═'.repeat(72)}\n完成。`)
}

void main().catch((err) => {
  console.error('评估脚本异常：', err)
  process.exit(1)
})
