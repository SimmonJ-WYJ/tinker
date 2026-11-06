/**
 * 文件预览服务 — 在新 Electron 窗口中预览文件
 *
 * 支持预览类型：
 * - 图片 (png, jpg, gif, webp, svg, bmp)
 * - 视频 (mp4, webm, mov)
 * - Markdown (md)
 * - JSON (json)
 * - XML/HTML (xml, html, htm)
 * - PDF (pdf) — 使用 Chromium 原生 PDF 查看器
 * - DOCX (docx) — 使用 mammoth.js 转 HTML
 * - 其他类型自动调用系统默认应用打开
 *
 * 所有预览窗口自动跟随系统主题（light/dark）。
 */

import { BrowserWindow, shell, nativeTheme } from 'electron'
import { resolve, basename, extname, join } from 'node:path'
import { readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { nowMs, windowBgColor } from '@asci/shared'
import {
  isReviewHtmlWrapped,
  wrapReviewHtmlFragment,
} from './objects/review-html-wrapper.ts'
import { resolveTheme } from './theme-service.ts'

/** 文件大小限制：50MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024

/** mac 平台：用 titleBarStyle hiddenInset 隐藏原生标题栏（去掉重复文件名），保留红绿灯按钮 */
const IS_MAC = process.platform === 'darwin'

/**
 * 当前预览窗口是否暗色 —— 跟随 ASCI 应用主题（resolveTheme），不跟 OS。
 * openFilePreview 入口同步解析一次写入；各 *PreviewHtml 构造器（同步调用栈内）经
 * baseStyles() 读取。模块级单值即可：预览构造全在单次同步调用内完成，无并发覆盖。
 */
let currentPreviewIsDark = false

/** 支持预览的图片扩展名 */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])

/** 支持预览的视频扩展名 */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov'])

/** 支持代码高亮预览的扩展名（.html/.htm 不在此列：HTML 走 iframe 渲染实际页面） */
const CODE_EXTENSIONS = new Set(['.json', '.xml'])

/** 支持 Markdown 渲染预览的扩展名 */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])

/** 支持 PDF 预览的扩展名 */
const PDF_EXTENSIONS = new Set(['.pdf'])

/** 支持 DOCX 预览的扩展名 */
const DOCX_EXTENSIONS = new Set(['.docx'])

/** ASCI 富 HTML 产物目录：reviews/（综述正文）+ searches/（检索报告）。两者都是
 * skill 写的 `<article>` fragment，需包成 self-contained 文档才能正确渲染（CSS/JS/KaTeX）。
 * 与渲染侧 asci-rich-html-path.ts 的判定保持一致。 */
const ASCI_RICH_HTML_DIR_RE = /(?:^|[\\/])(?:reviews|searches)[\\/]/

/** 获取预览类型
 *
 * 注意：'review-html' 是 reviews/ 与 searches/ 目录下 .html 文件的特化类型，会渲染成
 * "实际效果"视图（包成 self-contained 文档 + KaTeX + [N] 角标 hover/click），与应用内
 * ReviewHtmlPreviewRenderer 一致；其它 .html 走 'html'（iframe 渲染实际页面）。识别用
 * 绝对路径（resolve 后）匹配 `/reviews/` 或 `/searches/`，**不**关心 cwd 在哪一层。
 */
function getPreviewType(
  ext: string,
  filePath?: string,
): 'image' | 'video' | 'markdown' | 'code' | 'review-html' | 'html' | 'pdf' | 'docx' | 'unsupported' {
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  if (ext === '.html' && filePath && ASCI_RICH_HTML_DIR_RE.test(filePath)) {
    return 'review-html'
  }
  // 其它 .html / .htm：渲染实际页面（iframe 加载源文件），不展示源码
  if (ext === '.html' || ext === '.htm') return 'html'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  if (PDF_EXTENSIONS.has(ext)) return 'pdf'
  if (DOCX_EXTENSIONS.has(ext)) return 'docx'
  return 'unsupported'
}

