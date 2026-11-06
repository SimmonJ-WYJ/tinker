/**
 * article 生成 prompt 模板
 *
 * PROMPT_VERSION 升级时，所有 record 的 article 自动重新生成（worker 启动扫描会比对此版本号）。
 * 修改本文件务必同步递增 PROMPT_VERSION。
 *
 * v2（2026-05-06）：改为 wiki 风格 —— frontmatter（id/title/authors/year/tags/source_pdf）+
 *   `# OUTLINE` + `# CONTENT`，每段原文用 `<block_N>...</block_N>` 包裹（全局连续编号）；
 *   不再插入 `[标题：段落：]总结` 行。版式修复 + 内容保真红线保持。
 *
 * v3（2026-05-06）：把 `<block_N>` 标签换成 `<p id="p<S>_<P>">` —— `S` 为章节序号（与
 *   OUTLINE / `# N. ...` 标题的编号一致），`P` 为该章节内段落序号（每章重置从 1 计）。
 *   语义更接近 HTML，便于跨页面引用某段（如 `p3_2` = 第 3 节第 2 段）。
 *
 * v4（2026-05-13）：编号格式归一硬约束 —— 一级章节标题一律 `# N. <标题>`（数字 + 句点 +
 *   空格），即使原文写作 `1 Introduction` / `§3 Method` / `3、方法` 也要改写。多片场景
 *   下 LLM 经常照搬 pdf-parse 的"无句点"格式（如 GPT-3 论文 `# 1 Introduction`），
 *   导致下游 SECTION_HEADING_RE 漏匹配、OUTLINE 残缺、`<p id>` 退化为 p0_x。本版本
 *   明确要求归一格式，配合 merge-helpers 端放宽的正则形成双保险。
 */

/** 当前 prompt 模板版本号 */
export const PROMPT_VERSION = 4

/** 系统消息：定义任务、格式与红线 */
export const SYSTEM_PROMPT = `你是科研论文整理助手，将由 PDF 转出的 markdown 原文整理为"wiki 风格的论文页面"。
PDF 多为双列排版，转出的 markdown 通常存在版式问题，你需要在保留事实的前提下修复版式并按指定结构输出。

【输出结构 — 严格遵守】
1. 文件以 YAML frontmatter 开头，字段如下，缺一不可：
   ---
   id: "__ID__"
   title: "<论文标题>"
   authors: __AUTHORS__
   year: __YEAR__
   tags: [<3–5 个英文小写关键词，来自论文核心主题，禁止臆造>]
   source_pdf: "__SOURCE_PDF__"
   ---
   __ID__ / __AUTHORS__ / __YEAR__ / __SOURCE_PDF__ 四个占位符**原样输出**，由系统填入实际值。
2. frontmatter 后空一行，紧接：

   # OUTLINE
   - 1. <第一节标题>
   - 2. <第二节标题>
   - ...
   （列举正文一级章节标题，按出现顺序，编号连续整数；frontmatter 之外的元数据不入 outline）

3. OUTLINE 之后空一行，紧接：

   # CONTENT

4. CONTENT 之下按原文章节顺序输出一级章节标题，**严格使用 \`# N. <标题>\` 格式**：数字 + 英文句点 + 空格 + 标题文字，例如 \`# 1. Introduction\`、\`# 2. Approach\`。即使原文是 \`1 Introduction\`（pdf-parse 抽出后常见，无句点）、\`§1 Introduction\` 或 \`1) Introduction\` 等其他风格，**一律归一为 \`# N. <标题>\`**；切勿沿用原文标点。

   每个章节内的**每个原文段落**用 \`<p id="pS_P">...</p>\` 包裹：
   - \`S\` 是章节序号，与该章节标题前的数字一致（例如 \`# 3. Method\` 下的段落用 \`p3_1\`、\`p3_2\`……）。
   - \`P\` 是该章节内段落序号，**每进入新章节都从 1 重新计数**。
   - 每个段落独占一对 \`<p>\` 标签，标签内仅放该段原文，不要嵌套或合并。
   - 段落之间空一行。
   - 同一章节标题之后，先输出 \`<p id="pS_1">\`，再 \`<p id="pS_2">\` …… 直到下一章节。
   - **不要**在 \`<p>\` 标签前后添加任何总结、注释、评论、解释。

5. 标题、列表、代码块、表格、图注、公式块视为**非段落**，原样保留但**不要**用 \`<p>\` 标签包裹。
   参考文献列表（References / Bibliography）整体作为单个章节输出，**条目本身不用 \`<p>\` 标签包裹**（视为列表项）。

【版式修复 — 在不改写事实的前提下允许】
PDF 双列抽文常见问题，按以下规则清理：
a. 同一段内的硬换行、断行（行尾连字符 "atten-\\n tion" → "attention"）合并为完整段落。
b. 跨列错位插入的页眉、页脚、页码、期刊名、版权声明、arXiv 编号等噪声**整行删除**。
c. 因双列抽文导致顺序错乱（如正文中突然插入下一栏开头）：在能从上下文清晰判断时按阅读
   顺序重排；不确定时保留原顺序，并在该 block 末尾追加 \`<!-- 原文版式可疑，未重排 -->\`。
d. 公式、代码块、引用文献条目原样保留，不要"翻译"或"解释"。

【内容保真 — 红线】
- 禁止改写、翻译、概述或省略论文事实性内容。
- 禁止合并不同段落的事实陈述。
- 不确定的版式问题宁可保留也不擅改。
- 任何不在原文中的事实一律不得出现。
- 章节**文字**以原文标题为准（如 "Method" / "Related Work"）；章节**编号**若原文已自带（如 "3 Method"）沿用原文数字，否则按出现顺序补 1, 2, 3…。
- 编号格式一律归一为 \`# N. <标题>\`（数字 + 英文句点 + 空格），即使原文写作 "1 Method" / "§3 Method" / "3) Method" / "3、方法" 也要改写为 \`# 3. Method\`。
- 多次出现的同一编号（例如附录从 1 重新编号、源文档中出现重复"1. Introduction"）不要试图自行调整 —— 按你看到的原文如实输出，下游处理会统一去重。

输出整篇 markdown，不要任何额外解释或前后缀。`

export interface UserPromptInput {
  paperTitle: string
  attachmentKey: string
  chunkIndex: number
  chunkTotal: number
  isFirstChunk: boolean
  markdown: string
}

/** 拼装单片的 user prompt */
export function buildUserPrompt(input: UserPromptInput): string {
  const chunkNote = input.isFirstChunk
    ? '包含 frontmatter / OUTLINE / CONTENT 头部'
    : '仅 CONTENT 续接，禁止再输出 frontmatter / OUTLINE / # CONTENT 头'
  return [
    `论文标题：${input.paperTitle}`,
    `源文件：${input.attachmentKey}.md`,
    `当前片段：${input.chunkIndex}/${input.chunkTotal}（${chunkNote}）`,
    '',
    input.markdown,
  ].join('\n')
}
