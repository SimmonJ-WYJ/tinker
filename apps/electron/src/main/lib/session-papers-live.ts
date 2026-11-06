/**
 * session 检索流式进度（live 文件）读取器
 *
 * 读 ~/.asci/agent-sessions-papers/{sessionId}.live.json（paper-search MCP
 * retrieve 期间原子写、结束即删），做 snake_case → camelCase 映射后返回给渲染进程。
 *
 * 容错语义（全部返回 null，渲染侧视为"无进行中的检索"）：
 * - 文件不存在（正常态：没有检索在跑 / retrieve 已收尾）
 * - JSON 损坏（理论上原子写不会出现，防御性兜底）
 * - updated_at 超过 TTL（MCP 进程被 kill 留下的残留，不能让面板永远显示"检索中"）
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PaperRecord, SessionPapersLive, SessionPapersLiveSource } from '@asci/shared'
import { nowMs } from '@asci/shared'
import { getAgentSessionsPapersDir } from './config-paths'

/**
 * live 文件超过该时长未更新视为 stale 残留。这是**纯兜底**：banner 显示已由渲染侧
 * 「本会话 Agent 是否运行中」门控（agentRunning，准确判定残留，见 SessionPapersPanel），
 * 此 TTL 只防"久未触达的孤儿文件被并进 streamingPapers 记录列表"。
 * 取 30min 是为覆盖 scoring/reporting 这类 searching 之后的长阶段（report judgments 可达分钟级）——
 * 不能再用旧的 5min（单源 20s 语境），否则活跃的长报告会被误判残留、records 合并被切断。
 */
const LIVE_TTL_MS = 30 * 60_000

/** 渲染层可见的阶段；未知值（含 Python 侧未来扩展）按 searching 兜底 */
function normalizePhase(raw: unknown): SessionPapersLive['phase'] {
  return raw === 'processing' || raw === 'scoring' || raw === 'reporting' ? raw : 'searching'
}

function normalizeSources(raw: unknown): Record<string, SessionPapersLiveSource> {
  if (raw == null || typeof raw !== 'object') return {}
  const out: Record<string, SessionPapersLiveSource> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value == null || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    const verdict = v.verdict
    out[name] = {
      verdict:
        verdict === 'ok' || verdict === 'empty' || verdict === 'failed' ? verdict : 'pending',
      count: typeof v.count === 'number' ? v.count : 0,
    }
  }
  return out
}

/** 读取 live 进度快照；无 / 损坏 / 过期 → null */
export function readSessionPapersLive(sessionId: string): SessionPapersLive | null {
  const path = join(getAgentSessionsPapersDir(), `${sessionId}.live.json`)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    const updatedAt = typeof raw.updated_at === 'number' ? raw.updated_at : 0
    // TTL 兜底：MCP 进程被 kill 的残留文件不能让面板永远显示"检索中"
    if (nowMs() - updatedAt * 1000 > LIVE_TTL_MS) return null
    const reportTier = raw.report_tier === 'FULL' || raw.report_tier === 'MINIMAL' ? raw.report_tier : undefined
    return {
      schemaVersion: typeof raw.schema_version === 'number' ? raw.schema_version : 1,
      sessionId: typeof raw.session_id === 'string' ? raw.session_id : sessionId,
      turnId: typeof raw.turn_id === 'string' ? raw.turn_id : '',
      phase: normalizePhase(raw.phase),
      updatedAt,
      sources: normalizeSources(raw.sources),
      records: Array.isArray(raw.records) ? (raw.records as PaperRecord[]) : [],
      rawTotal: typeof raw.raw_total === 'number' ? raw.raw_total : 0,
      // #775 processing 补摘要进度（仅 enrich 真发生时由 Python 写入）
      ...(typeof raw.processed === 'number' ? { processed: raw.processed } : {}),
      ...(typeof raw.process_total === 'number' ? { processTotal: raw.process_total } : {}),
      // #775 scoring 进度（仅 phase=scoring 时由 Python 写入）
      ...(typeof raw.scored === 'number' ? { scored: raw.scored } : {}),
      ...(typeof raw.score_total === 'number' ? { scoreTotal: raw.score_total } : {}),
      // #775 reporting 确定性预告（仅 phase=reporting 时写入）
      ...(typeof raw.report_candidate_count === 'number' ? { reportCandidateCount: raw.report_candidate_count } : {}),
      ...(reportTier ? { reportTier } : {}),
      ...(typeof raw.report_section_count === 'number' ? { reportSectionCount: raw.report_section_count } : {}),
    }
  } catch (err) {
    console.warn('[检索进度] live 文件解析失败:', err)
    return null
  }
}
