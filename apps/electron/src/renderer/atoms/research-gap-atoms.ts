/**
 * 研究空白对照表的 renderer 状态（0.4 Epic 1）。
 *
 * 由 agent 的 `present_research_gap_table` 工具经 eventBus → useGlobalAgentListeners 推入；
 * 按 sessionId 隔离，**每会话可累积多张表**（用户对不同论文集多次发起研究空白，各自独立）。
 * 每张表带唯一 id + AI 生成的简短标题：
 * - 右栏按 `research-gap:<tableId>` 开独立、可关闭的 Tab（标题 = table.title）；
 * - 对话流内结果卡片按 tableId 点击唤起对应 Tab。
 */
import { atom } from 'jotai'
import type { ResearchGapTable } from '@asci/shared'

/** 每会话累积的研究空白对照表列表（key = sessionId，按生成顺序追加） */
export const researchGapTablesBySessionAtom = atom<Map<string, ResearchGapTable[]>>(new Map())

/** 不可变追加：把一张新表追加到指定 session 的列表（同 id 已存在则替换，幂等） */
export function appendResearchGapTable(
  prev: Map<string, ResearchGapTable[]>,
  sessionId: string,
  table: ResearchGapTable,
): Map<string, ResearchGapTable[]> {
  const next = new Map(prev)
  const list = next.get(sessionId) ?? []
  const without = list.filter((t) => t.id !== table.id)
  next.set(sessionId, [...without, table])
  return next
}
