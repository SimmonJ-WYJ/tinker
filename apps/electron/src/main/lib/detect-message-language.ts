/**
 * Agent 输出语言路由
 *
 * 实现 CLAUDE.md §2 "UI 语言 + 用户消息语言双重判断"：
 * - 用户消息含任意 CJK 字符 → 'zh'
 * - 用户消息全无 CJK 字符 → 'en'
 * - 消息为空 / 仅空白 / 以 '/' 开头的 slash 命令 → 回退 UI 语言（/compact 等无文本输入）
 * - 语言中立输入（纯数字 / 数字+分隔符 / 列表序号）→ 沿用上一轮缓存语言，否则回退 UI 语言
 *
 * 检测前先剥离 fenced code blocks、inline code、URL，避免：
 * - 英文 query 里带中文代码注释被误判为 zh
 * - URL 路径里出现中文 anchor 被误判为 zh
 */

import { isCjkCodePoint } from './agent-tool-token-estimator'

export type AppLocale = 'en' | 'zh'

/**
 * 判定输入是否"语言中立"——不含任何语言信号、应沿用上一轮已解析语言。
 *
 * 命中场景：
 * - 纯阿拉伯数字："2024"、"42"
 * - 数字 + 常见分隔符（空格 / "." / "," / "-" / "/" / ":"、括号）："3.14"、"2024-05-18"、"1, 2, 3"
 * - 列表序号："1."、"2)"、"(3)"
 *
 * 不命中（继续走 detectOutputLanguage 常规路径）：
 * - 含任意拉丁字母 / CJK / 其他文字字符
 * - 空字符串 / 仅空白（由 detectOutputLanguage 自己回退 UI 语言）
 * - 仅符号、无数字（无明确"延续上文"语义）
 *
 * 调用前应已剥离 fenced code / inline code / URL —— 与 detectOutputLanguage 同管线，
 * 避免 "what is `42`?" 误判为 neutral。
 */
export function isLanguageNeutralInput(strippedTrimmed: string): boolean {
  if (!strippedTrimmed) return false
  if (!/\d/.test(strippedTrimmed)) return false
  return /^[\d\s.,\-/:()]+$/.test(strippedTrimmed)
}

export function detectOutputLanguage(
  userMessage: string,
  uiLanguage: AppLocale,
  cachedLanguage?: AppLocale,
): AppLocale {
  const trimmed = userMessage?.trim() ?? ''
  if (!trimmed) return uiLanguage
  if (trimmed.startsWith('/')) return uiLanguage

  const stripped = trimmed
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .trim()

  // 语言中立输入（纯数字 / 数字+分隔符 / 列表序号）：
  // 上下文承接信号缺失，沿用缓存避免语言抖动；无缓存（cold start）回退 UI 语言。
  if (isLanguageNeutralInput(stripped)) {
    return cachedLanguage ?? uiLanguage
  }

  for (let i = 0; i < stripped.length; ) {
    const cp = stripped.codePointAt(i)
    if (cp !== undefined && isCjkCodePoint(cp)) return 'zh'
    i += cp !== undefined && cp > 0xFFFF ? 2 : 1
  }
  return 'en'
}

/**
 * 渠道豁免清单：仅 Anthropic 原生 Claude 渠道不需要 user-turn 语言锁。
 *
 * 经验：除 Anthropic native 外，所有 Anthropic-compat provider（minimax / kimi /
 * moonshot / deepseek / openrouter，以及未来新增的其他 LLM）在 reasoning trace、
 * 长 turn 后段 narration 或 tool_result 之间均观察到不同程度的输出语言漂移：
 * - DeepSeek V4：推理通道训练偏中文，UI=en 时 thinking 段常滑回中文（PR #200）
 * - Kimi-K2-Thinking 类：tool_use 多轮后 narration 可能切回训练高频语言
 * - 其他 Anthropic-compat 网关：是否转发 `thinking` 配置不保证，行为不稳定
 *
 * 因此采用「黑名单」语义：anthropic 豁免，其他全部注入。
 *
 * Forward-compat：未来新增 LLM provider 时只需扩 `ProviderType` enum（强制要做），
 * 无需回头改这里 — 新 provider 自动落入注入路径，零代码改动获保护。
 *
 * Anthropic 豁免理由：Claude 严格服从 system prompt 末段的 Output Language directive，
 * 注入 `<language_lock>` 会冗余、占 token，并让 prompt cache 失效（cache 命中前缀变更）。
 * 若未来 Claude 也出现漂移，从此 Set 移除 'anthropic' 即可。
 */
const PROVIDERS_EXEMPT_FROM_USER_TURN_LANG_PIN: ReadonlySet<string> = new Set(['anthropic'])

/**
 * 构造 user turn 前置的硬性语言约束。
 *
 * 返回 null 表示不需要注入（anthropic 渠道豁免或 provider 缺失）。锁体语言随解析语言：
 * zh 锁全中文、en 锁全英文——这是 CLAUDE.md §2「内置 prompt 统一英文」的**有意例外**：
 * 锁体是运行时语言路由变量，语言本身就是它的载荷。实测（2026-06-10，DeepSeek-V4-Pro）
 * 英文锁体 + 单句中文锚不足以扭转 reasoning 通道在 agentic 路由任务上的英文先验
 * （第一段 thinking 固定以 "The user is asking…" 开场）；全中文锁体最大化同语言锚 token。
 *
 * 经验：Anthropic-compat provider（特别是 DeepSeek V4 系列）只对最近一次 user-visible
 * 锚点稳定服从；锚点远离当前生成位置时（例如多次 tool_use → tool_result 之后），
 * thinking trace 会滑回训练高频语言。所以 pin 文本必须含"forbidden 反例 +
 * 自我纠正指令"，并配合两道近点锚：user turn 尾部锚（buildUserTurnLanguageTailAnchor，
 * 紧贴第一段 thinking 生成点）+ PostToolUse hook 每次 tool_result 后重注
 * （buildLanguageLockContext）。
 */
