/**
 * 遥测脱敏纯函数（issue #416 T4/T4a / ADR-011）
 *
 * 所有出口前的文本（Sentry beforeSend 的堆栈与消息、自进化 error_event
 * 的 message、PostHog 属性兜底）都必须过这里。规则：
 *   1. 本地路径用户名段 → 占位符：/Users/<USER>/、/home/<USER>/、C:\Users\<USER>\
 *   2. 邮箱 → <EMAIL>
 *   3. IPv4 / IPv6 → <IP>
 *
 * 纯函数、零 Electron 依赖，可独立单测；顺序敏感——先脱路径再脱邮箱/IP，
 * 避免邮箱正则吃掉路径中含 @ 的片段后破坏路径形态。
 */

/** Unix 家目录用户名段：/Users/<name>/ 与 /home/<name>/（含行尾无斜杠场景） */
const UNIX_HOME_RE = /(\/(?:Users|home)\/)([^/\\\s:'"]+)/g

/** Windows 家目录用户名段：C:\Users\<name>\ 与正斜杠变体 C:/Users/<name>/ */
const WIN_HOME_BACKSLASH_RE = /([A-Za-z]:\\Users\\)([^\\\s:'"]+)/gi
const WIN_HOME_SLASH_RE = /([A-Za-z]:\/Users\/)([^/\s:'"]+)/gi

/** 邮箱 */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

/** IPv4（含 4 段数字形态；版本号误伤可接受——脱敏宁可错杀） */
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g

/**
 * IPv6：完整形态（≥4 组十六进制段，避免误伤 "12:30:45" 这类时间戳）
 * + 压缩形态（含 ::，两侧至少一组）
 */
const IPV6_FULL_RE = /\b(?:[A-Fa-f0-9]{1,4}:){4,7}[A-Fa-f0-9]{1,4}\b/g
const IPV6_COMPRESSED_RE = /\b[A-Fa-f0-9]{1,4}(?::[A-Fa-f0-9]{1,4})*::(?:[A-Fa-f0-9]{1,4}(?::[A-Fa-f0-9]{1,4})*)?\b/g

/** 文本脱敏：路径用户名段 → 邮箱 → IP，幂等（占位符不会被二次替换） */
export function redactText(text: string): string {
  return text
    .replace(UNIX_HOME_RE, '$1<USER>')
    .replace(WIN_HOME_BACKSLASH_RE, '$1<USER>')
    .replace(WIN_HOME_SLASH_RE, '$1<USER>')
    .replace(EMAIL_RE, '<EMAIL>')
    .replace(IPV6_FULL_RE, '<IP>')
    .replace(IPV6_COMPRESSED_RE, '<IP>')
    .replace(IPV4_RE, '<IP>')
}

/**
 * 深度脱敏：递归遍历对象/数组，对所有 string 叶子执行 redactText。
 * 用于 Sentry beforeSend（event 是嵌套对象）与遥测属性兜底。
 * 循环引用安全（seen 去重，重复引用返回 '<CIRCULAR>' 防御）。
 */
export function redactDeep<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value === 'string') {
    return redactText(value) as unknown as T
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (seen.has(value as object)) {
    return '<CIRCULAR>' as unknown as T
  }
  seen.add(value as object)
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, seen)) as unknown as T
  }
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = redactDeep(val, seen)
  }
  return out as T
}

/** error_event message 的长度兜底（schema max 512，预留余量截断到 480） */
export function redactErrorMessage(message: string): string {
  const redacted = redactText(message)
  return redacted.length > 480 ? `${redacted.slice(0, 480)}…` : redacted
}

/**
 * Sentry event/breadcrumb 统一脱敏（issue #416 T-1）：
 * 深度 redact 全部字符串 + 双保险清掉 SDK 可能填充的 user/request 字段。
 * main（sentry-init.ts）与 renderer（lib/sentry.ts）的 beforeSend 共用——
 * renderer 转发的 envelope 不再过主进程 beforeSend，两侧策略必须同源。
 */
export function scrubSentryEvent<T extends { user?: unknown; request?: unknown }>(event: T): T {
  // #710 P0-7：用凭证感知的 redactDeepWithMatches（覆盖 token/cookie/Authorization/env/prompt 形态），
  // 不止 PII。main 与 renderer beforeSend 共用本函数，两侧同源升级。
  const redacted = redactDeepWithMatches(event).value
  delete redacted.user
  delete redacted.request
  return redacted
}

// ==================== #710 安全边界：披露分级脱敏原语 ====================
// 在**不改动**上方 redactText/redactDeep/redactErrorMessage/scrubSentryEvent（被 Sentry beforeSend
// 同步直调，签名与行为冻结、零回归）的前提下，新增带分类与 redactionMatches 的变体 + 占位符 formatter，
// 供 P0-1/2/3/5/7 各出口复用。仍是同步纯函数、零运行时依赖、**不引 node:crypto**（hash 由 main
// disclosure-fingerprint 生成后传入 formatter）。详见 docs/specs/0.4.0/prompt-disclosure-redaction-spec.md §8。

/** 脱敏类别（spec §8.2）。 */
export type RedactionCategory =
  | 'credential' | 'env-value' | 'prompt-body' | 'tool-payload'
  | 'query' | 'home-path' | 'file-content' | 'pii' | 'thinking' | 'unknown'

/** 单条脱敏命中（spec §8.2）：仅结构信息（路径/类别/规则名），**绝不含被脱敏的原文**。 */
export interface RedactionMatch {
  path: string
  category: RedactionCategory
  action: 'replace' | 'mark' | 'drop'
  ruleName: string
}

/** 同步脱敏原语返回（spec §8.2）。 */
export interface RedactionPrimitiveResult<T> {
  value: T
  redactionMatches: RedactionMatch[]
}

/** 固定占位符（spec §8.3）：脱敏可见、不静默删除。带 hash 的 tool-payload/query/file-content 走 formatRedactionPlaceholder。 */
export const REDACTION_PLACEHOLDER: Record<
  Exclude<RedactionCategory, 'tool-payload' | 'query' | 'file-content'>,
  string
> = {
  credential: '[[REDACTED:credential]]',
  'env-value': '[[REDACTED:credential]]', // env value 与凭证同口径（spec §8.3/§11）
  'prompt-body': '[[REDACTED:prompt-body]]', // 一般由 formatPromptPlaceholder 带 hash 替换
  'home-path': '[[REDACTED:path]]',
  pii: '[[REDACTED:pii]]',
  thinking: '[[REDACTED:thinking]]',
  unknown: '[REDACTED]',
}

/** prompt body 占位符（spec §8.3）：[[PROMPT:sha256:<first16>@<version>]]。hash 由 main 算后传入，shared 不算 hash。 */
export function formatPromptPlaceholder(input: { promptId: string; version: string; hash: string }): string {
  return `[[PROMPT:sha256:${input.hash.slice(0, 16)}@${input.version}]]`
}

/** 带 hash 的占位符（tool-payload/query/file-content；hash 由 main 生成传入）。 */
export function formatRedactionPlaceholder(
  category: 'tool-payload' | 'query' | 'file-content',
  hash?: string,
): string {
  return hash ? `[[REDACTED:${category}:${hash}]]` : `[[REDACTED:${category}]]`
}

// 凭证「值形态」检测（保守、低误伤；与 trace/trace-redactor.ts 同源，此处自持避免跨包/实验文件耦合）。
const CREDENTIAL_VALUE_RULES: ReadonlyArray<{ re: RegExp; ruleName: string }> = [
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, ruleName: 'jwt' },
  { re: /\bsk-[A-Za-z0-9._-]{16,}\b/g, ruleName: 'sk-key' },
  { re: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, ruleName: 'bearer' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, ruleName: 'aws-akid' },
  { re: /\b(?=[0-9a-fA-F]*[a-fA-F])(?=[0-9a-fA-F]*[0-9])[0-9a-fA-F]{48,}\b/g, ruleName: 'long-hex' },
  { re: /\b(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[0-9])[A-Za-z0-9+/]{64,}={0,2}\b/g, ruleName: 'long-base64' },
]
/**
 * 敏感键名「整词/分段」判定（命中则该键的字符串值整体脱敏为 credential）。
 *
 * 历史教训（totalTokens 误伤）：旧实现用子串正则 `/token|secret|.../i`，`totalTokens`
 * 含子串 `token` 被误判为凭证键 → 数值被替换成字符串占位符 → PostHog 类型 MISMATCH。
 * 现改为把键名按 camelCase / snake_case / kebab-case **拆段**后逐段比对，只在「整段」
 * 命中时脱敏：`accessToken`/`access_token` 仍命中（段 `token`），`totalTokens` 不再命中（段 `tokens`）。
 */
