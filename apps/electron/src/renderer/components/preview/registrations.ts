/**
 * 预览器注册中心 — 应用启动时导入，执行所有 registerRenderer()
 */
import * as React from 'react'
import { registerRenderer } from './preview-registry'
import { isAsciRichHtmlPath } from './asci-rich-html-path'

registerRenderer({
  extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif'],
  maxSize: 50 * 1024 * 1024,
  Component: React.lazy(() => import('./renderers/ImageRenderer')),
})

// reviews/*.html（综述）与 searches/*.html（检索报告）走 ReviewHtmlPreviewRenderer
// （DOMPurify + KaTeX + 注引装饰）；必须**在通用 HtmlRenderer 之前**注册，
// matches 钩子返回 false 时 fall-through 到下一条。
registerRenderer({
  extensions: ['html'],
  maxSize: 2 * 1024 * 1024,
  matches: (target) => target.kind === 'file' && isAsciRichHtmlPath(target.path),
  Component: React.lazy(() => import('./renderers/ReviewHtmlPreviewRenderer')),
})

registerRenderer({
  extensions: ['html', 'htm'],
  maxSize: 5 * 1024 * 1024,
  Component: React.lazy(() => import('./renderers/HtmlRenderer')),
})

registerRenderer({
  extensions: ['md', 'markdown', 'mdx'],
  maxSize: 2 * 1024 * 1024,
  Component: React.lazy(() => import('./renderers/MarkdownRenderer')),
})

registerRenderer({
  // PDF 不设 maxSize — PDF.js 自己按页懒加载
  // 用 PdfEvidenceRenderer 包装：在通用预览之外注入对话流引文溯源高亮（#448）；
  // 无 evidence 命中时高亮为空，等价于裸 PdfRenderer。
  extensions: ['pdf'],
  Component: React.lazy(() => import('./renderers/PdfEvidenceRenderer')),
})

registerRenderer({
  extensions: ['csv', 'tsv'],
  maxSize: 50 * 1024 * 1024,
  Component: React.lazy(() => import('./renderers/CsvRenderer')),
})

registerRenderer({
  extensions: ['ipynb'],
  maxSize: 10 * 1024 * 1024,
  Component: React.lazy(() => import('./renderers/NotebookRenderer')),
})

registerRenderer({
  extensions: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'],
  maxSize: 20 * 1024 * 1024,
  Component: React.lazy(() => import('./renderers/OfficeRenderer')),
})

registerRenderer({
  extensions: [
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
    'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'scala',
    'c', 'cpp', 'cc', 'h', 'hpp', 'cs', 'php', 'lua', 'r',
    'sh', 'bash', 'zsh', 'fish',
    'json', 'yaml', 'yml', 'toml', 'xml', 'sql',
    'css', 'scss', 'less',
    'tex', 'bib',
    'vue', 'svelte', 'dart', 'elm', 'hs', 'ml',
    'txt', 'log',
  ],
  maxSize: 5 * 1024 * 1024,
  Component: React.lazy(() => import('./renderers/CodeRenderer')),
})
