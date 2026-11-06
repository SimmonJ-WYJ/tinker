/**
 * ASCI 富 HTML 产物路径识别
 *
 * `reviews/*.html`（综述正文）与 `searches/*.html`（检索报告）都由 Agent skill
 * 产出 `<article>` 片段，共用 ReviewHtmlPreviewRenderer（DOMPurify + KaTeX + 注引装饰）
 * 渲染；其余 `.html` 仍走通用 sandbox HtmlRenderer。
 *
 * 抽成纯函数便于单测（registrations.ts 在 import 期注册渲染器，不宜在测试中直接 import）。
 */

/** 命中 reviews/ 或 searches/ 目录段（行首或任意路径分隔后，正/反斜杠均可——兼容 Windows 反斜杠绝对路径）。 */
export const ASCI_RICH_HTML_PATH_RE = /(?:^|[\\/])(?:reviews|searches)[\\/]/

export function isAsciRichHtmlPath(path: string): boolean {
  return ASCI_RICH_HTML_PATH_RE.test(path)
}