/** 转义 HTML 特殊字符 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 获取临时文件目录 */
function getPreviewTmpDir(): string {
  const dir = join(tmpdir(), 'asci-preview')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** 将 HTML 写入临时文件并返回路径 */
function writeTempHtml(html: string): string {
  const tmpDir = getPreviewTmpDir()
  const tmpFile = join(tmpDir, `preview-${nowMs()}.html`)
  writeFileSync(tmpFile, html, 'utf-8')
  return tmpFile
}

/**
 * 生成预览页样式。主题**跟随 ASCI 应用主题**（resolveTheme，非 OS prefers-color-scheme）
 * —— 用户在 ASCI 里选 light，预览窗口也 light（即使 OS 是 dark）。颜色直接按 isDark
 * 写死 :root，不再用 @media prefers-color-scheme，避免与应用主题脱节。
 */
function baseStyles(): string {
  const dark = currentPreviewIsDark
  return `
    :root {
      color-scheme: ${dark ? 'dark' : 'light'};
      --bg: ${dark ? '#1a1a1a' : '#ffffff'};
      --bg-toolbar: ${dark ? '#252525' : '#f5f5f5'};
      --border: ${dark ? '#333' : '#e0e0e0'};
      --text: ${dark ? '#e0e0e0' : '#1a1a1a'};
      --text-secondary: ${dark ? '#ccc' : '#666'};
      --text-muted: ${dark ? '#888' : '#999'};
      --btn-bg: ${dark ? '#333' : '#eee'};
      --btn-border: ${dark ? '#444' : '#ccc'};
      --btn-hover: ${dark ? '#444' : '#ddd'};
      --code-bg: ${dark ? '#2d2d2d' : '#f4f4f4'};
      --content-bg: ${dark ? '#1a1a1a' : '#fafafa'};
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      /* 无原生标题栏（titleBarStyle:hiddenInset）：mac 左侧留出红绿灯按钮空间 */
      padding: 0 16px 0 ${IS_MAC ? '84px' : '16px'};
      height: 44px;
      background: var(--bg-toolbar);
      border-bottom: 1px solid var(--border);
      -webkit-app-region: drag;
      flex-shrink: 0;
    }
    .toolbar-title {
      flex: 1;
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      letter-spacing: 0.01em;
    }
    .toolbar-btn {
      -webkit-app-region: no-drag;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 6px 12px;
      border: none;
      border-radius: 7px;
      background: var(--btn-bg);
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: background 0.15s, color 0.15s;
    }
    .toolbar-btn:hover { background: var(--btn-hover); color: var(--text); }
    .toolbar-btn:active { transform: translateY(0.5px); }
    .toolbar-btn svg { width: 14px; height: 14px; }
    .content {
      flex: 1;
      overflow: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--content-bg);
    }
  `
}

/** 生成工具栏 HTML（无原生标题栏，仅一行：文件名 + 操作按钮；不再渲染路径，文件名只此一处） */
function toolbarHtml(filename: string): string {
  // 行内 SVG（Lucide external-link / folder-open）—— 离线可用，跟随 currentColor
  const iconOpen =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>'
  const iconFinder =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>'
  return `
  <div class="toolbar">
    <div class="toolbar-title">${escapeHtml(filename)}</div>
    <button class="toolbar-btn" id="btn-open">${iconOpen}用默认应用打开</button>
    <button class="toolbar-btn" id="btn-finder">${iconFinder}在 Finder 中显示</button>
  </div>`
}

/** 生成工具栏按钮脚本 */
function toolbarScript(filePath: string): string {
  return `
  <script>
    const filePath = ${JSON.stringify(filePath)};
    document.getElementById('btn-open').onclick = () => {
      document.title = '__preview_action__:open:' + filePath;
    };
    document.getElementById('btn-finder').onclick = () => {
      document.title = '__preview_action__:folder:' + filePath;
    };
  </script>`
}

/** 生成图片预览 HTML */
function imagePreviewHtml(filePath: string, filename: string): string {
  const fileUrl = `file://${encodeURI(filePath).replace(/#/g, '%23')}`

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title>
<style>
  ${baseStyles()}
  .content { background: var(--content-bg); }
  .content img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
</style></head><body>
  ${toolbarHtml(filename)}
  <div class="content">
    <img src="${fileUrl}" alt="${escapeHtml(filename)}" />
  </div>
  ${toolbarScript(filePath)}
</body></html>`
}

/** 生成视频预览 HTML */
function videoPreviewHtml(filePath: string, filename: string): string {
  const fileUrl = `file://${encodeURI(filePath).replace(/#/g, '%23')}`

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title>
<style>
  ${baseStyles()}
  .content video {
    max-width: 100%;
    max-height: 100%;
  }
</style></head><body>
  ${toolbarHtml(filename)}
  <div class="content">
    <video src="${fileUrl}" controls autoplay style="outline:none"></video>
  </div>
  ${toolbarScript(filePath)}
</body></html>`
}

/** 生成 Markdown 预览 HTML */
function markdownPreviewHtml(filePath: string, filename: string, textContent: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title>
<style>
  ${baseStyles()}
  .content {
    display: block;
    padding: 24px 32px;
    align-items: stretch;
    overflow-y: auto;
  }
  .markdown-body {
    max-width: 800px;
    margin: 0 auto;
    font-size: 14px;
    line-height: 1.7;
    color: var(--text);
  }
  .markdown-body h1, .markdown-body h2, .markdown-body h3 { margin: 1em 0 0.5em; }
  .markdown-body h1 { font-size: 1.8em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
  .markdown-body h2 { font-size: 1.4em; border-bottom: 1px solid var(--border); padding-bottom: 0.2em; }
  .markdown-body h3 { font-size: 1.15em; }
  .markdown-body p { margin: 0.8em 0; }
  .markdown-body code {
    background: var(--code-bg);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.9em;
    font-family: 'SF Mono', Monaco, Menlo, monospace;
  }
  .markdown-body pre {
    background: var(--code-bg);
    padding: 12px 16px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 1em 0;
  }
  .markdown-body pre code { background: none; padding: 0; }
  .markdown-body blockquote {
    border-left: 3px solid var(--border);
    padding-left: 12px;
    color: var(--text-muted);
    margin: 1em 0;
  }
  .markdown-body ul, .markdown-body ol { padding-left: 2em; margin: 0.5em 0; }
  .markdown-body li { margin: 0.3em 0; }
  .markdown-body a { color: #2563eb; text-decoration: none; }
  @media (prefers-color-scheme: dark) { .markdown-body a { color: #58a6ff; } }
  .markdown-body a:hover { text-decoration: underline; }
  .markdown-body table { border-collapse: collapse; margin: 1em 0; width: 100%; }
  .markdown-body th, .markdown-body td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
  .markdown-body th { background: var(--code-bg); }
  .markdown-body img { max-width: 100%; border-radius: 8px; }
  .markdown-body hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }
</style></head><body>
  ${toolbarHtml(filename)}
  <div class="content">
    <div class="markdown-body" id="md-content"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/marked@15/marked.min.js"></script>
  <script>
    const raw = ${JSON.stringify(textContent)};
    document.getElementById('md-content').innerHTML = typeof marked !== 'undefined'
      ? marked.parse(raw)
      : '<pre>' + raw.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre>';
  </script>
  ${toolbarScript(filePath)}
</body></html>`
}

/**
 * 生成 reviews/ 与 searches/ 下 *.html 外部预览窗口外壳（工具栏 + iframe）
 *
 * reviews/*.html 已被 persistence 层包成 self-contained 文档；searches/*.html 则是
 * skill 直接写的裸 `<article>` fragment、**从未包装**（无 persistence hook）。iframe
 * 加载裸 fragment 会丢全部 CSS/JS → 只剩浏览器默认衬底样式（#460 之外的另一处：检索
 * 报告外部预览整片不格式化）。
 *
 * 这里统一在预览时兜底包装：未包过的 fragment 用 wrapReviewHtmlFragment 包成 standalone
 * 文档（含 CSS + JS + KaTeX CDN），写临时文件，iframe 加载临时文件；已包过的（reviews）
 * 直接加载源文件。两条路径最终都是 self-contained 文档，渲染与浏览器双击一致。
 *
 * iframe 加载 file:// 临时文件，同源 → 脚本 / KaTeX CDN / cite 角标交互均可正常工作。
 */
function reviewHtmlPreviewHtml(filePath: string, filename: string, textContent: string): string {
  // 已是 self-contained 文档（reviews 落库时已包）→ 直接指向源文件；否则（searches 裸
  // fragment）就地包装成 standalone 文档写临时文件，避免修改用户工作区原文件。
  const targetPath = isReviewHtmlWrapped(textContent)
    ? filePath
    : writeTempHtml(wrapReviewHtmlFragment(textContent))
  // hash 把 ASCI 主题透传给 iframe 内 standalone 文档 —— wrapper JS 据此强制 light/dark，
  // 覆盖文档自身的 prefers-color-scheme（保证应用内预览跟随应用主题，而非 OS）。浏览器
  // 双击打开（无此 hash）仍走 prefers-color-scheme。
  const themeHash = `#asci-theme=${currentPreviewIsDark ? 'dark' : 'light'}`
  const fileUrl = `file://${encodeURI(targetPath).replace(/#/g, '%23')}${themeHash}`
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title>
<style>
  ${baseStyles()}
  .content { padding: 0; background: var(--bg); }
  .content iframe { width: 100%; height: 100%; border: 0; background: var(--bg); display: block; }
</style></head><body>
  ${toolbarHtml(filename)}
  <div class="content">
    <iframe src="${fileUrl}" title="${escapeHtml(filename)}" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>
  </div>
  ${toolbarScript(filePath)}
</body></html>`
}

/**
 * 生成通用 .html 外部预览窗口（工具栏 + iframe 渲染实际页面）。
 * 用户自己 agent 生成的报告应看到渲染效果而非源码；预览窗口本身是 file:// 源，
 * iframe 加载 file:// 同源，脚本 / 样式 / 外链资源均可正常工作。
 */
function htmlPreviewHtml(filePath: string, filename: string): string {
  const fileUrl = `file://${encodeURI(filePath).replace(/#/g, '%23')}`
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title>
<style>
  ${baseStyles()}
  .content { padding: 0; background: #fff; }
  .content iframe { width: 100%; height: 100%; border: 0; background: #fff; display: block; }
</style></head><body>
  ${toolbarHtml(filename)}
  <div class="content">
    <iframe src="${fileUrl}" title="${escapeHtml(filename)}" sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe>
  </div>
  ${toolbarScript(filePath)}
</body></html>`
}

/** 生成代码/文本预览 HTML */
function codePreviewHtml(filePath: string, filename: string, textContent: string, ext: string): string {
  const langMap: Record<string, string> = {
    '.json': 'json',
    '.xml': 'xml',
    '.html': 'html',
    '.htm': 'html',
  }
  const lang = langMap[ext] || 'text'
  const isDark = nativeTheme.shouldUseDarkColors

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title>
<style>
  ${baseStyles()}
  .content {
    display: block;
    padding: 0;
    align-items: stretch;
    overflow: auto;
  }
  pre {
    padding: 16px 20px;
    font-family: 'SF Mono', Monaco, Menlo, monospace;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-all;
    tab-size: 2;
    width: 100%;
  }
</style>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11/styles/${isDark ? 'github-dark' : 'github'}.min.css">
</head><body>
  ${toolbarHtml(filename)}
  <div class="content">
    <pre><code class="language-${lang}" id="code-content">${escapeHtml(textContent)}</code></pre>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/highlight.js@11/highlight.min.js"></script>
  <script>
    if (typeof hljs !== 'undefined') {
      hljs.highlightElement(document.getElementById('code-content'));
    }
  </script>
  ${toolbarScript(filePath)}
</body></html>`
}

/** 生成 PDF 预览 HTML（使用 PDF.js 渲染，兼容性优于 Chromium 内置查看器） */
function pdfPreviewHtml(filePath: string, filename: string): string {
  const fileUrl = `file://${encodeURI(filePath).replace(/#/g, '%23')}`

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title>
<style>
  ${baseStyles()}
  .content {
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: auto;
    padding: 16px;
    gap: 12px;
    background: var(--content-bg);
  }
  canvas {
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    max-width: 100%;
  }
  .page-info {
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
    padding: 4px 0;
  }
  .loading-msg {
    text-align: center;
    color: var(--text-muted);
    padding: 40px;
  }
  .error-msg {
    color: #f87171;
    padding: 20px;
    text-align: center;
  }
</style>
</head><body>
  ${toolbarHtml(filename)}
  <div class="content" id="pdf-container">
    <div class="loading-msg">正在加载 PDF...</div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.min.mjs" type="module"></script>
  <script type="module">
    import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.min.mjs';
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs';

    const container = document.getElementById('pdf-container');
    const fileUrl = ${JSON.stringify(fileUrl)};

    async function renderPDF() {
      try {
        const pdf = await pdfjsLib.getDocument(fileUrl).promise;
        container.innerHTML = '';

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          // 使用 2x 缩放以获得清晰渲染
          const scale = 2;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          // 显示宽度为实际宽度的一半（Retina 清晰度）
          canvas.style.width = (viewport.width / scale) + 'px';
          canvas.style.height = (viewport.height / scale) + 'px';

          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;

          container.appendChild(canvas);
        }

        // 页数信息
        const info = document.createElement('div');
        info.className = 'page-info';
        info.textContent = '共 ' + pdf.numPages + ' 页';
        container.appendChild(info);
      } catch (err) {
        container.innerHTML = '<div class="error-msg">PDF 加载失败: ' + err.message + '</div>';
      }
    }

    renderPDF();
  </script>
  ${toolbarScript(filePath)}
</body></html>`
}

/** 生成 DOCX 预览 HTML（使用 mammoth.js 转换为 HTML） */
function docxPreviewHtml(filePath: string, filename: string, base64Data: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title>
<style>
  ${baseStyles()}
  .content {
    display: block;
    padding: 24px 32px;
    align-items: stretch;
    overflow-y: auto;
  }
  .docx-body {
    max-width: 800px;
    margin: 0 auto;
    font-size: 14px;
    line-height: 1.7;
    color: var(--text);
  }
  .docx-body h1, .docx-body h2, .docx-body h3 { margin: 1em 0 0.5em; }
  .docx-body h1 { font-size: 1.8em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
  .docx-body h2 { font-size: 1.4em; }
  .docx-body h3 { font-size: 1.15em; }
  .docx-body p { margin: 0.8em 0; }
  .docx-body table { border-collapse: collapse; margin: 1em 0; width: 100%; }
  .docx-body th, .docx-body td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
  .docx-body th { background: var(--code-bg); }
  .docx-body img { max-width: 100%; border-radius: 8px; }
  .docx-body ul, .docx-body ol { padding-left: 2em; margin: 0.5em 0; }
  .docx-body li { margin: 0.3em 0; }
  .docx-body a { color: #2563eb; }
  @media (prefers-color-scheme: dark) { .docx-body a { color: #58a6ff; } }
  .loading { text-align: center; color: var(--text-muted); padding: 40px; }
  .error { color: #f87171; padding: 20px; }
</style></head><body>
  ${toolbarHtml(filename)}
  <div class="content">
    <div class="docx-body" id="docx-content">
      <div class="loading">正在解析文档...</div>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/mammoth@1/mammoth.browser.min.js"></script>
  <script>
    const base64 = ${JSON.stringify(base64Data)};
    const container = document.getElementById('docx-content');

    function base64ToArrayBuffer(b64) {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }

    if (typeof mammoth !== 'undefined') {
      mammoth.convertToHtml({ arrayBuffer: base64ToArrayBuffer(base64) })
        .then(function(result) {
          container.innerHTML = result.value;
        })
        .catch(function(err) {
          container.innerHTML = '<div class="error">文档解析失败: ' + err.message + '</div>';
        });
    } else {
      container.innerHTML = '<div class="error">mammoth.js 加载失败，请检查网络连接</div>';
    }
  </script>
  ${toolbarScript(filePath)}
</body></html>`
}

/** 路径是否为富 HTML 产物（reviews/+searches/ 下 .html）。给外部打开判断用。 */
export function isRichHtmlPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.html') && ASCI_RICH_HTML_DIR_RE.test(filePath)
}

/**
 * 就地把 ASCI 应用主题烤进富 HTML 工作区文件（不落临时文件，文件始终留在工作区内）。
 *
 * 为什么必须就地改写、不能开临时文件：
 *   1. macOS LaunchServices 打开 file:// 会丢弃 #fragment，hash 透传主题不可靠
 *   2. OPEN_FILE IPC 强校验路径在 Agent 工作区内，/tmp 临时文件会被拒
 * 所以读盘内容 → 确保 self-contained（兜底 wrap 裸 fragment）→ 在 <html> 上写死/替换
 * data-asci-theme=<theme>（CSS 属性选择器 override prefers-color-scheme）→ 写回原文件。
 * 内容无变化（已是同主题）则跳过写盘，避免无谓 mtime 抖动。失败仅 warn，调用方照常 openPath。
 */
export function applyThemeToRichHtmlFile(filePath: string, isDark: boolean): void {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const doc = isReviewHtmlWrapped(raw) ? raw : wrapReviewHtmlFragment(raw)
    const theme = isDark ? 'dark' : 'light'
    // 在 <html ...> 上注入/替换 data-asci-theme（wrapper 产出根标签为 <html lang="en">）
    const themed = doc.replace(
      /<html\b([^>]*)>/i,
      (_m, attrs: string) =>
        `<html${attrs.replace(/\s*data-asci-theme="[^"]*"/i, '')} data-asci-theme="${theme}">`,
    )
    if (themed !== raw) writeFileSync(filePath, themed, 'utf-8')
  } catch (err) {
    console.warn('[文件预览] 富 HTML 就地烤主题失败（不影响打开）:', err)
  }
}

