/**
 * 单篇 PDF 向量化质量评测（dev-only 工具，committed 但**不进打包**——scripts/ 不在 electron-builder files 白名单）
 *
 * 与 rag-eval 的分工（见 docs/specs/vector-eval-spec.md §1.4）：
 *   - rag-eval        ：整个真实库 + 手写固定 query → 覆盖率矩阵
 *   - 本工具          ：**单篇 PDF** → 隔离临时索引 → 从该 PDF 自身 chunk 合成 QA → Recall/MRR
 *
 * 两种解析模式（对应生产 raw 层的两条来源，见 §4.2）：
 *   - structured ：pdfjs 排版感知 → `<p id>` 段落锚点（= 生产**主路**，库内每篇都有 .txt 时走这条）
 *   - lite       ：pdf-parse 纯文本 → 字节偏移锚点（生产**回退路**）
 *   两条切出的 chunk 边界不同，故评测用「答案文本子串匹配」做 ground truth（跨模式公平复用同一份 qa.jsonl）。
 *
 * 三阶段（LLM 推理走 Claude-Code-in-loop，对齐 RAG-EVAL.md §4，不引新依赖）：
 *   阶段1 index  ：PDF →（structured|lite 解析）→ chunk → embed → 隔离 eval.db；导出 chunks.jsonl + L1 体检
 *     ↓ Claude Code 读 chunks.jsonl，合成 qa.jsonl（语义 + 关键词 + 干扰，各带 answerText 答案片段）
 *   阶段2 replay ：qa.jsonl 回灌三路检索（向量/FTS/RRF）→ Hit@k/MRR/误召回 → run.jsonl + report.md
 *     ↓ Claude Code 读 run.jsonl，按 rubric 判 L3 相关性 → 汇总进 report.md
 *   compare      ：读两模式 run.jsonl → 并排 L2 指标 → comparison.md（structured vs lite）
 *
 * 为什么不是 bun：onnxruntime-node / better-sqlite3 / sqlite-vec / pdfjs 在主进程 ABI 下跑，
 * 经 esbuild bundle → `ELECTRON_RUN_AS_NODE=1 electron` 执行（见 package.json eval:vec*）。
 *
 * 跑法：
 *   bun run eval:vec:index  -- <pdf-path> [--mode structured|lite]   # 阶段1（默认 structured）
 *   bun run eval:vec:replay -- <paper-dir> --mode structured|lite    # 阶段2
 *   bun run eval:vec:compare -- <paper-dir>                          # structured vs lite 并排
 *
 * 隔离：工作区落 docs/superpowers/vec-eval-runs/<slug>/<mode>/（gitignored），qa.jsonl 在 <slug>/ 共享。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'

import { nowIso } from '@asci/shared'
import type { ZoteroPdfRecord, ZoteroSemanticSearchHit } from '@asci/shared'

import { getEmbeddingModelsDir } from '../src/main/lib/config-paths.ts'
import { extractTextFromFile } from '../src/main/lib/document-extractor.ts'
import { chunkWikiMarkdown } from '../src/main/lib/zotero-embedding-index/chunker.ts'
import { E5Embedder, EMBEDDING_MODEL } from '../src/main/lib/zotero-embedding-index/embedder.ts'
import { ZoteroVectorDb } from '../src/main/lib/zotero-embedding-index/vector-db.ts'
import { contentHash } from '../src/main/lib/zotero-embedding-index/worker.ts'
import { makeDefaultParseState } from '../src/main/lib/zotero-pdf-parser/snapshot-store.ts'
import { wrapAsMarkdown } from '../src/main/lib/zotero-pdf-parser/strategies/wrap.ts'
import { buildTokens } from '../src/main/lib/zotero-pdf-parser/strategies/structured/classifier.ts'
import { extract } from '../src/main/lib/zotero-pdf-parser/strategies/structured/extractor.ts'
import { format } from '../src/main/lib/zotero-pdf-parser/strategies/structured/formatter.ts'
import { wrapAsStructuredTxt } from '../src/main/lib/zotero-structured-txt/wrap.ts'

/** 评测里所有 chunk 都挂这个固定 attachmentKey（隔离库只有一篇） */
const EVAL_KEY = 'EVAL'
/** 嵌入单批条数（与生产 worker 一致，CPU 推理控延迟） */
const BATCH_SIZE = 8
/** 检索深度：取 top-N 命中（足够算 Hit@1/3/5 + MRR@10） */
const TOP = 10
/** 工作区根：仓库根的 docs/superpowers/（gitignored）。脚本经 electron 从 apps/electron 启动，`../../` 上溯仓库根。 */
const RUNS_ROOT = '../../docs/superpowers/vec-eval-runs'
const PATHS = ['vector', 'fts', 'hybrid'] as const
type PathName = (typeof PATHS)[number]
/** 实际落地的解析模式（= 输出子目录名） */
const MODES = ['structured', 'lite'] as const
type ParseMode = (typeof MODES)[number]
/** 请求模式：auto = 生产口径（先 structured，异常降级 lite）；structured/lite = 强制单路（对比用） */
type RequestMode = ParseMode | 'auto'

