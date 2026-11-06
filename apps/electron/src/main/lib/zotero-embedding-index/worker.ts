/**
 * 向量索引 worker：单篇 PDF 的三层语料增量嵌入
 *
 * runOne(key)：
 *   1. raw       ：读 {key}.md → hash 比对 → 变更则 chunk + embed + 三表替换
 *   2. article   ：article 已 completed 时同上（{key}.article.md）
 *   3. title_abstract：snapshot rec 的 title/parent 元数据拼一条
 *
 * 增量键 = attachment_key + content_hash（按层独立）；model_id 维度由
 * vector-db 的 meta 整库保证（换模型整库重建，不在单篇粒度处理）。
 *
 * 测试性：全部运行时副作用经 WorkerDeps 注入，单测可完全脱离磁盘/模型。
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import type { ZoteroEmbeddingTextKind, ZoteroPdfRecord } from '@asci/shared'
import { buildTitleAbstractChunk, chunkWikiMarkdown } from './chunker.ts'
import type { ChunkInput, ZoteroVectorDb } from './vector-db.ts'
import type { EmbedKind } from './embedder.ts'

/** 嵌入推理的最小接口（生产 = E5Embedder；测试注入 stub） */
export interface EmbedFn {
  (texts: string[], kind: EmbedKind): Promise<Float32Array[]>
}

export interface WorkerDeps {
  /** 拿单条 snapshot record（无则返回 undefined） */
  getRecord: (attachmentKey: string) => ZoteroPdfRecord | undefined
  /** raw md 路径解析（lite 纯文本，无段落锚点；作 raw 层回退源） */
  getMdPath: (attachmentKey: string) => string
  /** structured .txt 路径解析（pdfjs 排版感知，<p id> 段落锚点；作 raw 层优先源） */
  getStructuredTxtPath: (attachmentKey: string) => string
  /** article md 路径解析 */
  getArticleMdPath: (attachmentKey: string) => string
  readFile: (path: string) => string
  fileExists: (path: string) => boolean
  vdb: ZoteroVectorDb
  embed: EmbedFn
  /** 单批嵌入条数（CPU 推理，批太大延迟高） */
  batchSize?: number
}

export function defaultFsDeps(): Pick<WorkerDeps, 'readFile' | 'fileExists'> {
  return {
    readFile: (p) => readFileSync(p, 'utf-8'),
    fileExists: (p) => existsSync(p),
  }
}

const DEFAULT_BATCH_SIZE = 8

export function contentHash(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

/** 单层处理结果（状态摘要/日志用） */
export interface LayerResult {
  textKind: ZoteroEmbeddingTextKind
  action: 'skipped-fresh' | 'embedded' | 'missing-source'
  chunkCount?: number
}

/**
 * 跑一篇的全部语料层。任何一层失败抛错（由队列捕获标 failed）。
 */
export async function runOne(attachmentKey: string, deps: WorkerDeps): Promise<LayerResult[]> {
  const rec = deps.getRecord(attachmentKey)
  if (!rec || rec.parse?.status !== 'completed') {
    // 源不在/未解析：清掉可能的残留（防解析回退后索引悬挂）
    deps.vdb.deleteByAttachmentKey(attachmentKey)
    return [{ textKind: 'raw', action: 'missing-source' }]
  }

  const results: LayerResult[] = []

  // 1. raw 层：优先 structured .txt（排版感知 + 段落锚点 → snippet 更干净连续、定位更准），
  //    无则回退 lite .md（纯文本 + 字节偏移锚点）。chunkWikiMarkdown 按是否含 <p id> 自动选模式。
  const txtPath = deps.getStructuredTxtPath(attachmentKey)
  const rawPath = deps.fileExists(txtPath) ? txtPath : deps.getMdPath(attachmentKey)
  if (deps.fileExists(rawPath)) {
    results.push(
      await embedLayer(deps, attachmentKey, 'raw', deps.readFile(rawPath), chunkWikiMarkdown),
    )
  } else {
    results.push({ textKind: 'raw', action: 'missing-source' })
  }

  // 2. article 层（LLMWiki 摘要；仅生成完成时有）
  const articlePath = deps.getArticleMdPath(attachmentKey)
  if (rec.article?.status === 'completed' && deps.fileExists(articlePath)) {
    results.push(
      await embedLayer(deps, attachmentKey, 'article', deps.readFile(articlePath), chunkWikiMarkdown),
    )
  }

  // 3. title_abstract 层（snapshot 元数据，无需读 wiki 文件）
  const taChunk = buildTitleAbstractChunk({
    title: rec.parent?.title ?? rec.title,
    authors: (rec.parent?.creators ?? [])
      .map((c) => c.name ?? [c.lastName, c.firstName].filter(Boolean).join(', '))
      .filter((s) => s.length > 0),
    year: extractYear(rec.parent?.date ?? null),
    abstract: rec.parent?.abstractNote ?? null,
  })
  if (taChunk) {
    results.push(
      await embedLayer(deps, attachmentKey, 'title_abstract', taChunk.content, () => [taChunk]),
    )
  }

  return results
}

/** 单层：hash 比对 → 变更才 chunk + embed + 替换 */
async function embedLayer(
  deps: WorkerDeps,
  attachmentKey: string,
  textKind: ZoteroEmbeddingTextKind,
  sourceContent: string,
  toChunks: (content: string) => ChunkInput[],
): Promise<LayerResult> {
  const hash = contentHash(sourceContent)
  if (deps.vdb.getContentHash(attachmentKey, textKind) === hash) {
    return { textKind, action: 'skipped-fresh' }
  }

  const chunks = toChunks(sourceContent)
  if (chunks.length === 0) {
    // 源存在但无可嵌内容：写空层（记 hash，避免反复重试）
    deps.vdb.replaceChunks(attachmentKey, textKind, hash, [])
    return { textKind, action: 'embedded', chunkCount: 0 }
  }

  // 分批嵌入（CPU 推理控制单批延迟）
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE
  const embeddings: Float32Array[] = []
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize)
    embeddings.push(...(await deps.embed(batch.map((c) => c.content), 'passage')))
  }

  deps.vdb.replaceChunks(attachmentKey, textKind, hash, chunks, embeddings)
  return { textKind, action: 'embedded', chunkCount: chunks.length }
}

/** 从 Zotero 原始日期串（"2012" / "2012-05" / "May 2012"）提取 4 位年份 */
function extractYear(date: string | null): string | null {
  if (!date) return null
  const m = /\b(19|20)\d{2}\b/.exec(date)
  return m ? m[0] : null
}
