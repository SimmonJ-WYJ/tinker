/**
 * 模型 → 上下文窗口（tokens）映射
 *
 * 真相源：SDK result message 的 `modelUsage[modelId].contextWindow`。
 * 但流式过程中 SDK 不返回此字段，部分非 Anthropic 渠道（DeepSeek / MiniMax /
 * Kimi 等 Anthropic-兼容端点）的 result 消息也不带 modelUsage。
 *
 * 本工具按 modelId（及可选 provider 提示）推断窗口大小，作为 fallback，
 * 使输入框上的进度环始终有分母可用。匹配不到时返回 200_000 兜底。
 *
 * 数据截止 2026-05。新增/调整模型上下文规格时在此集中维护。
 *
 * **规则匹配语义**
 * - patterns 用 `String.prototype.includes` 字符串匹配（已转小写）
 * - 规则按数组顺序匹配，**前面优先**：要求"精确具体"的放前面，宽松前缀放后面
 * - 同一系列里大窗口在前、小窗口在后（如 kimi-k2.6-infinite 2M 必须排在 kimi-k2 256K 前）
 * - 同时支持 `4-7` 和 `4.7` 两种连接符；以及 `claude-opus-4-7` 与 `claude-4-7-opus` 两种命名顺序
 */

interface Rule {
  /** 可选 provider 限定（小写），匹配渠道 provider 字段 */
  provider?: string
  /** 模型 ID 子串列表，命中任一即视为匹配 */
  patterns: readonly string[]
  /** 上下文窗口（tokens） */
  window: number
}

