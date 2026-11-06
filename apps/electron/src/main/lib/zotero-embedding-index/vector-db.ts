/**
 * 向量索引库（vector-index.db）连接 + schema + 读写 + 混合检索
 *
 * 定位：wiki 语料的**可重建缓存**（区别于 asci.db 的珍贵数据）——
 *   - 独立 SQLite 文件，自管 user_version，不进主库 migration 序列
 *   - meta.model_id 与当前嵌入模型不符 / schema 升级 / 损坏 → 整库删除重建
 *
 * 三表设计（rowid 对齐）：
 *   - chunks      ：chunk 主表（attachment_key + text_kind + 锚点 + section_index/title + 原文 + content_hash）
 *   - vec_chunks  ：sqlite-vec vec0 虚表（embedding float[dim]），rowid = chunks.id
 *   - fts_chunks  ：FTS5 external-content 表（BM25，trigram 分词兜中英混合），content=chunks
 *
 * 检索：向量 KNN ∪ FTS5 各取 top-N → RRF（倒数排名融合，k=60）→ 每篇去重保留 top 命中。
 *
 * driver 说明（与 object-store.test.ts 同一结论）：
 *   生产走 better-sqlite3；Bun 测试运行时不支持其 native binding（oven-sh/bun#4290），
 *   因此本类只依赖 RawVectorDb 最小接口，测试用 bun:sqlite 适配（vec 扩展不加载，
 *   覆盖 chunks/FTS/RRF/去重逻辑；vec0 真路径由 Electron 冒烟覆盖）。
 */

import { existsSync, rmSync } from 'node:fs'
import type { ZoteroEmbeddingTextKind, ZoteroSemanticSearchHit } from '@asci/shared'

/** schema 版本：升级时整库重建（缓存定位，无需增量迁移）。v2: chunks 加 section_index/section_title */
const SCHEMA_VERSION = 2

/** RRF 融合常数（经验值，Cormack et al. 2009） */
const RRF_K = 60

/**
 * 融合权重（P1 调优）：向量腿权重高于 FTS 腿，让强语义命中压过 FTS 噪声。
 * 评测验证：等权 RRF 下 FTS 噪声会把向量排好的正确 chunk 挤出 top-k（跨篇回退）。
 */
const FUSE_WEIGHT_VECTOR = 2
const FUSE_WEIGHT_FTS = 1
/**
 * FTS 命中过少（< 此值）时判定其信号不足、整路降权为 0（仅靠向量）。
 * 针对"FTS 仅凭常见词凑出零星弱匹配却来污染融合"的场景（如中文/paraphrase 查询）。
 */
const MIN_FTS_FUSE_HITS = 2

/** 单路召回的过取倍数：vec0 KNN 无法按 attachment_key 预过滤，过取后在 JS 侧过滤 */
const OVERFETCH_FACTOR = 8
/** 单路召回的过取硬上限 */
const OVERFETCH_CAP = 512

/** 语料层 textKind 不在 chunk 上：replaceChunks 的参数是唯一事实源 */
export interface ChunkInput {
  /** 锚点："p3_1"（段落）/ "b12345"（字节偏移）/ null（title_abstract） */
  anchorStart: string | null
  anchorEnd: string | null
  /** 顶层章节号（= 锚点 "pS_P" 的 S）；纯文本/title_abstract 无章节 → 省略/null */
  sectionIndex?: number | null
  /** 章节标题（如 "Methods"，去编号前缀）；无章节归属或解析不到 → 省略/null */
  sectionTitle?: string | null
  content: string
}

