/**
 * 多片合并后的整理工具（纯函数，无 Electron / IO 依赖）
 *
 * worker.ts 把 N 片 LLM 输出拼成一份完整 markdown 后，本文件的两个函数做最终清理：
 *
 * 1. {@link dedupSectionNumbers}
 *    续片场景下 LLM 经常重启章节编号（chunk 2 写 `# 1. Results` 而不是 `# 3. Results`），
 *    导致 renumberPTags 生成的 `<p id="p1_x">` 与 chunk 1 的 Intro 段 id 冲突，
 *    skill `papers_read_article_section({ sectionIndex: 1 })` 拿不到真正第 1 章。
 *    本函数扫描所有 `# N. <title>` 一级标题，遇到 N ≤ runningMax 时改写成 runningMax+1，
 *    保证编号严格递增、绝不重复。
 *
 * 2. {@link rebuildOutline}
 *    首片 prompt 生成的 `# OUTLINE` 只能看到首片含的章节；后续片被禁止重发 OUTLINE。
 *    多片场景下 OUTLINE 会缺续片的章节，直接拖垮 outline-first 链路
 *    （papers_read_outline 返回的 outlineItems 不完整，skill 漏读章节）。
 *    本函数从 `# CONTENT` 之后扫所有 `# N. <title>`，用扫描结果重建 OUTLINE 块覆盖原版。
 *
 * 调用顺序：先 dedupSectionNumbers（保证编号唯一）→ 再 rebuildOutline（用唯一编号生成
 * OUTLINE）→ 最后 renumberPTags（基于稳定的编号给 <p> 标签分配 id）。
 */

/**
 * 章节标题一级 heading 正则：匹配 `# N. Title` / `# N、Title` / `# N Title` 三种风格。
 *
 * 风格枚举：
 *   - `# 1. Introduction`（标准英文，带句点 + 空格）
 *   - `# 1、引言`（中文顿号，可不带空格）
 *   - `# 1 Introduction`（**仅空格无标点**，pdf-parse 经常这样抽出原文，LLM 顺手照搬）
 *
 * 三选一用 `(?:[.、]\s*|\s+)`：`[.、]` 后空格可选，或者**至少**一个空格（无标点）。
 *
 * 反例（不匹配）：
 *   - `# CONTENT` / `# OUTLINE` — 没有前导数字
 *   - `# 10` — 后面没有标题文本
 *   - `# 1.` — 句点后没有内容
 *   - `## 1.1 Subsec` — 二级标题（两个 `#`）不参与
 *
 * 历史教训：上一版只接 `[.、]` 必须存在，导致 GPT-3 论文 `# 1 Introduction` 等 10 个主章节
 * 整段被漏过，rebuildOutline 只识别到 3 个附录章节，OUTLINE 严重残缺。
 */
const SECTION_HEADING_RE = /^# (\d+)(?:[.、]\s*|\s+)(.+)$/gm

/**
 * 单行版本（无 g 标记），供 worker.ts renumberPTags 等"逐行扫"的场景复用。
 *
 * 与 {@link SECTION_HEADING_RE} 同义；统一定义避免两处规则漂移。
 */
export const SECTION_HEADING_LINE_RE = /^# (\d+)(?:[.、]\s*|\s+)(.+)$/

/**
 * OUTLINE 块定位：第一处 `# OUTLINE` 单行（同 worker.ts 既有 OUTLINE 剥离 regex）。
 *
 * 不带 `g` 标记，只匹配第一处；用于 rebuildOutline 替换。
 */
const OUTLINE_HEADER_RE = /^# OUTLINE\b[^\n]*\n/m

/**
 * CONTENT 块定位：第一处 `# CONTENT` 单行。
 */
const CONTENT_HEADER_RE = /^# CONTENT\b[^\n]*\n/m

/**
 * 章节去重的返回值。
 *
 * `renumberMap` 记录 oldN → newN 的映射，便于上层日志或后续 OUTLINE 列表对照调整。
 * 没有任何冲突时 renumberMap 为空。
 */
export interface DedupResult {
  body: string
  renumberMap: Map<number, number>
}