/**
 * 用系统默认应用打开富 HTML：先就地把当前 ASCI 主题烤进工作区文件，再 openPath 原文件
 * （文件留在工作区内，不开临时文件）。
 */
function openRichHtmlExternally(filePath: string, isDark: boolean): void {
  applyThemeToRichHtmlFile(filePath, isDark)
  shell.openPath(filePath)
}

/** 创建预览窗口并绑定工具栏事件 */
function createPreviewWindow(filename: string): BrowserWindow {
  const previewWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    title: filename,
    // 不透明底色：避免 Windows GPU 合成层透出桌面（issue #459）
    backgroundColor: windowBgColor(nativeTheme.shouldUseDarkColors),
    // mac：隐藏原生标题栏（去掉与 toolbar 重复的文件名），红绿灯按钮内嵌悬浮在自定义
    // toolbar 上（toolbar 已为其留 84px 左内边距）。非 mac 保留默认窗口边框。
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  previewWindow.setMenuBarVisibility(false)

  // 监听 title 变化来处理工具栏按钮操作
  previewWindow.on('page-title-updated', (event, title) => {
    if (title.startsWith('__preview_action__:')) {
      event.preventDefault()
      const [, action] = title.split(':')
      const fullPath = title.slice(`__preview_action__:${action}:`.length)

      if (action === 'open') {
        // 富 HTML 产物（reviews/+searches/ 下 .html）跟随 ASCI 应用主题打开。
        // 注意：macOS LaunchServices 打开 file:// 时会丢弃 URL #fragment，故不能靠 hash 透传
        // 主题；改为把主题烤进文档 —— 读盘内容、确保 wrap、在 <html> 上写死 data-asci-theme、
        // 落临时文件再 openPath。其它类型/普通文件仍直接交系统默认应用。
        if (isRichHtmlPath(fullPath)) {
          openRichHtmlExternally(fullPath, currentPreviewIsDark)
        } else {
          shell.openPath(fullPath)
        }
      } else if (action === 'folder') {
        shell.showItemInFolder(fullPath)
      }

      previewWindow.setTitle(filename)
    }
  })

  return previewWindow
}

