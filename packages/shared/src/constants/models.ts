/**
 * 默认模型 ID · 单一真源
 *
 * 此前散落在 agent-orchestrator.ts（DEFAULT_MODEL_ID）、
 * claude-agent-adapter.ts（内联 fallback）与 core 五个 provider profile 的
 * defaultProbeModel，值相同且语义相同（Claude 兼容通道的默认/探测模型），统一收口到这里。
 */

/** Claude 兼容通道的默认模型，也用作 channel 连通性探测模型 */
export const DEFAULT_CLAUDE_MODEL_ID = 'claude-sonnet-4-5-20250929'
