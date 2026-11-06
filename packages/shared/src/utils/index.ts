/**
 * Shared utility functions for asci
 */

// Placeholder - will be expanded as needed
export function noop(): void {
  // no-op
}

export { diffCapabilities } from './capabilities-diff'
export type { CapabilityChange } from './capabilities-diff'
export { isHiddenEntry, HIDDEN_FS_ENTRIES } from './is-hidden-entry'
export { normalizeDoi } from './normalize-doi'
export { sanitizeText } from './sanitize-text'
export { buildQaSnapshot, parseQaSnapshot } from './qa-snapshot'
export { errMsg } from './err-msg'
export { inferModelContextWindow, DEFAULT_CONTEXT_WINDOW } from './model-context-window'
export { normalizePaperSource, COMMON_PAPER_SOURCES } from './paper-source'
export type { NormalizedPaperSource } from './paper-source'
export {
  isModelEnabledInChannel,
  pickFallbackModel,
  reconcileActiveModel,
  isClaudeFamilyEnabled,
  hasAnyEnabledClaudeModel,
} from './channel-model-reconcile'
export type { ReconcileActiveModelResult, ClaudeModelFamily } from './channel-model-reconcile'
export {
  SUBAGENT_TOOL_NAMES,
  SUBAGENT_TOOL_ALLOWED_TOOLS_INPUT,
  isSubagentToolUse,
} from './subagent-tool-name.ts'
export type { SubagentToolName } from './subagent-tool-name.ts'
export { dayjs, nowIso, nowMs, toIso, toMs } from './date-time.ts'
export type { DateInput } from './date-time.ts'