/**
 * 在新窗口中预览文件
 * 不支持的文件类型会调用系统默认应用打开
 */
export function openFilePreview(filePath: string): void {
  // 同步解析一次 ASCI 应用主题，供本次构造的所有 *PreviewHtml（baseStyles）使用
  currentPreviewIsDark = resolveTheme().isDark
  const safePath = resolve(filePath)
  const filename = basename(safePath)
  const ext = extname(safePath).toLowerCase()
  const previewType = getPreviewType(ext, safePath)

  // 不支持的类型，直接用系统默认应用打开
  if (previewType === 'unsupported') {
    shell.openPath(safePath)
    return
  }

  // 检查文件大小
  const stat = statSync(safePath)
  if (stat.size > MAX_FILE_SIZE) {
    console.warn(`[文件预览] 文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，使用系统应用打开`)
    shell.openPath(safePath)
    return
  }

  let html: string

  if (previewType === 'pdf') {
    html = pdfPreviewHtml(safePath, filename)
  } else if (previewType === 'image') {
    html = imagePreviewHtml(safePath, filename)
  } else if (previewType === 'video') {
    html = videoPreviewHtml(safePath, filename)
  } else if (previewType === 'docx') {
    const buffer = readFileSync(safePath)
    const base64 = buffer.toString('base64')
    html = docxPreviewHtml(safePath, filename, base64)
  } else if (previewType === 'review-html') {
    const textContent = readFileSync(safePath, 'utf-8')
    html = reviewHtmlPreviewHtml(safePath, filename, textContent)
  } else if (previewType === 'html') {
    html = htmlPreviewHtml(safePath, filename)
  } else {
    const textContent = readFileSync(safePath, 'utf-8')
    html = previewType === 'markdown'
      ? markdownPreviewHtml(safePath, filename, textContent)
      : codePreviewHtml(safePath, filename, textContent, ext)
  }

  // 将 HTML 写入临时文件（避免 data: URL 大小限制）
  const tmpHtmlPath = writeTempHtml(html)
  const previewWindow = createPreviewWindow(filename)
  previewWindow.loadFile(tmpHtmlPath)
}