/** chunks.jsonl 单行 */
interface ChunkRecord {
  id: number
  textKind: string
  anchorStart: string | null
  anchorEnd: string | null
  length: number
  content: string
}

/**
 * qa.jsonl 单行（由 Claude Code 合成）。
 * ground truth = answerText（一段在「正确 chunk」里出现的可辨识答案文本），
 * 用归一化子串匹配判命中 —— 跨 structured/lite 两套不同切分都能公平复用同一份 QA。
 * distractor 的 answerText = null（答案不在 PDF 内）。
 */
interface QaItem {
  id: number
  type: 'semantic' | 'keyword' | 'distractor'
  query: string
  answerText: string | null
}

interface PathHit {
  rank: number
  chunkId: number | null
  score: number
  rawCosine: number | null
  rawBm25: number | null
  snippet: string
}

interface QaResult {
  qa: QaItem
  byPath: Record<PathName, PathHit[]>
  /** 含 answerText 的命中名次（1 起；无 answerText 或未命中 null） */
  gtRank: Record<PathName, number | null>
}

/** 归一化：小写 + 去所有空白/连字符（含 unicode 减号），消化 pdf-parse vs pdfjs 的排版差异 */
function norm(s: string): string {
  return s.toLowerCase().replace(/[\s\-−]+/g, '')
}

