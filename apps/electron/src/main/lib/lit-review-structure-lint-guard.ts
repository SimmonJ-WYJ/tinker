/**
 * lit-review 综述引用结构确定性校验闸（spec：lit-review-finalize-fast-path P0）
 *
 * 背景：terminal_skill `literature-review-result` 写出 `reviews/*.html` 时，模型仍会偶发产出两类
 *   被渲染器拒绝的引用结构违规（SKILL.md 已 prompt 禁止，但纯 prompt 不保证）：
 *     ① 裸 `[N]` markdown 引用残留（正文散文里，非 `<q>` 引文内、非 §7 参考文献）；
 *     ② `<cite data-ref="N">` 缺 `<q>` 子元素（叙述式 cite / 空 cite）。
 *   真实 trace 实测：主 Agent 事后肉眼扫全文 + ~20 次手工 Edit 返修，是收尾段最大单点耗时。
 *
 * 本 guard 提供**确定性安全网**：PostToolUse 在 Write 到 `reviews/*.html` 时对写入内容跑纯正则校验，
 *   命中违规 → `decision: 'block'` + reason **逐条列出行号/类型/片段/修法**，把主 Agent 的工作从
 *   「扫 300 行找问题」降为「按这份清单定点改」。校验是确定性的：零 LLM token、零误判。
 *
 * 与 `lit-review-factcheck-guard`（#517）同构：同 hook 形态、同防循环思路（block 次数封顶）。
 *   区别在触发器与时机——本 guard 在 Write 时（早于 Stop）校验产物结构，pack-scoped 无需 resolver。
 *
 * 注：不做静默 fs 改写（隐式副作用 + 相对路径解析风险），只回 block 清单交主 Agent 定点修；
 *   `[N]` 的自动剥离作为后续增强（spec §3.2 备注），本版先以「精确清单」消除最贵的「发现」成本。
 */

/**
 * lit-review 终产物 HTML 的路径特征（cwd 下 `reviews/<name>.html`，绝对或相对均可命中尾段）。
 * 分隔符兼容 `/` 与 `\`——Windows 上 Write 的 file_path 可能是反斜杠，否则会漏过校验。
 */
const REVIEW_HTML_PATH_RE = /(?:^|[\\/])reviews[\\/][^\\/]+\.html$/

/** 同一次 query 内最多 block 次数，超过则放行避免病态循环（模型反复写坏） */
const MAX_BLOCKS = 3

/** reason / snippet 里最多列出的违规条数，避免注入文案过长 */
const MAX_LISTED = 40

/** 一处引用结构违规 */
export interface ReviewStructureViolation {
  /** 违规类型：裸 `[N]` 残留 / `<cite>` 缺 `<q>` */
  type: 'bare-bracket-ref' | 'cite-missing-quote'
  /** 1-based 行号（在写入的 HTML 文本里） */
  line: number
  /** 违规处的小片段（已裁剪/收窄空白，便于主 Agent 定位） */
  snippet: string
}

interface HookCallbackInput {
  hook_event_name: 'PostToolUse' | 'Stop'
  tool_name?: string
  tool_input?: unknown
}

interface HookEntry {
  matcher: string
  hooks: ((input: HookCallbackInput) => unknown)[]
}

export interface LitReviewStructureLintGuardHooks {
  PostToolUse: HookEntry[]
}

/** 测试 / 监控用：读当前闭包状态快照 */
export interface LitReviewStructureLintGuardState {
  /** 已 block 次数（防循环计数） */
  blockCount: number
}

/** 把 `<q>…</q>` 与 §7 `<ol class="refs">…</ol>` 区间替换为等长空格（保留换行 → 偏移/行号不变） */
function maskExcludedRegions(html: string): string {
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ')
  return html
    .replace(/<q\b[^>]*>[\s\S]*?<\/q>/gi, blank)
    .replace(/<ol\b[^>]*class="[^"]*\brefs\b[^"]*"[^>]*>[\s\S]*?<\/ol>/gi, blank)
}

/** 由字符偏移算 1-based 行号 */
function lineAt(html: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < html.length; i++) {
    if (html[i] === '\n') line++
  }
  return line
}

/** 取偏移附近的小片段，收窄空白并截断 */
function snippetAt(html: string, offset: number, length: number): string {
  const start = Math.max(0, offset - 24)
  const end = Math.min(html.length, offset + length + 24)
  return html.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 120)
}

