/**
 * Papers IPC 通道与类型 —— Paper 反查（评论引文 → Library 联动用）
 *
 * 渲染端综述视图点击 <cite> 后，§7 <li> 可能只携带 data-doi 或 data-paper-id 而没有
 * data-zotero-key。需要主进程把这些标识反查成稳定的 Paper 行（含 zoteroKey）才能
 * 联动 [[librarySelectedItemKeyAtom]]（库视图按 zoteroKey 选条目）。
 *
 * 设计要点：
 *   - 仅暴露只读反查接口；写入（softDelete / update）走仓储层的内部 service
 *   - 返回 Paper 行的精简快照（id / title / doi / zoteroKey / 等），无 body 字段
 *   - 找不到时返回 null（不抛错，便于 renderer disable 按钮 / 提示用户）
 */

import type { Paper } from './objects/index.ts'
import type { PaperRecord } from './agent.ts'

export const PAPERS_IPC_CHANNELS = {
  /** 按 DOI 反查（DOI 在主进程仓储层会做归一化匹配） */
  GET_BY_DOI: 'papers:getByDoi',
  /** 按主进程生成的 ObjectId 反查 */
  GET_BY_ID: 'papers:getById',
  /**
   * 解析 paper 标识 → Zotero item key（综述引文 → Library 联动专用）
   *
   * 主进程内做"冷热级联"：
   *   1. SQLite papers 表反查（doi / id 任一命中即可）
   *   2. 没有 zoteroKey 时退到 ~/.asci/agent-workspaces/{slug}/papers.jsonl 跨工作区扫描
   *   3. 仍没找到则返回 `paper-not-found`；找到但 zoteroKey 仍为空 → `no-zotero-key`
   *
   * 渲染端只需一次 IPC 拿结果。
   */
  RESOLVE_ZOTERO_KEY: 'papers:resolveZoteroKey',
  /**
   * 按 DOI 查 crossref 元数据 → PaperRecord（对话流 / 检索报告 DOI 点击，
   * 未命中本次检索时的即时查询；spec: docs/specs/doi-paper-jump-spec.md §5.3）。
   * 主进程直调 crossref REST（5s 超时），确定性查询不过 Agent。
   */
  LOOKUP_DOI_METADATA: 'papers:lookupDoiMetadata',
} as const

export interface PapersGetByDoiInput {
  doi: string
}

export interface PapersGetByIdInput {
  id: Paper['id']
}

/** 反查结果：找不到时为 null；不抛错由调用方决定 disable / 提示 */
export type PapersGetResult = Paper | null

/** resolveZoteroKey 入参：doi / id / zoteroKey 三选一可任意组合，主进程按优先级试 */
export interface PapersResolveZoteroKeyInput {
  zoteroKey?: string | null
  doi?: string | null
  paperId?: string | null
}

/**
 * resolveZoteroKey 结果（带诊断信息）
 *
 * `status` 取值：
 *   - 'resolved'        — 拿到 zoteroKey；调用方可直接 setLibrarySelectedItemKey
 *   - 'no-identifier'   — 三个标识都为空，根本没法查
 *   - 'paper-not-found' — 标识非空但 papers 表 + workspace 都没记录
 *   - 'no-zotero-key'   — 找到了对应 paper 但未关联 Zotero（用户尚未 Add to Zotero）
 *
 * 'no-zotero-key' 时附带 `paperTitle` 用于 UI 提示"哪篇论文未关联"。
 */
export type PapersResolveZoteroKeyResult =
  | { status: 'resolved'; zoteroKey: string; source: 'sqlite' | 'workspace' }
  | { status: 'no-identifier' }
  | { status: 'paper-not-found' }
  | { status: 'no-zotero-key'; paperTitle: string | null }

/** lookupDoiMetadata 入参：已归一化的 DOI（小写、无 doi:/doi.org 前缀） */
export interface PapersLookupDoiMetadataInput {
  doi: string
}

/**
 * lookupDoiMetadata 结果。
 *   - 'found'     — record.source 固定为 'doi-lookup'（不冒充 MCP 检索来源），不写入本次检索
 *   - 'not-found' — crossref 无此 DOI（HTTP 404）
 *   - 'error'     — 网络 / 超时 / 解析异常；message 仅供日志，renderer 走外链兜底
 */
export type PapersLookupDoiMetadataResult =
  | { status: 'found'; record: PaperRecord }
  | { status: 'not-found' }
  | { status: 'error'; message: string }
