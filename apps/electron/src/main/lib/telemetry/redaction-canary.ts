/**
 * #710 统一 canary 泄漏断言工具（被各片测试 + 最终 release-gate 复用）。
 *
 * **非 .test.ts**：不被 bun test 收集；只导出 canary 常量 + 断言工具。纯函数、无 fs/electron 依赖。
 * 验收口径：原始 canary 串在所有普通出口 **0 命中**；允许出现的只有占位符（[[REDACTED:...]] / [[PROMPT:sha256:...]]）。
 */

/** 各类敏感面的显眼假串（grep 唯一标记 ASCI_CANARY_*_710）。 */
export const CANARY = {
  secretToken: 'ASCI_CANARY_SECRET_TOKEN_710',
  promptBody: 'ASCI_CANARY_PROMPT_BODY_710',
  rawToolInput: 'ASCI_CANARY_RAW_TOOL_INPUT_710',
  thinking: 'ASCI_CANARY_THINKING_710',
  query: 'ASCI_CANARY_QUERY_710',
  privatePath: '/Users/opensci_claw/ASCI_CANARY_PRIVATE_PATH_710',
} as const

/** 所有 canary 原文串。 */
export const ALL_CANARY_STRINGS: readonly string[] = Object.values(CANARY)

/** 允许出现的脱敏占位符（出现这些是合规的）。 */
export const ALLOWED_PLACEHOLDERS = [
  '[[REDACTED:credential]]',
  '[[REDACTED:path]]',
  '[[REDACTED:pii]]',
  '[[REDACTED:thinking]]',
  '[[REDACTED:tool-payload:',
  '[[REDACTED:query:',
  '[[REDACTED:file-content:',
  '[[PROMPT:sha256:',
] as const

function asText(payload: unknown): string {
  return typeof payload === 'string' ? payload : JSON.stringify(payload)
}

/** 断言 payload 序列化后 0 命中任何 canary 原文（命中即报哪个泄漏）。opts.allow 显式豁免个别串。 */
export function assertNoCanary(payload: unknown, opts?: { allow?: readonly string[] }): void {
  const text = asText(payload)
  const allow = new Set(opts?.allow ?? [])
  for (const c of ALL_CANARY_STRINGS) {
    if (allow.has(c)) continue
    if (text.includes(c)) {
      throw new Error(`[canary] 泄漏：出口 payload 含原始敏感串 "${c}"（应已脱敏为占位符）`)
    }
  }
}

/** 断言 payload 含期望占位符（如 '[[REDACTED:credential]]' / '[[PROMPT:sha256:'）。 */
export function assertHasPlaceholder(payload: unknown, placeholder: string): void {
  if (!asText(payload).includes(placeholder)) {
    throw new Error(`[canary] 期望占位符缺失："${placeholder}"`)
  }
}