export interface SearchOptions {
  /** 查询向量（Float32Array，维度须与 meta.embed_dim 一致）；省略则只走 FTS */
  queryEmbedding?: Float32Array
  /** 原始查询文本（FTS5 一路用）；省略则只走向量 */
  queryText?: string
  /** 返回条数上限 */
  maxResults: number
  /** 限定 attachmentKey 集合（如仅当前 workspace 已引用论文） */
  attachmentKeys?: string[]
  /** 限定语料层 */
  textKinds?: ZoteroEmbeddingTextKind[]
  /** 限定顶层章节号（精确匹配，按 attachmentKey 篇内编号，通常配单篇用） */
  sectionIndex?: number
  /** 限定章节标题（substring 大小写不敏感匹配 chunk 自带的 section_title，可跨篇） */
  sectionTitle?: string
  /** 每篇论文最多保留几条命中（去重防刷屏），默认 3 */
  maxPerPaper?: number
}

/** prepare 语句最小接口（better-sqlite3 与 bun:sqlite 均满足） */
export interface RawStatement {
  run(...args: unknown[]): { lastInsertRowid: number | bigint }
  get(...args: unknown[]): unknown
  all(...args: unknown[]): unknown[]
}

/** 底层连接最小接口（better-sqlite3 与 bun:sqlite 均满足） */
export interface RawVectorDb {
  exec(sql: string): void
  prepare(sql: string): RawStatement
  transaction<T>(fn: () => T): () => T
  close(): void
}

/**
 * 加权 RRF 倒数排名融合（纯函数，可独立单测）。
 *
 * 每路贡献 `weight / (RRF_K + rank)`。等权（weights 省略）= 经典 RRF。
 * 加权用于让强信号路（向量）压过弱信号路（FTS）的噪声：评测发现等权 RRF 下，
 * FTS 找不到答案却把不相关 chunk 排高位时，会把向量已排好的正确 chunk 挤下去
 * （跨篇复现的 hybrid 回退）。weight=0 的路完全不参与（用于 FTS 命中过少时跳过）。
 *
 * @param rankedLists 每路召回的 rowid 有序列表（rank 从 1 开始）
 * @param weights 每路权重（与 rankedLists 同序）；省略或某项缺省视为 1
 * @returns rowid → 融合分，降序排序后的数组
 */
export function rrfFuse(
  rankedLists: number[][],
  weights?: number[],
): Array<[rowid: number, score: number]> {
  const fused = new Map<number, number>()
  rankedLists.forEach((list, li) => {
    const w = weights?.[li] ?? 1
    if (w === 0) return
    list.forEach((rowid, i) => {
      fused.set(rowid, (fused.get(rowid) ?? 0) + w / (RRF_K + i + 1))
    })
  })
  return [...fused.entries()].sort((a, b) => b[1] - a[1])
}

/**
 * 把自然语言查询编译成 FTS5 MATCH 表达式（trigram 友好）。
 *
 * 背景（关键修复）：trigram 分词下，把整串多词查询当**单个引号短语** MATCH 只会
 * 匹配**连续子串**——自然语序的多词 query（"ramp-ups post-test segmentation
 * unbalanced sampling"）几乎永不命中，FTS 腿恒空、RRF hybrid 退化成纯向量。
 * 改为按空白切词、各词项转义后用 OR 组合；多词时额外保留整串短语，让连续命中
 * 的 chunk 经 BM25 排序更靠前（短语命中 → 多匹配一项 → 分更高）。OR 只增不减召回。
 *
 * 注意：
 *   - trigram 最小单元为 3 字符，< 3 字符的词项（含 2 字中文词）无法命中，直接剔除
 *     （固有局限，不抛错）；全部词项过短时返回 null（FTS 路跳过，退化为纯向量）。
 *   - 中文无空格分词：整串中文查询会被当作一个长词项做子串匹配，仍受连续子串局限，
 *     非本函数职责（需上游分词）；2 字中文词同样因 < 3 字符被剔除。
 *   - 双引号 "" 转义防 FTS5 query 语法注入/报错。
 *
 * @returns MATCH 表达式；无可用词项时返回 null
 */
