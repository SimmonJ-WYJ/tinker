/**
 * detectIntentSwitch —— 启发式判断用户消息是否表达"切换能力包"意图（A4 phase4）。
 *
 * 命中规则的话 → 清空 sessionMeta.stickyCapabilityPackId，让 Master 下一轮重新路由。
 *
 * 首版规则简单粗暴；后续按 X1 访谈反馈优化（或换 LLM 判定）。
 */
const SWITCH_PATTERNS: ReadonlyArray<{ regex: RegExp; rule: string }> = [
  { regex: /切换到/, rule: 'zh:switch-to' },
  { regex: /改用/, rule: 'zh:use-instead' },
  { regex: /用[^。！？!?]*(?:包|pack)/, rule: 'zh:use-pack' },
  { regex: /(?:关闭|停用|不要(?:用|再用))/, rule: 'zh:stop' },
  { regex: /\bswitch\s+to\b/i, rule: 'en:switch-to' },
  { regex: /\bstop\s+using\b/i, rule: 'en:stop-using' },
  { regex: /\bclose\s+the?\s+\w+\s+pack\b/i, rule: 'en:close-pack' },
  { regex: /\buse\s+\w+\s+instead\b/i, rule: 'en:use-instead' },
]

export interface IntentSwitchResult {
  shouldClearSticky: boolean
  matchedRule?: string
}

export function detectIntentSwitch(message: string): IntentSwitchResult {
  if (!message) return { shouldClearSticky: false }
  for (const { regex, rule } of SWITCH_PATTERNS) {
    if (regex.test(message)) return { shouldClearSticky: true, matchedRule: rule }
  }
  return { shouldClearSticky: false }
}
