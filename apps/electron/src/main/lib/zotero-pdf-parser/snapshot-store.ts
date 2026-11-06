/**
 * Zotero PDF snapshot 持久化层
 *
 * snapshot 文件被 zotero-pdf-diff（写整份）和 zotero-pdf-parser worker（更新单条 record 的
 * parse 字段）共同读写，故必须串行化所有写操作以避免互踩。
 *
 * 同时负责 schema v1 → v2 的运行时迁移（旧条目自动补齐 parse 字段为 pending）。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type {
  ZoteroPdfArticleState,
  ZoteroPdfParseState,
  ZoteroPdfRecord,
} from '@asci/shared'
import { nowIso } from '@asci/shared'
import { getZoteroPdfSnapshotPath } from '../config-paths'
import { writeIndexFromSnapshot } from './index-writer'

/** schema v4 的 snapshot 结构（v4 新增 record.article 字段） */
export interface ZoteroPdfSnapshot {
  schemaVersion: 4
  capturedAt: string
  pdfs: Record<string, ZoteroPdfRecord>
}

/**
 * 单条新建 record / pending 重置时的 parse 默认值
 *
 * 默认策略：'lite' —— pdf-parse 抽 plain text + 简单 markdown 包装。
 * wiki/{key}.md 由本队列产出，下游 article-generator 直读此 md。
 *
 * 结构化富格式（YAML frontmatter + OUTLINE + `<p id>`）走独立的 .txt 链路，
 * 由用户手动在设置页"生成结构化 TXT"按钮触发，**不**经过本 worker 队列。
 */
export const DEFAULT_PARSE_STATE: ZoteroPdfParseState = {
  status: 'pending',
  mdPath: null,
  strategy: 'lite',
  parsedAt: null,
  error: null,
  attempts: 0,
  sourceMtimeMs: null,
  sourceSize: null,
}

export function makeDefaultParseState(): ZoteroPdfParseState {
  return { ...DEFAULT_PARSE_STATE }
}

/** 单条新建 record 的 article 默认值（lazy 实例化时使用） */
export const DEFAULT_ARTICLE_STATE: ZoteroPdfArticleState = {
  status: 'idle',
  articlePath: null,
  generatedAt: null,
  articleCreated: null,
  sourceMdMtimeMs: null,
  error: null,
  attempts: 0,
  channelId: null,
  model: null,
  promptVersion: 0,
}

export function makeDefaultArticleState(): ZoteroPdfArticleState {
  return { ...DEFAULT_ARTICLE_STATE }
}

/**
 * 读取 snapshot；不存在或损坏返回 null
 *
 * 自动迁移 v1（无 parse 字段）→ v2：为每条 record 补 DEFAULT_PARSE_STATE
 */
export function loadSnapshot(): ZoteroPdfSnapshot | null {
  const path = getZoteroPdfSnapshotPath()
  if (!existsSync(path)) return null

  let parsed: { schemaVersion?: number; capturedAt?: string; pdfs?: Record<string, ZoteroPdfRecord> }
  try {
    const raw = readFileSync(path, 'utf-8')
    parsed = JSON.parse(raw)
  } catch (err) {
    console.warn('[Zotero PDF Snapshot] 文件损坏，将作为首次扫描重建:', err)
    return null
  }

  if (!parsed || typeof parsed !== 'object' || !parsed.pdfs || typeof parsed.pdfs !== 'object') {
    console.warn('[Zotero PDF Snapshot] 文件结构不正确，将作为首次扫描重建')
    return null
  }

  const sv = parsed.schemaVersion
  if (sv !== 1 && sv !== 2 && sv !== 3 && sv !== 4) {
    console.warn(`[Zotero PDF Snapshot] 不识别的 schemaVersion=${sv}，将作为首次扫描重建`)
    return null
  }

  // v1 → v2 迁移：每条 record 补 parse
  if (sv === 1) {
    for (const rec of Object.values(parsed.pdfs)) {
      if (!rec.parse) rec.parse = makeDefaultParseState()
    }
    console.log('[Zotero PDF Snapshot] schema v1 → v2 迁移：已为现存 record 补 parse 字段')
  }

  // v2 → v3 迁移：每条 record 补 parent=null（下次 diff 会拉满）
  if (sv === 1 || sv === 2) {
    for (const rec of Object.values(parsed.pdfs)) {
      if (rec.parent === undefined) rec.parent = null
    }
    console.log('[Zotero PDF Snapshot] schema v2 → v3 迁移：已为现存 record 补 parent=null')
  }

  // v3 → v4 迁移：每条 record 补 article=null（lazy 实例化，由 article worker 启动扫描时按需创建）
  if (sv === 1 || sv === 2 || sv === 3) {
    for (const rec of Object.values(parsed.pdfs)) {
      if (rec.article === undefined) rec.article = null
    }
    console.log('[Zotero PDF Snapshot] schema v3 → v4 迁移：已为现存 record 补 article=null')
  }

  return {
    schemaVersion: 4,
    capturedAt: parsed.capturedAt ?? nowIso(),
    pdfs: parsed.pdfs,
  }
}

