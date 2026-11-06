/**
 * 会话证据快照（Q&A）格式的唯一事实源。
 *
 * conversation 类型 EvidenceRef 的 anchor.snapshotText 约定形态：
 *   Q: <question>
 *
 *   A: <answer>
 *
 * 无 question（极端首条历史消息无配对 user）时退化为只有 `A: <answer>`。
 *
 * 两处入口共用本函数拼接，避免双口径分叉：
 *   - 聊天界面「加入证据集」（renderer SDKMessageRenderer 的 AddToEvidenceSetButton）
 *   - 库内「补证据 · 历史对话」picker（主进程 listConversationTurns 回合抽取）
 */
export function buildQaSnapshot(input: { question: string; answer: string }): string {
  const q = input.question.trim()
  const a = input.answer.trim()
  if (!q) return `A: ${a}`
  return `Q: ${q}\n\nA: ${a}`
}

/**
 * buildQaSnapshot 的逆操作：把快照拆回 { question, answer }（展示侧用，可分别 markdown 渲染）。
 *   - `Q: …\n\nA: …` → 拆出两段
 *   - `A: …`（无问句）→ question=null
 *   - 不符合约定（历史/异常数据）→ 整段作为 answer 兜底，question=null
 * answer 内文保持 verbatim（含 markdown），不做任何清洗。
 */
export function parseQaSnapshot(text: string): { question: string | null; answer: string } {
  const qa = /^Q:\s*([\s\S]*?)\n\nA:\s*([\s\S]*)$/.exec(text)
  if (qa) return { question: qa[1]!.trim(), answer: qa[2]!.trim() }
  const aOnly = /^A:\s*([\s\S]*)$/.exec(text)
  if (aOnly) return { question: null, answer: aOnly[1]!.trim() }
  return { question: null, answer: text }
}