/**
 * 纯函数：校验综述 HTML 片段的引用结构，返回违规清单（无副作用、可单测）。
 *
 * - bare-bracket-ref：正文里的裸 `[N]` / `[1, 3]`（在 `<q>` 引文区间与 §7 refs 区间内的不计——
 *   那是论文原文或参考文献结构）。
 * - cite-missing-quote：`<cite data-ref="N">…</cite>` 内不含 `<q>` 子元素。
 */
export function lintReviewHtmlStructure(html: string): ReviewStructureViolation[] {
  const violations: ReviewStructureViolation[] = []

  // ① 裸 [N] —— 在屏蔽掉 <q> 与 §7 refs 的文本上扫，偏移与原文 1:1 对齐
  const masked = maskExcludedRegions(html)
  const bracketRe = /\[\d+(?:\s*,\s*\d+)*\]/g
  for (let m = bracketRe.exec(masked); m !== null; m = bracketRe.exec(masked)) {
    violations.push({
      type: 'bare-bracket-ref',
      line: lineAt(html, m.index),
      snippet: snippetAt(html, m.index, m[0].length),
    })
  }

  // ② <cite> 缺 <q> —— 直接在原文上扫（cite 不嵌套）
  const citeRe = /<cite\b[^>]*>([\s\S]*?)<\/cite>/gi
  for (let m = citeRe.exec(html); m !== null; m = citeRe.exec(html)) {
    const inner = m[1] ?? ''
    if (!/<q\b/i.test(inner)) {
      violations.push({
        type: 'cite-missing-quote',
        line: lineAt(html, m.index),
        snippet: snippetAt(html, m.index, m[0].length),
      })
    }
  }

  // 按行号排序，便于主 Agent 自上而下定点修
  violations.sort((a, b) => a.line - b.line)
  return violations
}

/** 构造 block reason（英文——服务回写 Agent 的通知文案，CLAUDE.md §2） */
function buildReason(filePath: string, violations: ReviewStructureViolation[]): string {
  const shown = violations.slice(0, MAX_LISTED)
  const lines = shown.map((v) => {
    if (v.type === 'bare-bracket-ref') {
      return `- line ${v.line}: bare [N] markdown citation near "${v.snippet}" — delete the bracket; the reference is carried by the adjacent <cite data-ref><q> quote. Never use [N] in body prose.`
    }
    return `- line ${v.line}: <cite> without a <q> child near "${v.snippet}" — either wrap a verbatim source quote in <q>, or (if this is narrative) drop the <cite> wrapper and keep plain text.`
  })
  const more =
    violations.length > shown.length ? `\n…and ${violations.length - shown.length} more (same two types).` : ''
  return [
    `Structure lint (deterministic) on ${filePath}: the review you wrote has ${violations.length} citation-format violation(s) the renderer rejects. Fix each, then re-write the file:`,
    ...lines,
    more,
    `Both forms are forbidden by SKILL.md's citation rules — apply the list above directly (no need to re-scan the whole document).`,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * 为指定 agent session 创建 lit-review 综述引用结构校验闸。
 *
 * @param sessionId 当前 agent session ID（仅用于日志可定位性）
 * @param logger 测试钩子：默认 console.warn
 */
export function createLitReviewStructureLintGuard(
  sessionId: string,
  logger: (msg: string) => void = (m) => console.warn(m),
): LitReviewStructureLintGuardHooks & { readState: () => LitReviewStructureLintGuardState } {
  const state: LitReviewStructureLintGuardState = { blockCount: 0 }

  const onWritePost = (input: HookCallbackInput): unknown => {
    if (input.hook_event_name !== 'PostToolUse') return {}
    if (input.tool_name !== 'Write') return {}
    const ti = input.tool_input as { file_path?: unknown; content?: unknown } | undefined
    const filePath = ti?.file_path
    const content = ti?.content
    if (typeof filePath !== 'string' || !REVIEW_HTML_PATH_RE.test(filePath)) return {}
    if (typeof content !== 'string') return {}

    const violations = lintReviewHtmlStructure(content)
    if (violations.length === 0) return {}

    if (state.blockCount >= MAX_BLOCKS) {
      logger(
        `[lit-review-structure-lint-guard session=${sessionId}] 已 block ${MAX_BLOCKS} 次仍有 ${violations.length} 处违规 → 放行避免循环`,
      )
      return {}
    }

    state.blockCount++
    logger(
      `[lit-review-structure-lint-guard session=${sessionId}] 第 ${state.blockCount} 次：${filePath} 检出 ${violations.length} 处引用结构违规 → block`,
    )
    return { decision: 'block' as const, reason: buildReason(filePath, violations) }
  }

  return {
    PostToolUse: [{ matcher: 'Write', hooks: [onWritePost] }],
    readState: () => ({ ...state }),
  }
}