export function buildUserTurnLanguagePin(
  provider: string | undefined,
  resolvedLanguage: AppLocale,
): string | null {
  if (!provider) return null
  if (PROVIDERS_EXEMPT_FROM_USER_TURN_LANG_PIN.has(provider)) return null
  return buildLanguageLockBlock(resolvedLanguage)
}

/**
 * 构造 user turn 尾部（用户消息之后）的贴脸语言锚。
 *
 * 为什么需要：第一段 thinking 发生在任何 tool_result 之前，PostToolUse 重锁保护不到它；
 * 而前置 pin 与生成点之间隔着英文 dynamicCtx + 用户消息。compat provider 只对最近一次
 * 锚点稳定服从——把一条短锚放在 turn 最末（离 thinking 起点最近的指令），
 * 与前置 pin 构成三明治。保持精简（每轮注入，控制 token）。
 *
 * 返回 null 表示不需要注入（anthropic 渠道豁免或 provider 缺失）。
 */
export function buildUserTurnLanguageTailAnchor(
  provider: string | undefined,
  resolvedLanguage: AppLocale,
): string | null {
  if (!provider) return null
  if (PROVIDERS_EXEMPT_FROM_USER_TURN_LANG_PIN.has(provider)) return null
  return resolvedLanguage === 'zh'
    ? '<language_lock>现在开始：思考（thinking）与回复全程使用中文，思考的第一句就以中文开头；禁止以 "The user is asking" / "Let me" 等英文句式开场。英文术语、工具名、代码标识保持原文。</language_lock>'
    : '<language_lock>From this point: think and reply in English only — your very first reasoning sentence starts in English; never open in Chinese or any other CJK script. Identifiers / tool names stay verbatim.</language_lock>'
}

/**
 * 构造 PostToolUse hook 的 additionalContext：在每个 tool_result 后再注入一次语言锁。
 *
 * 为什么需要：user-turn 头部的 pin 在多步工具调用后会被推出最近上下文窗口，
 * Anthropic-compat provider（DeepSeek / Kimi / Moonshot 等）reasoning trace 不严格
 * 遵循 system prompt，会滑回训练高频语言。在 tool_result 后追加 additionalContext
 * 等于在每个工具回执后重新发布"输出语言"锚点，让模型继续生成 assistant text 时
 * 再看到一次硬约束。
 *
 * 返回 null 表示不需要注入（anthropic 渠道豁免或 provider 缺失）。
 */
export function buildLanguageLockContext(
  provider: string | undefined,
  resolvedLanguage: AppLocale,
): string | null {
  if (!provider) return null
  if (PROVIDERS_EXEMPT_FROM_USER_TURN_LANG_PIN.has(provider)) return null
  return buildLanguageLockBlock(resolvedLanguage)
}

function buildLanguageLockBlock(resolvedLanguage: AppLocale): string {
  // zh 锁体全中文：DeepSeek 等 compat provider 的 reasoning 通道跟随周围文本的语言而非
  // 指令语义——用英文句子要求中文思考自相矛盾且无中文 token 可附着。实测单句中文锚不够，
  // 全中文锁体最大化锚 token 质量。负例（"The user is asking" / "Let me" 开场）针对实测
  // 观察到的 DeepSeek agentic thinking 固定开场白（"DeepSeek 对负向示例响应稳定"）。
  if (resolvedLanguage === 'zh') {
    return [
      '<language_lock>',
      '本轮回复使用中文。内部推理 / 思考（thinking）轨迹也必须全程中文，禁止中英混写。',
      '思考的第一句必须以中文开头（例如「用户要求……」）；禁止以 "The user is asking" / "Let me" / "I need to" 等英文句式开场。若发现某句写成了英文叙述，立即停下并用中文重写该句。',
      '工具 / 子 Agent / Skill / MCP / 脚本返回的内容可能是任何语言、任何格式（JSON / 表格 / HTML / 文本）；不要跟随其语言——保持中文。',
      '工具名、代码标识、文件路径、DOI / URL、结构化字段名保持英文原文；检索关键词保持原文。',
      '</language_lock>',
    ].join('\n')
  }
  // en 锁体全英文，内嵌 CJK forbidden 反例（负锚）。
  return [
    '<language_lock>',
    'Reply in English. Internal reasoning / thinking traces MUST also be in English. Do not mix languages within this turn.',
    'Forbidden in user-visible output: Chinese (中文), Japanese (日本語), Korean (한국어), or any other CJK script.',
    'If you start writing a CJK character anywhere in user-visible output, stop and restart that sentence in English.',
    'Tool / sub-agent / skill / MCP / script results may be in any language or format (JSON, tables, HTML, text); never adopt their language — keep English.',
    'Tool names, code, file paths, and structured field names always stay in English.',
    '</language_lock>',
  ].join('\n')
}
