/**
 * 跨工作区 papers.jsonl 反查
 *
 * 用途：综述引文 → Library 联动时，主进程 papers 表里的 stub paper 通常没有
 * `zoteroKey`（review-citation 来源无从知道用户的 Zotero 状态）。此时作为
 * **冷热级联兜底**：扫所有 workspace 的 papers.jsonl，按 DOI / paperKey
 * 命中找到 WorkspacePaperEntry.linkedZoteroKey（用户手动 Add to Zotero 后会写）。
 *
 * 设计要点：
 *   - 一次扫所有 workspaces 而不是仅当前 workspace：综述里的 paper 可能来自
 *     另一个 workspace 的搜索结果；用户在 Library 视图里也不绑定特定 workspace
 *   - 同 DOI 多 workspace 命中：取首个 **有 linkedZoteroKey 的** entry；
 *     全无 linkedZoteroKey 则按 lastSeenAt 取最新一条（仍返回 null zoteroKey
 *     用于"paper 存在但未 link Zotero"的诊断）
 *   - DOI 归一与 paper-repository 一致（小写 / 去 URL 前缀 / 去 doi: 前缀）
 *   - 失败软容错：任何 jsonl 读失败仅 console.warn，继续其他 workspace
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type {
  ObjectId,
  PapersResolveZoteroKeyInput,
  PapersResolveZoteroKeyResult,
  WorkspacePaperEntry,
  ZoteroPdfRecord,
} from '@asci/shared'

import { getAgentWorkspacesDir } from './config-paths'
import { getDb as getObjectsDb } from './objects/object-store'
import {
  getPaperByDoi as getDbPaperByDoi,
  getPaperById as getDbPaperById,
} from './objects/repositories/paper-repository'
import { list as listWorkspacePapers } from './workspace-paper-store'
import { applySnapshotToPapers } from './zotero-paper-sync'
import { loadSnapshot } from './zotero-pdf-parser/snapshot-store'

/** 反查结果（区分 "找到了 + 有 zoteroKey" 与 "找到了但没 zoteroKey"） */
export interface WorkspaceLookupResult {
  /** 命中的工作区 slug；未命中为 null */
  workspaceSlug: string | null
  /** 命中的 entry（精简，避免主进程往渲染端泄漏过多内部字段） */
  entry: Pick<
    WorkspacePaperEntry,
    'key' | 'title' | 'doi' | 'linkedZoteroKey' | 'pdfRelPath'
  > | null
}

/**
 * 按 DOI 跨 workspace 反查
 *
 * 没命中返回 `{ workspaceSlug: null, entry: null }`。
 * 命中但无 linkedZoteroKey → 返回该 entry，`linkedZoteroKey` 为 null（用于诊断）。
 */
export function lookupByDoi(doi: string): WorkspaceLookupResult {
  const target = normalizeDoi(doi)
  if (!target) return { workspaceSlug: null, entry: null }
  let bestZk: { slug: string; entry: WorkspacePaperEntry } | null = null
  let fallback: { slug: string; entry: WorkspacePaperEntry } | null = null
  for (const slug of listWorkspaceSlugs()) {
    try {
      const entries = listWorkspacePapers(slug, {})
      for (const e of entries) {
        if (normalizeDoi(e.doi) !== target) continue
        if (e.linkedZoteroKey && e.linkedZoteroKey.trim()) {
          // 有 linkedZoteroKey 的优先：命中即返回（首个胜出）
          if (!bestZk) bestZk = { slug, entry: e }
        } else if (!fallback || e.lastSeenAt > fallback.entry.lastSeenAt) {
          fallback = { slug, entry: e }
        }
      }
      if (bestZk) break // 已经找到带 zoteroKey 的，不必再扫其他 workspace
    } catch (err) {
      console.warn(`[workspace-paper-lookup] 跳过 workspace=${slug}（读取失败）:`, err)
    }
  }
  const hit = bestZk ?? fallback
  if (!hit) return { workspaceSlug: null, entry: null }
  return {
    workspaceSlug: hit.slug,
    entry: pickEntry(hit.entry),
  }
}

/**
 * 按 workspace paper key 跨 workspace 反查（备用入口，当前主路径走 DOI）
 *
 * paperKey 是 workspace-paper-store 内部去重 key（DOI 优先；否则 sha1/title-year）。
 * 不强归一；调用方传啥就用啥精确匹配。
 */
export function lookupByPaperKey(paperKey: string): WorkspaceLookupResult {
  const k = paperKey.trim()
  if (!k) return { workspaceSlug: null, entry: null }
  for (const slug of listWorkspaceSlugs()) {
    try {
      const entries = listWorkspacePapers(slug, {})
      for (const e of entries) {
        if (e.key !== k) continue
        return { workspaceSlug: slug, entry: pickEntry(e) }
      }
    } catch (err) {
      console.warn(`[workspace-paper-lookup] 跳过 workspace=${slug}（读取失败）:`, err)
    }
  }
  return { workspaceSlug: null, entry: null }
}

/** 列出 ~/.asci/agent-workspaces 下的所有 slug（目录名） */
function listWorkspaceSlugs(): string[] {
  const dir = getAgentWorkspacesDir()
  if (!existsSync(dir)) return []
  let out: string[] = []
  try {
    out = readdirSync(dir).filter((name) => {
      try {
        return statSync(join(dir, name)).isDirectory()
      } catch {
        return false
      }
    })
  } catch (err) {
    console.warn('[workspace-paper-lookup] 读取 agent-workspaces 目录失败:', err)
  }
  return out
}