/** 单段即敏感的词（与旧正则等价口径，仅去掉子串误伤）。 */
const SENSITIVE_KEY_SEGMENTS: ReadonlySet<string> = new Set([
  'secret', 'password', 'passwd', 'token', 'cookie', 'authorization', 'bearer',
])
/** 相邻两段构成的复合敏感键（api_key / auth_token / access_key 的分隔形态）。 */
const SENSITIVE_KEY_PHRASES: ReadonlySet<string> = new Set([
  'api key', 'auth token', 'access key',
])
/** 无分隔符合写形态（apikey / authtoken / accesskey）。 */
const SENSITIVE_KEY_JOINED = /^(apikey|authtoken|accesskey)$/

/** 把键名拆成小写段：camelCase 边界 + `_`/`-`/空白分隔。 */
function splitKeySegments(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((s) => s.toLowerCase())
}

/** 键名是否敏感：任一段命中敏感词，或相邻两段/合写形态命中复合敏感键。 */
function isSensitiveKey(key: string): boolean {
  const segs = splitKeySegments(key)
  if (segs.some((s) => SENSITIVE_KEY_SEGMENTS.has(s))) return true
  for (let i = 0; i < segs.length - 1; i++) {
    if (SENSITIVE_KEY_PHRASES.has(`${segs[i]} ${segs[i + 1]}`)) return true
  }
  return SENSITIVE_KEY_JOINED.test(segs.join(''))
}