/**
 * 扫描 body 里的一级章节 heading，遇到重复或回退的编号自动改写为 runningMax+1。
 *
 * 规则（严格递增）：
 *   - 维护 runningMax = 至今为止见过的最大编号；初始 0
 *   - 对每个 `# N. <title>`：
 *     · 若 N > runningMax：合法，保留 N，runningMax = N
 *     · 若 N ≤ runningMax：冲突，改写为 runningMax + 1，runningMax = runningMax + 1
 *
 * 例子（chunk 2 重启编号）：
 *   input:  `# 1. Intro` / `# 2. Method` / `# 1. Results` / `# 2. Discussion`
 *   output: `# 1. Intro` / `# 2. Method` / `# 3. Results` / `# 4. Discussion`
 *
 * 跳号场景不动（保留 LLM/作者意图）：
 *   input:  `# 1. Intro` / `# 3. Results`
 *   output: 同上（runningMax=1 < 3，3 合法）
 *
 * 仅修改一级 heading 行；段落里的 <p> 标签不动（worker.ts 的 renumberPTags 后续会基于
 * 这里的去重后编号重新分配 p<S>_<P> id）。
 */
export function dedupSectionNumbers(body: string): DedupResult {
  let runningMax = 0
  const renumberMap = new Map<number, number>()

  const result = body.replace(SECTION_HEADING_RE, (_match, nStr: string, rest: string) => {
    const oldN = parseInt(nStr, 10)
    if (!Number.isFinite(oldN)) return _match
    let newN = oldN
    if (oldN <= runningMax) {
      newN = runningMax + 1
    }
    runningMax = Math.max(runningMax, newN)
    if (newN !== oldN) {
      // 同一个 oldN 可能在多片里出现多次（chunk 2 emit # 1，chunk 3 也 emit # 1）。
      // Map 里只记第一次的映射就够：后续重复都会被改成更大的值，调试日志
      // 体现这次重映射即可。
      if (!renumberMap.has(oldN)) renumberMap.set(oldN, newN)
    }
    // 用模板字符串重建标题行；尝试保留原标题中数字与标题之间的标点风格。
    // SECTION_HEADING_RE 第 1 捕获组是纯数字，所以这里默认补 `. ` 即可。
    return `# ${newN}. ${rest}`
  })

  return { body: result, renumberMap }
}

/**
 * 从 body 里扫所有 `# N. <title>` 一级标题，重建 OUTLINE 块覆盖原版。
 *
 * 设计动机：多片场景下首片生成的 OUTLINE 只覆盖首片的章节，续片 OUTLINE 被 prompt
 * 明确禁止。本函数从 CONTENT 之后扫真实出现的章节，用它们覆盖原 OUTLINE，确保
 * papers_read_outline 返回的列表与 article.md 实际章节一一对应。
 *
 * 行为：
 *   - 必须同时存在 `^# OUTLINE` 与 `^# CONTENT`（说明 LLM 至少给了基础骨架），
 *     否则原样返回（保守，不强行注入结构）
 *   - 必须 CONTENT 之后至少扫到 1 个 `# N. <title>` heading（说明真有章节），
 *     否则原样返回
 *   - 重建后的 OUTLINE 紧跟 `# OUTLINE\n\n- 1. Intro\n- 2. Method\n...\n\n`
 *   - CONTENT 及之后不动
 *
 * 建议调用顺序：先 dedupSectionNumbers 保证编号唯一，再调本函数（避免 OUTLINE 列出
 * 重复编号）。
 */
export function rebuildOutline(body: string): string {
  const outlineMatch = OUTLINE_HEADER_RE.exec(body)
  if (!outlineMatch) return body

  const contentMatch = CONTENT_HEADER_RE.exec(body)
  if (!contentMatch) return body

  // 从 CONTENT 行开头之后扫所有 # N. <title>
  const contentRegion = body.slice(contentMatch.index)
  const items: string[] = []
  const headingRe = new RegExp(SECTION_HEADING_RE.source, 'gm')  // 重新构造以独立 lastIndex
  let m: RegExpExecArray | null
  while ((m = headingRe.exec(contentRegion)) !== null) {
    const n = m[1]
    const title = m[2]?.trim() ?? ''
    if (n && title) items.push(`- ${n}. ${title}`)
  }

  if (items.length === 0) return body

  // 拼接：[OUTLINE 之前的内容] + 新 OUTLINE 块 + [CONTENT 及之后]
  const before = body.slice(0, outlineMatch.index)
  const newOutlineBlock = `# OUTLINE\n\n${items.join('\n')}\n\n`
  const fromContent = body.slice(contentMatch.index)
  return before + newOutlineBlock + fromContent
}