/** DOI 归一（与 paper-repository.normalizeDoiForStorage 同语义；本文件不依赖那边以避免循环引用） */
function normalizeDoi(doi: string | null | undefined): string | null {
  if (doi == null) return null
  let s = String(doi).trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
  s = s.replace(/^doi:\s*/, '')
  return s.length > 0 ? s : null
}

function pickEntry(e: WorkspacePaperEntry): WorkspaceLookupResult['entry'] {
  return {
    key: e.key,
    title: e.title,
    doi: e.doi,
    linkedZoteroKey: e.linkedZoteroKey,
    pdfRelPath: e.pdfRelPath,
  }
}

/**
 * 在 zotero-pdf-snapshot.json 内按 DOI 反查 record
 *
 * 用途：综述引文 → Library 联动 resolver 的"最后一道兜底"——
 * SQLite + workspace papers.jsonl 都没找到 zoteroKey 时，再看 Zotero 实际本地库
 * 里有没有这个 DOI；有则说明用户**已经在 Zotero 里收藏了**，只是 papers 表
 * 还没同步过来（典型场景：Pipeline B 上线前就已有的 Zotero 条目）。
 *
 * DOI 匹配走 normalizeDoi 归一；任意失败软容错（snapshot 不存在 / 读失败 → 返回 null）。
 */
export function lookupSnapshotByDoi(doi: string): ZoteroPdfRecord | null {
  const target = normalizeDoi(doi)
  if (!target) return null
  let snap: ReturnType<typeof loadSnapshot> | null = null
  try {
    snap = loadSnapshot()
  } catch (err) {
    console.warn('[workspace-paper-lookup] 读 zotero-pdf-snapshot.json 失败:', err)
    return null
  }
  if (!snap) return null
  for (const rec of Object.values(snap.pdfs)) {
    const parent = rec.parent
    if (!parent) continue
    if (normalizeDoi(parent.DOI) === target) return rec
  }
  return null
}

/**
 * 综述引文 → Library 联动 resolver（main 侧入口）
 *
 * 冷热级联：
 *   1. 入参 zoteroKey 直接短路（最快）
 *   2. SQLite papers 表：doi → id 顺序反查
 *   3. workspace papers.jsonl 跨工作区扫（WorkspacePaperEntry.linkedZoteroKey）
 *   4. zotero-pdf-snapshot.json 反查：命中 → 视为 resolved（parent.itemKey 即 zoteroKey），
 *      并 **write-through** 到 SQLite（避免下次再走这条慢路径）
 *   5. 仍没有 → paper-not-found / no-zotero-key（带 paperTitle）
 */
export function resolveZoteroKeyForEvidence(
  input: PapersResolveZoteroKeyInput,
): PapersResolveZoteroKeyResult {
  const zk = input.zoteroKey && input.zoteroKey.trim()
  if (zk) return { status: 'resolved', zoteroKey: zk, source: 'sqlite' }

  const doi = input.doi && input.doi.trim() ? input.doi.trim() : null
  const paperId = input.paperId && input.paperId.trim() ? input.paperId.trim() : null
  if (!doi && !paperId) return { status: 'no-identifier' }

  // 2) SQLite papers 表
  let dbPaperTitle: string | null = null
  let dbPaperZk: string | null = null
  try {
    const db = getObjectsDb()
    let p = doi ? getDbPaperByDoi(db, doi) : null
    if (!p && paperId) p = getDbPaperById(db, paperId as ObjectId)
    if (p) {
      dbPaperTitle = p.title
      dbPaperZk = p.zoteroKey && p.zoteroKey.trim() ? p.zoteroKey : null
    }
  } catch (err) {
    console.warn('[resolveZoteroKey] SQLite 反查失败（继续走 workspace 兜底）:', err)
  }
  if (dbPaperZk) return { status: 'resolved', zoteroKey: dbPaperZk, source: 'sqlite' }

  // 3) workspace papers.jsonl 兜底（只有 doi 才能跨 workspace 扫；纯 paperId 没法）
  let wsPaperTitle: string | null = null
  if (doi) {
    const ws = lookupByDoi(doi)
    if (ws.entry) {
      wsPaperTitle = ws.entry.title
      if (ws.entry.linkedZoteroKey && ws.entry.linkedZoteroKey.trim()) {
        return {
          status: 'resolved',
          zoteroKey: ws.entry.linkedZoteroKey.trim(),
          source: 'workspace',
        }
      }
    }
  }

  // 4) zotero-pdf-snapshot.json 反查（兜底中的兜底）
  //    命中说明用户其实在 Zotero 里有这篇，只是 papers 表没同步上 → write-through
  let snapshotTitle: string | null = null
  let snapshotZk: string | null = null
  if (doi) {
    const rec = lookupSnapshotByDoi(doi)
    if (rec && rec.parent) {
      snapshotTitle = rec.parent.title
      snapshotZk = rec.parentItemKey
      if (snapshotZk) {
        // write-through：把这条 snapshot record 同步进 SQLite，下次 resolve 在第 2 步命中
        try {
          applySnapshotToPapers(getObjectsDb(), [rec])
        } catch (err) {
          console.warn('[resolveZoteroKey] snapshot → SQLite write-through 失败（不阻断）:', err)
        }
        return { status: 'resolved', zoteroKey: snapshotZk, source: 'sqlite' }
      }
    }
  }

  // 5) 总归没有 zoteroKey
  const anyPaperTitle = dbPaperTitle ?? wsPaperTitle ?? snapshotTitle
  if (!dbPaperTitle && !wsPaperTitle && !snapshotTitle) {
    return { status: 'paper-not-found' }
  }
  return { status: 'no-zotero-key', paperTitle: anyPaperTitle }
}

/** 测试导出 */
export const __testing__ = { normalizeDoi, listWorkspaceSlugs }