const RULES: readonly Rule[] = [
  // ============================================================
  // 超大上下文（>= 2M）— 必须排在所有泛用规则之前
  // ============================================================
  // Cursor LTM-2 — 100M 极端长上下文
  { patterns: ['ltm-2-mini', 'ltm-2'], window: 100_000_000 },
  // Llama 4 Scout — 10M
  { patterns: ['llama-4-scout'], window: 10_000_000 },
  // Grok 4.20 Vision — 2M
  { patterns: ['grok-4.20-vision', 'grok-4-20-vision'], window: 2_000_000 },
  // Kimi K2.6 Infinite — 2M（必须排在 kimi-k2 256K 之前）
  { patterns: ['kimi-k2.6-infinite', 'kimi-k2-6-infinite'], window: 2_000_000 },
  // GPT-5.5 Thinking — 1.05M（必须排在 gpt-5 128K 之前）
  { patterns: ['gpt-5.5-thinking', 'gpt-5-5-thinking'], window: 1_050_000 },

  // ============================================================
  // 1M 上下文
  // ============================================================
  // Claude 4.6 / 4.7 sonnet + opus（同时支持 `opus-4-7` 与 `4-7-opus` 两种命名顺序）
  {
    patterns: [
      'claude-opus-4-7', 'claude-opus-4.7',
      'claude-4-7-opus', 'claude-4.7-opus',
      'claude-opus-4-6', 'claude-opus-4.6',
      'claude-4-6-opus', 'claude-4.6-opus',
      'claude-sonnet-4-6', 'claude-sonnet-4.6',
      'claude-4-6-sonnet', 'claude-4.6-sonnet',
    ],
    window: 1_000_000,
  },
  // GPT 5.4 Flagship
  { patterns: ['gpt-5.4-flagship', 'gpt-5-4-flagship'], window: 1_000_000 },
  // Gemini 3.1 Pro / 2.5 Flash
  { patterns: ['gemini-3.1-pro', 'gemini-3-1-pro', 'gemini-2.5-flash', 'gemini-2-5-flash'], window: 1_000_000 },
  // Llama 4 Maverick
  { patterns: ['llama-4-maverick'], window: 1_000_000 },
  // Qwen 3-coder-480b / 3.6-plus（必须排在 qwen3-coder 256K / qwen-3 128K 之前）
  { patterns: ['qwen-3-coder-480b', 'qwen3-coder-480b'], window: 1_000_000 },
  { patterns: ['qwen-3.6-plus', 'qwen3.6-plus', 'qwen-3-6-plus', 'qwen3-6-plus'], window: 1_000_000 },
  // DeepSeek V4 Pro / Flash（必须排在 deepseek 128K 之前）
  { patterns: ['deepseek-v4-pro', 'deepseek-v4-flash'], window: 1_000_000 },
  // MiniMax M1
  { patterns: ['minimax-m1', 'abab-m1'], window: 1_000_000 },

  // ============================================================
  // 256K
  // ============================================================
  // Kimi K2（早期 K2 0905 / Turbo 等；K2.6 Infinite 已在 2M 段命中）
  { patterns: ['kimi-k2', 'moonshot-v1-k2'], window: 256_000 },
  // Qwen 3-coder / max（非 480b 变体）
  { patterns: ['qwen3-coder', 'qwen-coder', 'qwen3-max', 'qwen-max'], window: 256_000 },

  // ============================================================
  // 200K
  // ============================================================
  // Claude Haiku 全系列
  { patterns: ['claude-haiku', 'claude-3-5-haiku'], window: 200_000 },
  // 其他 Claude（4.5 / 3.x sonnet / opus）
  { patterns: ['claude-'], window: 200_000 },
  // OpenAI o-series
  { patterns: ['o1-', 'o3-', 'o4-'], window: 200_000 },
  // GLM-4.6
  { patterns: ['glm-4-6', 'glm-4.6'], window: 200_000 },
  // MiniMax M2
  { patterns: ['minimax-m2', 'abab-m2'], window: 200_000 },
  { provider: 'minimax', patterns: [''], window: 200_000 },
  // Kimi K1.5 / 其他 Kimi（保守 200K）
  { provider: 'kimi', patterns: ['kimi-', 'k1', 'k2'], window: 200_000 },
  { provider: 'moonshot', patterns: [''], window: 200_000 },

  // ============================================================
  // 163,840（DeepSeek R1-Distill）
  // ============================================================
  { patterns: ['deepseek-r1-distill', 'r1-distill'], window: 163_840 },

  // ============================================================
  // 128K
  // ============================================================
  // GPT 5.5 Instant
  { patterns: ['gpt-5.5-instant', 'gpt-5-5-instant'], window: 128_000 },
  // DeepSeek chat / reasoner（V4 / R1-Distill 已在前面命中）
  { patterns: ['deepseek'], window: 128_000 },
  { provider: 'deepseek', patterns: [''], window: 128_000 },
  // Mistral Large 3 / 通用 Mistral
  { patterns: ['mistral-large-3', 'mistral-large', 'mistral-medium', 'mistral-small'], window: 128_000 },
  // Cohere Command R / R+ / R v2
  { patterns: ['command-r-v2', 'command-r-plus', 'command-r'], window: 128_000 },
  // Moonshot v1 容量后缀
  { patterns: ['moonshot-v1-128k'], window: 128_000 },
  // Zhipu GLM-4.5 / 通用 GLM
  { patterns: ['glm-4-5', 'glm-4.5', 'glm-'], window: 128_000 },
  // Qwen 3 / 2.5 / 通用 Qwen
  { patterns: ['qwen3', 'qwen-3', 'qwen2.5', 'qwen2-5', 'qwen-'], window: 128_000 },
  // OpenAI GPT-4o / 4.1 / 5（早期 5.x 等）
  { patterns: ['gpt-5', 'gpt-4.1', 'gpt-4-1', 'gpt-4o', 'gpt-4-turbo', 'gpt-4-128k'], window: 128_000 },

  // ============================================================
  // 其他容量后缀 / 老模型
  // ============================================================
  { patterns: ['moonshot-v1-32k'], window: 32_000 },
  { patterns: ['gpt-4', 'gpt-3.5', 'gpt-3-5'], window: 16_000 },
  { patterns: ['moonshot-v1-8k'], window: 8_000 },
]

/** 兜底窗口（未匹配到任一规则时返回） */
export const DEFAULT_CONTEXT_WINDOW = 200_000

/**
 * 推断模型上下文窗口大小（tokens）。
 *
 * @param model    模型 ID，例如 "claude-opus-4-7-20251201"、"deepseek-v4-pro"、
 *                 "kimi-k2.6-infinite"、"MiniMax-M1"、"gpt-5.5-thinking"
 * @param provider 可选 provider 提示，用于消歧（'anthropic' / 'minimax' / 'kimi'
 *                 / 'moonshot' / 'deepseek' 等）
 * @returns 上下文窗口大小（tokens）；未匹配到时返回 DEFAULT_CONTEXT_WINDOW
 */
export function inferModelContextWindow(
  model?: string | null,
  provider?: string | null,
): number {
  if (!model && !provider) return DEFAULT_CONTEXT_WINDOW
  const m = (model ?? '').toLowerCase()
  const p = (provider ?? '').toLowerCase()

  for (const rule of RULES) {
    if (rule.provider && rule.provider !== p) continue
    // 空字符串 pattern = 通配（仅在 provider 已限定时有意义）
    const hit = rule.patterns.some((pat) => (pat === '' ? true : m.includes(pat)))
    if (hit) return rule.window
  }

  return DEFAULT_CONTEXT_WINDOW
}