export function buildFtsMatchQuery(queryText: string): string | null {
  const escape = (s: string) => s.replaceAll('"', '""')
  const trimmed = queryText.trim()
  const terms = trimmed.split(/\s+/).filter((t) => t.length >= 3)
  if (terms.length === 0) return null
  // Set 去重：重复词项（如 "Hypothesis Testing ... Hypothesis Testing"）只保留一份
  const phrases = new Set<string>()
  // 多词查询额外保留整串短语；单词查询整串即等于唯一词项，无需冗余
  if (terms.length > 1) phrases.add(`"${escape(trimmed)}"`)
  for (const t of terms) phrases.add(`"${escape(t)}"`)
  return [...phrases].join(' OR ')
}

interface ChunkRow {
  id: number
  attachment_key: string
  text_kind: ZoteroEmbeddingTextKind
  anchor_start: string | null
  anchor_end: string | null
  section_index: number | null
  section_title: string | null
  content: string
}

export class ZoteroVectorDb {
  /** chunk 总数内存缓存：状态推送高频读取，避免每次 COUNT(*)（写路径同步维护） */
  private chunkCountCache: number

  private constructor(
    private readonly db: RawVectorDb,
    /** vec0 虚表是否可用（扩展加载失败/测试环境为 false，检索退化为纯 FTS） */
    readonly vecAvailable: boolean,
  ) {
    const row = db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }
    this.chunkCountCache = Number(row.n)
  }

  /**
   * 生产入口：用 better-sqlite3 打开（或新建）索引库文件。
   *
   * @param expected 当前模型 id + 维度；与库内 meta 不符时整库删除重建
   */
  static open(path: string, expected: { modelId: string; embedDim: number }): ZoteroVectorDb {
    // 动态 require：better-sqlite3 与 sqlite-vec 都是 native，--external 打包；
    // 测试路径不触达本函数，避免 bun test 加载 native binding 失败
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite3 = require('better-sqlite3') as new (p: string) => RawVectorDb & {
      pragma: (s: string, o?: { simple: boolean }) => unknown
      loadExtension: (file: string) => void
    }

    let vecAvailable = true
    /** open + PRAGMA + 加载 vec 扩展（首开与重建后共用同一路径） */
    const openWithExtension = () => {
      const db = new BetterSqlite3(path)
      db.pragma('journal_mode = WAL')
      db.pragma('synchronous = NORMAL')
      // 缓存库无跨表 FK（vec0 虚表也不支持），不开 foreign_keys
      db.pragma('busy_timeout = 5000')
      if (vecAvailable) {
        try {
          // sqlite-vec 的 getLoadablePath 用 __dirname 解析平台分包 dylib，须 --external 打包
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const sqliteVec = require('sqlite-vec') as { getLoadablePath: () => string }
          db.loadExtension(sqliteVec.getLoadablePath())
        } catch (err) {
          vecAvailable = false
          console.error('[向量索引] sqlite-vec 扩展加载失败，检索退化为纯 FTS：', err)
        }
      }
      return db
    }

    let db = openWithExtension()

    // schema 版本或模型不符 → 删库重建（缓存定位，安全）
    if (needsRebuild(db, expected)) {
      db.close()
      for (const suffix of ['', '-wal', '-shm']) {
        const f = `${path}${suffix}`
        if (existsSync(f)) rmSync(f, { force: true })
      }
      console.log('[向量索引] schema/模型变更，已删除旧索引库重建')
      db = openWithExtension()
    }

    ensureSchema(db, expected, vecAvailable)
    return new ZoteroVectorDb(db, vecAvailable)
  }

  /**
   * 测试入口：在已打开的连接（如 bun:sqlite 适配器）上建 schema。
   * vec 扩展不加载（vecAvailable=false），覆盖 FTS/RRF/去重逻辑。
   */
  static openWithRaw(
    db: RawVectorDb,
    expected: { modelId: string; embedDim: number },
    opts?: { vecAvailable?: boolean },
  ): ZoteroVectorDb {
    const vecAvailable = opts?.vecAvailable ?? false
    ensureSchema(db, expected, vecAvailable)
    return new ZoteroVectorDb(db, vecAvailable)
  }

  /** 读 meta 值 */
  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value
  }

  /** 某篇某层当前入库的 content_hash（增量判定用；无记录返回 undefined） */
  getContentHash(attachmentKey: string, textKind: ZoteroEmbeddingTextKind): string | undefined {
    const row = this.db
      .prepare('SELECT content_hash FROM chunks WHERE attachment_key = ? AND text_kind = ? LIMIT 1')
      .get(attachmentKey, textKind) as { content_hash: string } | undefined
    return row?.content_hash
  }

  /** chunk 总数（状态摘要用；内存缓存，O(1)） */
  countChunks(): number {
    return this.chunkCountCache
  }

  /** 已入库的 attachmentKey 去重列表 */
  listAttachmentKeys(): string[] {
    const rows = this.db.prepare('SELECT DISTINCT attachment_key AS k FROM chunks').all() as Array<{
      k: string
    }>
    return rows.map((r) => r.k)
  }

  /**
   * 整体替换某篇某层的全部 chunk（事务内三表同步）。
   *
   * @param embeddings 与 chunks 一一对应的向量；vec 不可用时忽略
   */
  replaceChunks(
    attachmentKey: string,
    textKind: ZoteroEmbeddingTextKind,
    contentHash: string,
    chunks: ChunkInput[],
    embeddings?: Float32Array[],
  ): void {
    if (this.vecAvailable && embeddings && embeddings.length !== chunks.length) {
      throw new Error(
        `[向量索引] embeddings 数量(${embeddings.length})与 chunks(${chunks.length})不一致`,
      )
    }
    const now = Date.now()
    this.db.transaction(() => {
      this.deleteByKeyAndKind(attachmentKey, textKind)
      const insertChunk = this.db.prepare(
        `INSERT INTO chunks (attachment_key, text_kind, anchor_start, anchor_end, section_index, section_title, content, content_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      const insertVec = this.vecAvailable
        ? this.db.prepare('INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)')
        : null
      const insertFts = this.db.prepare('INSERT INTO fts_chunks (rowid, content) VALUES (?, ?)')
      chunks.forEach((c, i) => {
        // textKind 以参数为唯一事实源（delete 范围与插入行必须一致）
        const info = insertChunk.run(
          attachmentKey,
          textKind,
          c.anchorStart,
          c.anchorEnd,
          c.sectionIndex ?? null,
          c.sectionTitle ?? null,
          c.content,
          contentHash,
          now,
        )
        const rowid = Number(info.lastInsertRowid)
        const embedding = embeddings?.[i]
        if (insertVec && embedding) {
          // vec0 严格要求 rowid 为 SQLITE_INTEGER；better-sqlite3 须用 BigInt 绑定
          insertVec.run(BigInt(rowid), float32ToBuffer(embedding))
        }
        insertFts.run(rowid, c.content)
      })
    })()
    this.chunkCountCache += chunks.length
  }

  /** 删除某篇的全部层（Zotero 源删除联动） */
  deleteByAttachmentKey(attachmentKey: string): void {
    this.db.transaction(() => {
      const rows = this.db
        .prepare('SELECT id FROM chunks WHERE attachment_key = ?')
        .all(attachmentKey) as Array<{ id: number }>
      this.deleteRowids(rows.map((r) => r.id))
    })()
  }

  private deleteByKeyAndKind(attachmentKey: string, textKind: ZoteroEmbeddingTextKind): void {
    const rows = this.db
      .prepare('SELECT id FROM chunks WHERE attachment_key = ? AND text_kind = ?')
      .all(attachmentKey, textKind) as Array<{ id: number }>
    this.deleteRowids(rows.map((r) => r.id))
  }

  private deleteRowids(rowids: number[]): void {
    if (rowids.length === 0) return
    this.chunkCountCache -= rowids.length
    const delChunk = this.db.prepare('DELETE FROM chunks WHERE id = ?')
    const delVec = this.vecAvailable
      ? this.db.prepare('DELETE FROM vec_chunks WHERE rowid = ?')
      : null
    // external-content FTS5 不能直接 DELETE，须走 'delete' 特殊命令带原文
    const delFts = this.db.prepare(
      `INSERT INTO fts_chunks (fts_chunks, rowid, content)
       SELECT 'delete', id, content FROM chunks WHERE id = ?`,
    )
    for (const rowid of rowids) {
      delFts.run(rowid)
      // vec0 rowid 须 BigInt 绑定（同 insert）
      if (delVec) delVec.run(BigInt(rowid))
      delChunk.run(rowid)
    }
  }

  /**
   * 混合检索：向量 KNN ∪ FTS5 BM25 → 加权 RRF 融合（向量腿加权 + FTS 命中少时降权）
   * → 过滤 → 每篇去重。命中回传原始余弦 / BM25 分（P3，相对信号）。
   */
  search(opts: SearchOptions): ZoteroSemanticSearchHit[] {
    const overfetch = Math.min(opts.maxResults * OVERFETCH_FACTOR, OVERFETCH_CAP)

    // 一路：向量 KNN（distance 升序）。取出 distance 换算原始余弦（P3 回传）：
    // vec0 默认 L2 距离 + E5 单位向量 → cos = 1 − d²/2（distance 越小余弦越大）。
    let vecList: number[] = []
    const cosineByRowid = new Map<number, number>()
    if (this.vecAvailable && opts.queryEmbedding) {
      const rows = this.db
        .prepare(
          'SELECT rowid, distance FROM vec_chunks WHERE embedding MATCH ? AND k = ? ORDER BY distance',
        )
        .all(float32ToBuffer(opts.queryEmbedding), overfetch) as Array<{
        rowid: number | bigint
        distance: number
      }>
      for (const r of rows) {
        const id = Number(r.rowid)
        vecList.push(id)
        cosineByRowid.set(id, 1 - (r.distance * r.distance) / 2)
      }
    }

    // 二路：FTS5 BM25（多词查询切词后 OR 组合；全部词项过短时 ftsQuery=null，跳过该路）。
    // 取出 bm25 原始分（P3 回传；FTS5 bm25 越负越相关）。
    let ftsList: number[] = []
    const bm25ByRowid = new Map<number, number>()
    const ftsQuery = opts.queryText ? buildFtsMatchQuery(opts.queryText) : null
    if (ftsQuery) {
      try {
        const rows = this.db
          .prepare(
            'SELECT rowid, bm25(fts_chunks) AS bm25 FROM fts_chunks WHERE fts_chunks MATCH ? ORDER BY bm25(fts_chunks) LIMIT ?',
          )
          .all(ftsQuery, overfetch) as Array<{ rowid: number | bigint; bm25: number }>
        for (const r of rows) {
          const id = Number(r.rowid)
          ftsList.push(id)
          bm25ByRowid.set(id, r.bm25)
        }
      } catch {
        // FTS 语法异常（极端输入）不让整次检索失败，静默降级为单路
      }
    }

    // P1 融合调优：向量腿加权（FUSE_WEIGHT_VECTOR）；仅在 hybrid（向量也有命中）且 FTS 命中
    // 过少时把 FTS 整路降权为 0（仅靠向量）。纯 FTS 降级（向量不可用/未传）时不降权，否则
    // 仅匹配 1 个 chunk 的查询会返回空。
    const ftsWeight =
      vecList.length > 0 && ftsList.length < MIN_FTS_FUSE_HITS ? 0 : FUSE_WEIGHT_FTS
    const fused = rrfFuse([vecList, ftsList], [FUSE_WEIGHT_VECTOR, ftsWeight])
    if (fused.length === 0) return []

    // 批量取行（一次 IN 查询替代逐 rowid 查）+ 过滤 + 每篇去重
    const placeholders = fused.map(() => '?').join(',')
    const rows = this.db
      .prepare(
        `SELECT id, attachment_key, text_kind, anchor_start, anchor_end, section_index, section_title, content FROM chunks WHERE id IN (${placeholders})`,
      )
      .all(...fused.map(([rowid]) => rowid)) as ChunkRow[]
    const rowById = new Map(rows.map((r) => [Number(r.id), r]))
    const keyFilter = opts.attachmentKeys ? new Set(opts.attachmentKeys) : null
    const kindFilter = opts.textKinds ? new Set(opts.textKinds) : null
    const sectionTitleNeedle = opts.sectionTitle?.trim().toLowerCase()
    const maxPerPaper = opts.maxPerPaper ?? 3
    const perPaper = new Map<string, number>()
    const hits: ZoteroSemanticSearchHit[] = []

    for (const [rowid, score] of fused) {
      if (hits.length >= opts.maxResults) break
      const row = rowById.get(rowid)
      if (!row) continue // vec/fts 残留孤儿 rowid，跳过
      if (keyFilter && !keyFilter.has(row.attachment_key)) continue
      if (kindFilter && !kindFilter.has(row.text_kind)) continue
      // 章节过滤：sectionIndex 精确（篇内编号）；sectionTitle 对 chunk 自带标题做大小写不敏感 substring。
      // 无章节归属（lite raw / title_abstract）的 chunk 在任一章节过滤生效时一律排除。
      if (opts.sectionIndex !== undefined && row.section_index !== opts.sectionIndex) continue
      if (sectionTitleNeedle && !(row.section_title ?? '').toLowerCase().includes(sectionTitleNeedle)) {
        continue
      }
      const used = perPaper.get(row.attachment_key) ?? 0
      if (used >= maxPerPaper) continue
      perPaper.set(row.attachment_key, used + 1)
      hits.push({
        paperId: row.attachment_key,
        textKind: row.text_kind,
        anchorStart: row.anchor_start,
        anchorEnd: row.anchor_end,
        sectionIndex: row.section_index,
        sectionTitle: row.section_title,
        snippet: row.content,
        score,
        rawCosine: cosineByRowid.get(rowid) ?? null,
        rawBm25: bm25ByRowid.get(rowid) ?? null,
      })
    }
    return hits
  }

  close(): void {
    this.db.close()
  }
}

function needsRebuild(
  db: RawVectorDb,
  expected: { modelId: string; embedDim: number },
): boolean {
  const ver = getUserVersion(db)
  if (ver === 0) return false // 全新库，直接建表
  if (ver !== SCHEMA_VERSION) return true
  const meta = readMeta(db)
  return meta.model_id !== expected.modelId || meta.embed_dim !== String(expected.embedDim)
}

function getUserVersion(db: RawVectorDb): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
  return row?.user_version ?? 0
}

function readMeta(db: RawVectorDb): Record<string, string> {
  try {
    const rows = db.prepare('SELECT key, value FROM meta').all() as Array<{
      key: string
      value: string
    }>
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  } catch {
    return {}
  }
}

function ensureSchema(
  db: RawVectorDb,
  expected: { modelId: string; embedDim: number },
  vecAvailable: boolean,
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id             INTEGER PRIMARY KEY,
      attachment_key TEXT NOT NULL,
      text_kind      TEXT NOT NULL CHECK (text_kind IN ('raw','article','title_abstract')),
      anchor_start   TEXT,
      anchor_end     TEXT,
      section_index  INTEGER,                -- 顶层章节号（= 锚点 pS_P 的 S）；无章节归属 → NULL
      section_title  TEXT,                   -- 章节标题（如 "Methods"）；无章节归属 → NULL
      content        TEXT NOT NULL,
      content_hash   TEXT NOT NULL,
      created_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_att ON chunks(attachment_key);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
      content,
      tokenize = 'trigram',
      content = 'chunks',
      content_rowid = 'id'
    );
  `)
  if (vecAvailable) {
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(embedding float[${expected.embedDim}]);`,
    )
  }
  const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
  setMeta.run('model_id', expected.modelId)
  setMeta.run('embed_dim', String(expected.embedDim))
  setMeta.run('built_at', new Date().toISOString())
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}

/** Float32Array → BLOB（sqlite-vec 接受 float32 小端字节序） */
function float32ToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)
}
