/**
 * Turn debug 内容格式化（#710 PR3 · spec §8.4/§12.2）
 *
 * 两个出口（脱敏边界），取代原 formatTurnDebugContent 的「一键全量 raw dump」：
 * - formatTurnUserSafeSummary：默认 / 生产可见。只出 L0/L1——text 原文 + 工具**动作摘要**
 *   （不含 input/result）；thinking → [[REDACTED:thinking]]；未知块只留标题。
 *   绝不含 raw tool I/O / prompt body / secret。
 * - formatTurnRedactedDiagnostic：受控诊断（dev-gated）。text 原文 + tool input/result 经脱敏原语
 *   （凭证/路径/邮箱 → 占位符）+ thinking 占位符。即使在 dev 也**不出 raw 全文**。
 *
 * 区分于 CopyButton（只复制 text 块）。speaker 标在每条 block 标题，方便定位 master / scenario。
 */
import { redactTextWithMatches, redactDeepWithMatches, REDACTION_PLACEHOLDER } from '@asci/shared'
import type { SDKContentBlock, SDKMessage, SDKUserMessage, SDKToolResultBlock, AgentSpeaker } from '@asci/shared'

export interface TurnDebugBlock {
  block: SDKContentBlock
  speaker: AgentSpeaker
}

const formatSpeaker = (speaker: AgentSpeaker): string => {
  if (speaker === 'master') return 'master'
  return `scenario:${speaker.name}${speaker.packId ? ` (pack=${speaker.packId})` : ''}`
}

const extractToolResultText = (rb: SDKToolResultBlock): string => {
  if (typeof rb.content === 'string') return rb.content
  if (Array.isArray(rb.content)) {
    return (rb.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('')
  }
  return ''
}

/** 从 turnMessages 提取 tool_use_id → tool_result text 映射。 */
function buildToolResultMap(turnMessages: readonly SDKMessage[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const msg of turnMessages) {
    if (msg.type !== 'user') continue
    const userMsg = msg as SDKUserMessage
    const content = userMsg.message?.content
    if (!Array.isArray(content)) continue
    for (const b of content) {
      if (b.type === 'tool_result') {
        const rb = b as SDKToolResultBlock
        map.set(rb.tool_use_id, extractToolResultText(rb))
      }
    }
  }
  return map
}

const headerOf = (te: TurnDebugBlock, i: number): string =>
  `## [${i + 1}] ${te.block.type} · speaker=${formatSpeaker(te.speaker)}`

/**
 * 默认 / 生产：user-safe summary（L0/L1）。无 raw tool I/O / thinking 全文 / prompt body / secret。
 */
export function formatTurnUserSafeSummary(
  topLevelEnriched: readonly TurnDebugBlock[],
  _turnMessages: readonly SDKMessage[],
): string {
  const lines: string[] = ['# Turn summary (user-safe)', '']
  topLevelEnriched.forEach((te, i) => {
    const block = te.block
    const header = headerOf(te, i)
    if (block.type === 'text' && 'text' in block) {
      lines.push(header, '', (block as { text: string }).text, '')
      return
    }
    if (block.type === 'thinking') {
      lines.push(header, '', REDACTION_PLACEHOLDER.thinking, '')
      return
    }
    if (block.type === 'tool_use') {
      const tu = block as { name: string }
      // 仅动作摘要：工具名；不含 input/result
      lines.push(`${header} · name=${tu.name}`, '', `- Tool call: ${tu.name}`, '')
      return
    }
    // 未知块：只留标题，不出原始 JSON
    lines.push(header, '')
  })
  return lines.join('\n').trimEnd() + '\n'
}

/**
 * 受控诊断（dev-gated）：text + 脱敏后的 tool input/result + thinking 占位符。即使 dev 也不出 raw 全文。
 */
export function formatTurnRedactedDiagnostic(
  topLevelEnriched: readonly TurnDebugBlock[],
  turnMessages: readonly SDKMessage[],
): string {
  const resultMap = buildToolResultMap(turnMessages)
  const lines: string[] = ['# Turn debug (redacted diagnostic)', '']
  topLevelEnriched.forEach((te, i) => {
    const block = te.block
    const header = headerOf(te, i)
    if (block.type === 'text' && 'text' in block) {
      lines.push(header, '', (block as { text: string }).text, '')
      return
    }
    if (block.type === 'thinking') {
      lines.push(header, '', REDACTION_PLACEHOLDER.thinking, '')
      return
    }
    if (block.type === 'tool_use') {
      const tu = block as { id: string; name: string; input?: unknown }
      const rawResult = resultMap.get(tu.id)
      const redactedInput = JSON.stringify(redactDeepWithMatches(tu.input ?? {}).value, null, 2)
      const redactedResult =
        rawResult != null ? redactTextWithMatches(rawResult).value : '(no tool_result captured in this turn)'
      lines.push(
        `${header} · name=${tu.name} · id=${tu.id}`,
        '',
        '**input** (redacted):',
        '```json',
        redactedInput,
        '```',
        '',
        '**result** (redacted):',
        redactedResult,
        '',
      )
      return
    }
    lines.push(header, '', '```json', JSON.stringify(redactDeepWithMatches(block).value, null, 2), '```', '')
  })
  return lines.join('\n').trimEnd() + '\n'
}
