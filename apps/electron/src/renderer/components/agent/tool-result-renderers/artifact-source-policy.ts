/**
 * 工具结果渲染策略 — 对话流是否抑制源码块
 *
 * 某些产物文件没必要在对话流里灌全文源码 / diff：文件已可经芯片打开，
 * 且右栏预览器能直接渲染。此处判定按文件类型决定「只留文件操作行」。
 */

/** 任意 .html / .htm 产物：右栏 HtmlRenderer 兜底渲染，对话流不灌源码。 */
const HTML_ARTIFACT_RE = /\.html?$/i

export function isHtmlArtifact(path: string): boolean {
  return HTML_ARTIFACT_RE.test(path)
}