/** 直接覆盖整份快照（仅 zotero-pdf-diff 用） */
function saveSnapshotSync(snap: ZoteroPdfSnapshot): void {
  writeFileSync(getZoteroPdfSnapshotPath(), JSON.stringify(snap, null, 2), 'utf-8')
}

/**
 * 写 snapshot 后同步把 wiki/index.json 重写一份
 *
 * 失败仅打 warn，不阻塞 snapshot 写入（index 是衍生数据，可下次 snapshot 变动时重建）。
 */
function writeIndexSafely(snap: ZoteroPdfSnapshot): void {
  try {
    writeIndexFromSnapshot(snap)
  } catch (err) {
    console.warn('[Zotero PDF Snapshot] 写 wiki/index.json 失败:', err)
  }
}

/**
 * 串行写锁
 *
 * 任何写入（diff 全量覆盖 / worker 单条更新）都通过 updateSnapshot 进入此链，
 * 保证读-改-写原子性。
 */
let writeChain: Promise<void> = Promise.resolve()

/**
 * 在 mutator 中读取最新 snapshot 并就地修改，写回磁盘。
 * 失败不阻塞后续操作。
 */
export function updateSnapshot(
  mutator: (snap: ZoteroPdfSnapshot) => void | Promise<void>,
): Promise<void> {
  const next = writeChain.then(async () => {
    const snap = loadSnapshot() ?? createEmptySnapshot()
    await mutator(snap)
    snap.capturedAt = nowIso()
    saveSnapshotSync(snap)
    // snapshot 任意变动后同步重写 wiki/index.json（diff 全量覆盖 / worker 单条 mdPath 更新都触发）
    writeIndexSafely(snap)
  })
  writeChain = next.catch(err => {
    console.error('[Zotero PDF Snapshot] 写入失败:', err)
  })
  return next
}

/** 整份替换（diff 用，仍走串行链） */
export function replaceSnapshot(snap: ZoteroPdfSnapshot): Promise<void> {
  return updateSnapshot(current => {
    current.pdfs = snap.pdfs
  })
}

export function createEmptySnapshot(): ZoteroPdfSnapshot {
  return {
    schemaVersion: 4,
    capturedAt: nowIso(),
    pdfs: {},
  }
}

/**
 * 部分更新单条 record 的 parse 字段（worker 用）
 *
 * record 不存在时静默跳过（可能 diff 期间被删除）
 */
export function updateRecordParse(
  attachmentKey: string,
  patch: Partial<ZoteroPdfParseState>,
): Promise<void> {
  return updateSnapshot(snap => {
    const rec = snap.pdfs[attachmentKey]
    if (!rec) return
    rec.parse = { ...rec.parse, ...patch }
  })
}

/**
 * 部分更新单条 record 的 article 字段（article worker 用）
 *
 * 若 article 仍为 null（lazy 状态），先实例化为默认值再合并 patch。
 * record 不存在时静默跳过。
 */
export function updateRecordArticle(
  attachmentKey: string,
  patch: Partial<ZoteroPdfArticleState>,
): Promise<void> {
  return updateSnapshot(snap => {
    const rec = snap.pdfs[attachmentKey]
    if (!rec) return
    const base = rec.article ?? makeDefaultArticleState()
    rec.article = { ...base, ...patch }
  })
}