/** 文件安全 slug（多语言按 code point 截） */
function slug(s: string): string {
  return (
    [...s.replace(/[\s/\\:*?"<>|]+/g, '-')].slice(0, 60).join('').replace(/^-+|-+$/g, '') || 'pdf'
  )
}

/** 读 jsonl（跳空行） */
function readJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as T)
}

/** 构造最小 ZoteroPdfRecord（仅供 wrap 包 header；标题取文件名，无 Zotero 元数据） */
function buildEvalRecord(pdfPath: string): ZoteroPdfRecord {
  const filename = basename(pdfPath)
  return {
    attachmentKey: EVAL_KEY,
    parentItemKey: null,
    version: 0,
    linkMode: 'imported_file',
    contentType: 'application/pdf',
    filename,
    title: filename.replace(/\.pdf$/i, ''),
    dateModified: null,
    parse: makeDefaultParseState(),
    parent: null,
    article: null,
  }
}

/** 解析模型目录并校验必需文件就绪 */
function resolveModelDir(): string {
  const dir = join(getEmbeddingModelsDir(), EMBEDDING_MODEL.modelId)
  const missing = EMBEDDING_MODEL.requiredFiles.filter((f) => !existsSync(join(dir, f)))
  if (missing.length > 0) {
    console.error(
      `✗ 嵌入模型未就绪：${dir}\n  缺文件：${missing.join(', ')}\n` +
        `  请先在 app 设置页开启语义检索、等模型下载完成（注意 ASCI_DEV 是否一致）。`,
    )
    process.exit(1)
  }
  return dir
}

/** 数值分布（升序数组取分位） */
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

/**
 * 按请求模式产出 wiki 文本，返回实际落地模式（与生产逐字节一致）。
 * auto：先试 structured（pdfjs+`<p id>`），任何异常降级 lite（pdf-parse 纯文本）——复刻生产 raw 层来源选择。
 * structured：强制 structured，失败即抛（对比/诊断用）。lite：强制 lite。
 */
async function parseToWiki(
  pdfPath: string,
  req: RequestMode,
): Promise<{ mode: ParseMode; md: string }> {
  const rec = buildEvalRecord(pdfPath)
  if (req !== 'lite') {
    try {
      // structured：复用生产 structured-txt 管线（extract → buildTokens → format → wrap）
      const { pages } = await extract(pdfPath)
      const { tokens } = buildTokens(pages)
      const { outline, body } = format(tokens)
      return { mode: 'structured', md: wrapAsStructuredTxt({ rec, pdfPath, outline, body }) }
    } catch (err) {
      if (req === 'structured') throw err // 强制模式不降级
      console.warn(
        `⚠ structured 解析失败，降级 lite：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  const body = await extractTextFromFile(pdfPath)
  return { mode: 'lite', md: wrapAsMarkdown({ rec, pdfPath, body, actualStrategy: 'lite' }) }
}

/** 阶段1：PDF →（请求模式解析，auto 默认先 structured 异常降级 lite）→ 隔离索引 + chunks.jsonl + L1 体检 */
async function runIndex(pdfArg: string, req: RequestMode): Promise<void> {
  const pdfPath = isAbsolute(pdfArg) ? pdfArg : resolve(process.cwd(), pdfArg)
  if (!existsSync(pdfPath)) {
    console.error(`✗ PDF 不存在：${pdfPath}`)
    process.exit(1)
  }

  const paperDir = resolve(process.cwd(), RUNS_ROOT, slug(basename(pdfPath, extname(pdfPath))))
  const modelDir = resolveModelDir()

  console.log('═'.repeat(72))
  console.log(`单篇 PDF 向量化评测 · 阶段1 index · 请求模式=${req}`)
  console.log(`  pdf       : ${pdfPath}`)
  console.log('═'.repeat(72))

  // 1. 解析（auto 先 structured 异常降级 lite）→ 知道实际模式后再定工作区目录
  const { mode, md } = await parseToWiki(pdfPath, req)
  const wsDir = join(paperDir, mode)
  mkdirSync(wsDir, { recursive: true })
  const evalDbPath = join(wsDir, 'eval.db')
  // 切分（chunkWikiMarkdown 据是否含 <p id> 自动选段落/字节模式）
  const chunks = chunkWikiMarkdown(md)
  const anchorKind = md.includes('<p id="') ? '段落 <p id>' : '字节偏移'
  console.log(`  实际模式  : ${mode}${req === 'auto' && mode === 'lite' ? '（structured 失败，已降级）' : ''}  → ${wsDir}`)
  console.log(`✓ 解析 ${[...md].length} 字符（${anchorKind} 锚点）→ 切分 ${chunks.length} 个 raw chunk`)
  if (chunks.length === 0) {
    console.error('✗ 切分结果为空（PDF 可能是扫描件/无文本层），无法评测。')
    process.exit(1)
  }

  // 2. 删旧库重建 + 载模型
  for (const suffix of ['', '-wal', '-shm']) {
    const f = `${evalDbPath}${suffix}`
    if (existsSync(f)) rmSync(f, { force: true })
  }
  const vdb = ZoteroVectorDb.open(evalDbPath, {
    modelId: EMBEDDING_MODEL.modelId,
    embedDim: EMBEDDING_MODEL.embedDim,
  })
  if (!vdb.vecAvailable) console.warn('⚠ vec0 扩展不可用，向量层将缺失（仅能测 FTS）。')
  const embedder = await E5Embedder.load(modelDir)

  // 3. 分批嵌入 → 三表入库
  const embeddings: Float32Array[] = []
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE)
    embeddings.push(...(await embedder.embed(batch.map((c) => c.content), 'passage')))
    process.stdout.write(`\r  嵌入进度 ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length}`)
  }
  process.stdout.write('\n')
  vdb.replaceChunks(EVAL_KEY, 'raw', contentHash(md), chunks, embeddings)

  // 4. 回读真实 rowid 导出 chunks.jsonl
  const dbChunks = readBackChunks(evalDbPath)
  writeFileSync(
    join(wsDir, 'chunks.jsonl'),
    dbChunks.map((c) => JSON.stringify(c satisfies ChunkRecord)).join('\n') + '\n',
    'utf-8',
  )
  console.log(`✓ 导出 chunks.jsonl（${dbChunks.length} 条）`)

  // 5. L1 体检
  const l1 = computeL1(md, dbChunks)
  writeFileSync(join(wsDir, 'report.md'), renderL1Report(pdfPath, mode, dbChunks.length, l1), 'utf-8')
  vdb.close()
  console.log(`✓ L1 体检写入 report.md`)
  console.log('─'.repeat(72))
  console.log(`下一步：把 ${join(paperDir, 'qa.jsonl')} 备好（Claude Code 读 chunks.jsonl 合成，带 answerText），`)
  console.log(`       两模式都 index 完后：bun run eval:vec:replay -- ${paperDir} --mode ${mode}`)
}

/** 回读库内 chunk（含真实自增 rowid） */
function readBackChunks(evalDbPath: string): ChunkRecord[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as new (
    p: string,
    o?: { readonly?: boolean },
  ) => {
    prepare: (sql: string) => {
      all: () => Array<{
        id: number
        text_kind: string
        anchor_start: string | null
        anchor_end: string | null
        content: string
      }>
    }
    close: () => void
  }
  const db = new Database(evalDbPath, { readonly: true })
  const rows = db
    .prepare('SELECT id, text_kind, anchor_start, anchor_end, content FROM chunks ORDER BY id')
    .all()
  db.close()
  return rows.map((r) => ({
    id: r.id,
    textKind: r.text_kind,
    anchorStart: r.anchor_start,
    anchorEnd: r.anchor_end,
    length: [...r.content].length,
    content: r.content,
  }))
}

interface L1Stats {
  bodyLen: number
  chunkCharSum: number
  coverage: number
  noiseCount: number
  noiseExamples: string[]
  lenMin: number
  lenP50: number
  lenP95: number
  lenMax: number
}

/** 可嵌正文长度：含 `<p id>` 则取段落文本总长，否则取去头 body 长 */
function embeddableBodyLen(md: string): number {
  if (md.includes('<p id="')) {
    let total = 0
    for (const m of md.matchAll(/<p id="[^"]*">([\s\S]*?)<\/p>/g)) total += [...(m[1] ?? '')].length
    return total
  }
  const sepIdx = md.indexOf('\n---\n')
  return sepIdx >= 0 ? [...md.slice(sepIdx + 5)].length : [...md].length
}

/** L1：覆盖率（chunk 字符和 / 可嵌正文）+ 噪声 + 长度分布 */
function computeL1(md: string, chunks: ChunkRecord[]): L1Stats {
  const lens = chunks.map((c) => c.length).sort((a, b) => a - b)
  const chunkCharSum = lens.reduce((a, b) => a + b, 0)
  const bodyLen = embeddableBodyLen(md)
  const noise = chunks.filter((c) => c.content.trim().length < 10)
  return {
    bodyLen,
    chunkCharSum,
    coverage: bodyLen > 0 ? chunkCharSum / bodyLen : 0,
    noiseCount: noise.length,
    noiseExamples: noise.slice(0, 8).map((c) => `id ${c.id}: ${JSON.stringify(c.content)}`),
    lenMin: lens[0] ?? 0,
    lenP50: pct(lens, 50),
    lenP95: pct(lens, 95),
    lenMax: lens[lens.length - 1] ?? 0,
  }
}

function renderL1Report(pdfPath: string, mode: ParseMode, chunkCount: number, l1: L1Stats): string {
  return [
    `# PDF 向量化评测报告（模式：${mode}）`,
    '',
    `- PDF：\`${pdfPath}\``,
    `- 解析模式：**${mode}**（${mode === 'structured' ? 'pdfjs + <p id> 段落锚点 = 生产主路' : 'pdf-parse 纯文本 + 字节偏移 = 生产回退路'}）`,
    `- 生成时间：${nowIso()}`,
    `- raw chunk 数：${chunkCount}`,
    `- 模型：${EMBEDDING_MODEL.modelId}（${EMBEDDING_MODEL.embedDim} 维）`,
    '',
    `## L1 切分质量`,
    '',
    `| 指标 | 值 |`,
    `|------|----|`,
    `| 可嵌正文字符数 | ${l1.bodyLen} |`,
    `| chunk 字符总和 | ${l1.chunkCharSum} |`,
    `| 覆盖率（chunk和/正文） | ${(l1.coverage * 100).toFixed(1)}% |`,
    `| 噪声 chunk（trim<10） | ${l1.noiseCount} |`,
    `| 长度 min/p50/p95/max | ${l1.lenMin} / ${l1.lenP50} / ${l1.lenP95} / ${l1.lenMax} |`,
    '',
    ...(l1.noiseExamples.length > 0
      ? ['### 噪声 chunk 样例', '', ...l1.noiseExamples.map((e) => `- ${e}`), '']
      : []),
    `## L2 检索质量`,
    '',
    `_待阶段2 replay 填充（需先合成 qa.jsonl）。_`,
    '',
    `## L3 语义质量`,
    '',
    `_待 Claude Code 按 RAG-EVAL.md rubric 判 run.jsonl 后填充。_`,
    '',
  ].join('\n')
}

/** ZoteroSemanticSearchHit → PathHit（按 anchor 反查 chunkId，仅供参考/调试） */
function toPathHits(hits: ZoteroSemanticSearchHit[], anchorToId: Map<string, number>): PathHit[] {
  return hits.map((h, i) => ({
    rank: i + 1,
    chunkId: anchorToId.get(`${h.anchorStart} ${h.anchorEnd}`) ?? null,
    score: h.score,
    rawCosine: h.rawCosine,
    rawBm25: h.rawBm25,
    snippet: h.snippet,
  }))
}

/** 含 answerText 的首个命中名次（归一化子串匹配；无 answerText 或未命中返回 null） */
function rankOf(hits: PathHit[], answerText: string | null): number | null {
  if (!answerText) return null
  const target = norm(answerText)
  const idx = hits.findIndex((h) => norm(h.snippet).includes(target))
  return idx >= 0 ? idx + 1 : null
}

/** 聚合一组 result 的 Hit@k / MRR（仅对有 answerText 的条目） */
function aggregate(results: QaResult[], path: PathName) {
  const withGt = results.filter((r) => r.qa.answerText !== null)
  const n = withGt.length || 1
  const hitAt = (k: number) =>
    withGt.filter((r) => {
      const rk = r.gtRank[path]
      return rk !== null && rk <= k
    }).length / n
  const mrr =
    withGt.reduce((a, r) => a + (r.gtRank[path] !== null ? 1 / (r.gtRank[path] as number) : 0), 0) / n
  return { hit1: hitAt(1), hit3: hitAt(3), hit5: hitAt(5), mrr }
}

/** 阶段2：qa.jsonl 回灌三路检索 → Hit@k/MRR → run.jsonl + report.md L2 段 */
async function runReplay(paperArg: string, mode: ParseMode): Promise<void> {
  const paperDir = isAbsolute(paperArg) ? paperArg : resolve(process.cwd(), paperArg)
  const wsDir = join(paperDir, mode)
  const qaPath = join(paperDir, 'qa.jsonl')
  const chunksPath = join(wsDir, 'chunks.jsonl')
  const evalDbPath = join(wsDir, 'eval.db')
  for (const [label, p] of [
    ['qa.jsonl（应在 <paper-dir>/，两模式共享）', qaPath],
    ['chunks.jsonl', chunksPath],
    ['eval.db', evalDbPath],
  ] as const) {
    if (!existsSync(p)) {
      console.error(`✗ 未找到 ${label}：${p}\n  qa.jsonl 需 Claude Code 读 chunks.jsonl 合成（带 answerText）；其余应由阶段1 index --mode ${mode} 产出。`)
      process.exit(1)
    }
  }

  const qaItems = readJsonl<QaItem>(qaPath)
  const chunks = readJsonl<ChunkRecord>(chunksPath)
  const anchorToId = new Map<string, number>()
  for (const c of chunks) anchorToId.set(`${c.anchorStart} ${c.anchorEnd}`, c.id)

  const modelDir = resolveModelDir()
  const vdb = ZoteroVectorDb.open(evalDbPath, {
    modelId: EMBEDDING_MODEL.modelId,
    embedDim: EMBEDDING_MODEL.embedDim,
  })
  const embedder = await E5Embedder.load(modelDir)

  console.log('═'.repeat(72))
  console.log(`单篇 PDF 向量化评测 · 阶段2 replay · 模式=${mode}`)
  console.log(`  qa ${qaItems.length} 条 · chunks ${chunks.length} · top ${TOP} · vec0 ${vdb.vecAvailable ? '可用' : '不可用'}`)
  console.log('═'.repeat(72))

  const results: QaResult[] = []
  for (const qa of qaItems) {
    const [qvec] = await embedder.embed([qa.query], 'query')
    // 三路：纯向量 / 纯 FTS / 混合。maxPerPaper=TOP 解除默认每篇 3 条上限（单篇评测全在一篇内）。
    const byPath = {
      vector: toPathHits(vdb.search({ queryEmbedding: qvec, maxResults: TOP, maxPerPaper: TOP }), anchorToId),
      fts: toPathHits(vdb.search({ queryText: qa.query, maxResults: TOP, maxPerPaper: TOP }), anchorToId),
      hybrid: toPathHits(vdb.search({ queryEmbedding: qvec, queryText: qa.query, maxResults: TOP, maxPerPaper: TOP }), anchorToId),
    }
    results.push({
      qa,
      byPath,
      gtRank: {
        vector: rankOf(byPath.vector, qa.answerText),
        fts: rankOf(byPath.fts, qa.answerText),
        hybrid: rankOf(byPath.hybrid, qa.answerText),
      },
    })
  }
  vdb.close()

  writeRunJsonl(wsDir, mode, results)
  patchReportL2(wsDir, results)
  console.log(`\n✓ 写入 run.jsonl + 更新 report.md L2 段`)
  console.log(`下一步：两模式都 replay 后 → bun run eval:vec:compare -- ${paperDir}；L3 由 Claude Code 判 run.jsonl`)
}

/** 写版本化 run.jsonl（line0 meta + 每 query 三路 ranked hits），供 L3 judge / compare 消费 */
function writeRunJsonl(wsDir: string, mode: ParseMode, results: QaResult[]): void {
  const lines: string[] = [
    JSON.stringify({
      type: 'meta',
      mode,
      timestamp: nowIso(),
      modelId: EMBEDDING_MODEL.modelId,
      embedDim: EMBEDDING_MODEL.embedDim,
      top: TOP,
      paths: PATHS,
      queryCount: results.length,
    }),
  ]
  for (const r of results) {
    lines.push(
      JSON.stringify({
        type: 'query',
        id: r.qa.id,
        queryType: r.qa.type,
        query: r.qa.query,
        answerText: r.qa.answerText,
        gtRank: r.gtRank,
        byPath: r.byPath,
      }),
    )
  }
  writeFileSync(join(wsDir, 'run.jsonl'), lines.join('\n') + '\n', 'utf-8')
}

/** 把 report.md 的 L2 占位段替换为真实指标（保留 L1 与 L3 段） */
function patchReportL2(wsDir: string, results: QaResult[]): void {
  const reportPath = join(wsDir, 'report.md')
  const md = existsSync(reportPath) ? readFileSync(reportPath, 'utf-8') : '# PDF 向量化评测报告\n'
  const l2Start = md.indexOf('## L2 检索质量')
  const l3Start = md.indexOf('## L3 语义质量')
  const head = l2Start >= 0 ? md.slice(0, l2Start) : md.trimEnd() + '\n\n'
  const tail = l3Start >= 0 ? md.slice(l3Start) : '## L3 语义质量\n\n_待 Claude Code 判定。_\n'

  const byType = (t: QaItem['type']) => results.filter((r) => r.qa.type === t)
  const semantic = byType('semantic')
  const keyword = byType('keyword')
  const distractors = byType('distractor')

  const lines: string[] = ['## L2 检索质量', '']
  lines.push(`共 ${results.length} 条 query：语义 ${semantic.length} · 关键词 ${keyword.length} · 干扰 ${distractors.length}`, '')
  for (const [label, group] of [
    ['语义问题', semantic],
    ['关键词查询', keyword],
  ] as const) {
    if (group.length === 0) continue
    lines.push(`### ${label}（${group.length} 条，answerText 子串判命中）`, '')
    lines.push(`| 链路 | Hit@1 | Hit@3 | Hit@5 | MRR |`, `|------|-------|-------|-------|-----|`)
    for (const p of PATHS) {
      const a = aggregate(group, p)
      lines.push(`| ${p} | ${a.hit1.toFixed(2)} | ${a.hit3.toFixed(2)} | ${a.hit5.toFixed(2)} | ${a.mrr.toFixed(2)} |`)
    }
    lines.push('')
  }
  if (distractors.length > 0) {
    lines.push(`### 干扰问题（${distractors.length} 条，无 answerText）`, '', `top 命中相关性交 L3 判断是否误召回（见 run.jsonl）。`, '')
  }
  lines.push(`> 期望：语义「向量 ≥ FTS」、关键词「FTS ≥ 向量」、hybrid 两边都不掉队。`, '')
  writeFileSync(reportPath, head + lines.join('\n') + '\n' + tail, 'utf-8')
}

/** run.jsonl 里的 query 行（compare 复用） */
interface RunQuery {
  type: string
  queryType: QaItem['type']
  answerText: string | null
  gtRank: Record<PathName, number | null>
}

/** 从 run.jsonl 算某类某路的 Hit@k/MRR */
function aggFromRun(rows: RunQuery[], type: QaItem['type'], path: PathName) {
  const g = rows.filter((r) => r.queryType === type && r.answerText !== null)
  const n = g.length || 1
  const hitAt = (k: number) => g.filter((r) => r.gtRank[path] !== null && (r.gtRank[path] as number) <= k).length / n
  const mrr = g.reduce((a, r) => a + (r.gtRank[path] !== null ? 1 / (r.gtRank[path] as number) : 0), 0) / n
  return { hit1: hitAt(1), hit3: hitAt(3), hit5: hitAt(5), mrr, n: g.length }
}

/** compare：读两模式 run.jsonl，并排 L2 指标 → comparison.md */
function runCompare(paperArg: string): void {
  const paperDir = isAbsolute(paperArg) ? paperArg : resolve(process.cwd(), paperArg)
  const runs: Partial<Record<ParseMode, RunQuery[]>> = {}
  for (const mode of MODES) {
    const p = join(paperDir, mode, 'run.jsonl')
    if (!existsSync(p)) {
      console.error(`✗ 缺 ${mode} 的 run.jsonl：${p}\n  请先对两个模式都跑 index + replay。`)
      process.exit(1)
    }
    runs[mode] = readJsonl<RunQuery>(p).filter((r) => r.type === 'query')
  }

  const lines: string[] = ['# structured vs lite 向量化对比', '', `- 生成时间：${nowIso()}`, `- paper：\`${basename(paperDir)}\``, '']
  for (const type of ['semantic', 'keyword'] as const) {
    const label = type === 'semantic' ? '语义问题' : '关键词查询'
    const sN = aggFromRun(runs.structured!, type, 'vector').n
    lines.push(`## ${label}（${sN} 条）`, '')
    lines.push(`| 链路 | 指标 | structured | lite | Δ(s−l) |`, `|------|------|-----------|------|--------|`)
    for (const path of PATHS) {
      const s = aggFromRun(runs.structured!, type, path)
      const l = aggFromRun(runs.lite!, type, path)
      for (const [k, sv, lv] of [
        ['Hit@1', s.hit1, l.hit1],
        ['Hit@3', s.hit3, l.hit3],
        ['Hit@5', s.hit5, l.hit5],
        ['MRR', s.mrr, l.mrr],
      ] as const) {
        const d = sv - lv
        lines.push(`| ${path} | ${k} | ${sv.toFixed(2)} | ${lv.toFixed(2)} | ${d >= 0 ? '+' : ''}${d.toFixed(2)} |`)
      }
    }
    lines.push('')
  }
  lines.push('> Δ>0 表示 structured 更优。语义看向量路、关键词看 FTS/hybrid 路。L3 相关性由 Claude Code 另判。', '')
  const out = join(paperDir, 'comparison.md')
  writeFileSync(out, lines.join('\n'), 'utf-8')
  console.log(lines.join('\n'))
  console.log(`\n✓ 写入 ${out}`)
}

/** 解析 --mode（默认 auto：先 structured 异常降级 lite，= 生产口径） */
function parseRequestMode(rest: string[]): RequestMode {
  const valid = [...MODES, 'auto']
  const i = rest.indexOf('--mode')
  const v = i >= 0 ? rest[i + 1] : undefined
  if (v && valid.includes(v)) return v as RequestMode
  if (v) {
    console.error(`✗ 未知模式 '${v}'，可选：${valid.join(' | ')}`)
    process.exit(1)
  }
  return 'auto'
}

/** replay/compare 用：解析实际落地模式（不含 auto，默认 structured） */
function parseMode(rest: string[]): ParseMode {
  const i = rest.indexOf('--mode')
  const v = i >= 0 ? rest[i + 1] : undefined
  if (v && (MODES as readonly string[]).includes(v)) return v as ParseMode
  if (v) {
    console.error(`✗ 未知模式 '${v}'，可选：${MODES.join(' | ')}`)
    process.exit(1)
  }
  return 'structured'
}

/** 取第一个非 flag 位置参数 */
function firstPositional(rest: string[]): string | undefined {
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--mode') { i++; continue }
    if (!rest[i].startsWith('--')) return rest[i]
  }
  return undefined
}

function main(): void {
  const [sub, ...rest] = process.argv.slice(2)
  if (sub === 'index') {
    const pdf = firstPositional(rest)
    if (!pdf) { console.error('用法：index <pdf-path> [--mode auto|structured|lite]（默认 auto：先 structured 异常降级 lite）'); process.exit(1) }
    void runIndex(pdf, parseRequestMode(rest))
  } else if (sub === 'replay') {
    const dir = firstPositional(rest)
    if (!dir) { console.error('用法：replay <paper-dir> [--mode structured|lite]'); process.exit(1) }
    void runReplay(dir, parseMode(rest))
  } else if (sub === 'compare') {
    const dir = firstPositional(rest)
    if (!dir) { console.error('用法：compare <paper-dir>'); process.exit(1) }
    runCompare(dir)
  } else {
    console.error(`未知子命令：${sub ?? '(空)'}\n用法：index <pdf> | replay <paper-dir> | compare <paper-dir>`)
    process.exit(1)
  }
}

main()