/** env 键名（ANTHROPIC_* 等本地凭证 env 前缀）。 */
const ENV_KEY_RE = /^(ANTHROPIC_|AWS_|GCP_|GOOGLE_|OPENAI_|AZURE_|DEEPSEEK_|OPENROUTER_)/i

/**
 * 文本脱敏 + 命中记录：在 redactText（路径用户名段/邮箱/IP，口径不变）基础上**前置**凭证值形态脱敏。
 * 对既有 redactText 测试串（不含凭证形态）输出一致 → 零回归；凭证形态额外替换为 [[REDACTED:credential]]。
 * 注意：仍只收路径**用户名段**（与 redactText 同），整路径 → [[REDACTED:path]] 由各出口 formatter 按需决定。
 */
export function redactTextWithMatches(text: string, path = ''): RedactionPrimitiveResult<string> {
  const matches: RedactionMatch[] = []
  let value = text
  for (const { re, ruleName } of CREDENTIAL_VALUE_RULES) {
    // 每次 new 局部正则，避免共享全局正则的 lastIndex 副作用
    value = value.replace(new RegExp(re.source, re.flags), () => {
      matches.push({ path, category: 'credential', action: 'replace', ruleName })
      return REDACTION_PLACEHOLDER.credential
    })
  }
  const beforePath = value
  value = value
    .replace(UNIX_HOME_RE, '$1<USER>')
    .replace(WIN_HOME_BACKSLASH_RE, '$1<USER>')
    .replace(WIN_HOME_SLASH_RE, '$1<USER>')
  if (value !== beforePath) matches.push({ path, category: 'home-path', action: 'replace', ruleName: 'home-username' })
  const beforeEmail = value
  value = value.replace(EMAIL_RE, '<EMAIL>')
  if (value !== beforeEmail) matches.push({ path, category: 'pii', action: 'replace', ruleName: 'email' })
  value = value.replace(IPV6_FULL_RE, '<IP>').replace(IPV6_COMPRESSED_RE, '<IP>').replace(IPV4_RE, '<IP>')
  return { value, redactionMatches: matches }
}

/**
 * 深度脱敏 + 命中记录：键名命中敏感/env → 整值脱敏为 credential/env-value；字符串叶子走 redactTextWithMatches。
 * 镜像 redactDeep 的循环引用防御；path 用点号路径（如 'frames.0.file'）。
 */
export function redactDeepWithMatches<T>(value: T, path = '', seen = new WeakSet<object>()): RedactionPrimitiveResult<T> {
  const matches: RedactionMatch[] = []
  const walk = (v: unknown, p: string): unknown => {
    if (typeof v === 'string') {
      const r = redactTextWithMatches(v, p)
      for (const m of r.redactionMatches) matches.push(m)
      return r.value
    }
    if (v === null || typeof v !== 'object') return v
    if (seen.has(v as object)) return '<CIRCULAR>'
    seen.add(v as object)
    if (Array.isArray(v)) return v.map((item, i) => walk(item, p ? `${p}.${i}` : String(i)))
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const childPath = p ? `${p}.${k}` : k
      // 仅对**字符串值**做键名脱敏：数值/布尔不可能是凭证，避免误伤 totalTokens 这类数值指标
      // （否则数字被替换成占位符字符串 → PostHog 属性类型 NUMBER→STRING 不一致）。
      if ((isSensitiveKey(k) || ENV_KEY_RE.test(k)) && typeof val === 'string') {
        const category: RedactionCategory = ENV_KEY_RE.test(k) ? 'env-value' : 'credential'
        matches.push({ path: childPath, category, action: 'replace', ruleName: `sensitive-key:${k}` })
        out[k] = REDACTION_PLACEHOLDER.credential
      } else {
        out[k] = walk(val, childPath)
      }
    }
    return out
  }
  return { value: walk(value, path) as T, redactionMatches: matches }
}
