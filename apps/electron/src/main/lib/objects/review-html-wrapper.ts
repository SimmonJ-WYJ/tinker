/**
 * 综述 HTML fragment → standalone HTML 文档 包装器
 *
 * 背景：literature-review-result skill v0.19.0+ 用 Write 工具落
 * `reviews/{ts}-{slug}.html`，**但只写 fragment**（`<article class="asci-review">…</article>`）
 * —— 让 LLM 不必每次重复输出几百行 CSS+JS。
 *
 * 用户期望"双击文件 → 浏览器看到完整渲染"，所以 persistence 层在落库之前把
 * fragment 包成完整的 self-contained HTML 文档：
 *   <!doctype html><html><head>{embedded CSS + JS}</head><body>{fragment}</body></html>
 *
 * 包装幂等：再次包同一文件不做任何动作（避免 mtime 抖动 / 反复重写）。
 *
 * 内嵌的 CSS+JS：
 *   - 样式：与应用内 ReviewHtmlPreviewRenderer / CitationBadge / EvidenceTraceCard
 *     视觉一致（黄色 #fde68a/#fcd34d/#78350f；卡片有竖线 + 阴影 + 圆角）
 *   - 行为：解析 §7 References → 替换 `<cite data-ref="N"><q>` 为 `[N]` 角标 →
 *     click 在所在 <p> 后挂出 Evidence trace 卡片（含 paper 元数据 + verbatim quote）
 *     再次点击同一 [N] / 点击外部 / Esc → 关闭卡片
 *   - 不渲染 hover Tooltip（与应用内 trace 模式一致）
 *   - 不渲染 "Open full context in Paper" / "Add note here" 按钮 —— 这两者依赖
 *     应用内的 Library + PDF 滚动联动，离线 HTML 没有运行时支撑；卡片仅有 × 关闭
 *   - KaTeX：从 jsdelivr CDN 加载 katex@0.16 + auto-render，离线时数学公式以
 *     LaTeX 源码留存
 *
 * 不做 sanitize：文件已经在用户自己的 session cwd，是用户的资产；他们用浏览器打开
 * 等同于打开任何本地 HTML 文件，与"我们的应用沙箱"无关。应用内渲染另由
 * ReviewHtmlRenderer 走 DOMPurify。
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 文件已经是 self-contained 文档（含 doctype / <html>） */
export function isReviewHtmlWrapped(content: string): boolean {
  const head = content.trimStart().slice(0, 200).toLowerCase()
  return head.startsWith('<!doctype') || head.startsWith('<html')
}

/** 把 fragment 包成完整 HTML5 文档；已包过则原样返回 */
export function wrapReviewHtmlFragment(
  fragment: string,
  options: { title?: string } = {},
): string {
  if (isReviewHtmlWrapped(fragment)) return fragment

  const title = (options.title ?? extractTitleFromFragment(fragment) ?? 'Review').slice(0, 200)
  const escapedTitle = escapeHtml(title)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapedTitle}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css" crossorigin="anonymous">
<style>${REVIEW_STANDALONE_CSS}</style>
<script>
  // 应用内 iframe 预览经 URL hash #asci-theme=light|dark 透传 ASCI 应用主题；
  // head 内同步执行（早于 body 绘制）避免主题闪烁。无 hash（浏览器双击）→ 不设属性，
  // 走 CSS 的 prefers-color-scheme 媒体查询。
  (function () {
    var m = /[#&]asci-theme=(light|dark)/.exec(location.hash);
    if (m) document.documentElement.setAttribute('data-asci-theme', m[1]);
  })();
</script>
</head>
<body>
${fragment}
<script src="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.js" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16/dist/contrib/auto-render.min.js" crossorigin="anonymous"></script>
<script>${REVIEW_STANDALONE_JS}</script>
</body>
</html>
`
}

/**
 * 把 session cwd 下 searches/*.html 的裸 fragment 就地包成 self-contained 文档。
 *
 * 背景：reviews/*.html 由 persistence hook 落库时已 wrap；searches/*.html 是 lit-search
 * skill 直接 Write 的裸 `<article class="asci-search-report">` fragment，**没有任何
 * persistence / wrap 链路** → 用户「用默认应用打开」/ Finder 双击 / 应用内另开窗口看到
 * 的都是无 CSS 的浏览器默认衬底样式。
 *
 * 与 reviews 共用 wrapReviewHtmlFragment（CSS/JS 已泛化覆盖两种 article class）。在
 * orchestrator run 完成 hook 里调用，幂等：已 wrap 的跳过、读写失败仅 warn 不抛错（不
 * 阻塞 Agent 主路径）。返回实际新 wrap 的文件数，供日志。
 */
export function wrapSearchReportsInCwd(sessionCwd: string, runStartedAtMs = 0): number {
  const searchesDir = join(sessionCwd, 'searches')
  if (!existsSync(searchesDir)) return 0

  let names: string[]
  try {
    names = readdirSync(searchesDir)
  } catch (err) {
    console.warn(`[search-html-wrapper] 读 searches 目录失败: ${searchesDir}`, err)
    return 0
  }

  // 只处理本轮新增/改动的文件（mtime >= runStartedAt，向前放宽 2s 防 Write 落 mtime 略早）：
  // 避免每轮结束都把 searches/ 下全部历史报告重读一遍。runStartedAtMs=0 时退化为全扫。
  const threshold = runStartedAtMs - 2000
  let wrapped = 0
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.html')) continue
    const filePath = join(searchesDir, name)
    try {
      const st = statSync(filePath)
      if (!st.isFile() || st.mtimeMs < threshold) continue
      const content = readFileSync(filePath, 'utf-8')
      if (content.trim().length === 0 || isReviewHtmlWrapped(content)) continue
      writeFileSync(filePath, wrapReviewHtmlFragment(content), 'utf-8')
      wrapped++
    } catch (err) {
      console.warn(`[search-html-wrapper] 包装失败（跳过）: ${filePath}`, err)
    }
  }
  if (wrapped > 0) {
    console.log(`[search-html-wrapper] 已包 standalone ${wrapped} 份 searches/*.html（dir=${searchesDir}）`)
  }
  return wrapped
}

/** 从 fragment 抓首个 <h1> textContent 作 document title 兜底 */
function extractTitleFromFragment(fragment: string): string | null {
  const m = fragment.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (!m || !m[1]) return null
  const text = m[1]
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 0 ? text : null
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ===========================================================================
// 内嵌 CSS：与 file-preview-service.reviewHtmlPreviewHtml 视觉一致
// ===========================================================================
const REVIEW_STANDALONE_CSS = `
/* 主题三态：默认（无 data-asci-theme）light；OS dark 偏好仅在未被强制时生效；
   应用内 iframe 经 URL hash #asci-theme 注入 <html data-asci-theme> 强制覆盖 OS。
   light 调色板即 :root 默认值（无需为 data-asci-theme="light" 再列一遍）。 */
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --text: #1a1a1a;
  --text-secondary: #555;
  --text-muted: #888;
  --border: #e0e0e0;
  --code-bg: #f4f4f4;
}
:root[data-asci-theme="light"] { color-scheme: light; }
@media (prefers-color-scheme: dark) {
  :root:not([data-asci-theme="light"]):not([data-asci-theme="dark"]) {
    --bg: #1a1a1a; --text: #e0e0e0; --text-secondary: #bbb;
    --text-muted: #888; --border: #333; --code-bg: #2d2d2d;
  }
}
:root[data-asci-theme="dark"] {
  color-scheme: dark;
  --bg: #1a1a1a; --text: #e0e0e0; --text-secondary: #bbb;
  --text-muted: #888; --border: #333; --code-bg: #2d2d2d;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC',
               'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  line-height: 1.75;
  padding: 32px 24px 96px;
}
/* 选择器同时覆盖综述（article.asci-review）与检索报告（article.asci-search-report）：
   两者结构标签一致（h1/h2/section/table/cite），共用一套排版。body 内仅一个 article，
   故内部规则直接挂在 article 后代选择器上。 */
article.asci-review,
article.asci-search-report {
  max-width: 820px;
  margin: 0 auto;
}
article h1 { font-size: 1.8em; margin: 0.4em 0 0.6em; line-height: 1.3; }
article h2 {
  font-size: 1.35em;
  margin: 1.4em 0 0.5em;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.25em;
}
article h3 { font-size: 1.1em; margin: 1em 0 0.4em; }
article p { margin: 0.7em 0; }
article section { margin: 1.5em 0; }
article header { margin-bottom: 1.5em; }
article header .topic {
  color: var(--text-muted);
  font-size: 0.95em;
  margin-top: 0.3em;
}
article ol, article ul { padding-left: 2em; margin: 0.5em 0; }
article li { margin: 0.4em 0; }
article code {
  background: var(--code-bg);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
  font-family: 'SF Mono', Monaco, Menlo, monospace;
}
article pre {
  background: var(--code-bg);
  padding: 12px 16px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 1em 0;
}
article table { border-collapse: collapse; margin: 1em 0; width: 100%; }
article th, article td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
article th { background: var(--code-bg); }
article .evidence-depth-notice {
  background: rgba(253, 230, 138, 0.25);
  border-left: 3px solid #f59e0b;
  padding: 8px 12px;
  margin: 1em 0;
  font-size: 0.92em;
  color: var(--text-secondary);
}

/* —— 角标：与 CitationBadge inline style 完全一致 —— */
.asci-cite-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: baseline;
  margin: 0 2px;
  padding: 0 6px;
  border-radius: 6px;
  background-color: #fde68a;
  color: #78350f;
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s ease;
  text-decoration: none;
}
.asci-cite-badge:hover { background-color: #fcd34d; }
.asci-cite-badge:focus { outline: 2px solid #fcd34d; outline-offset: 1px; }
.asci-cite-badge.is-active {
  background-color: #fcd34d;
  box-shadow: 0 0 0 2px rgba(180, 83, 9, 0.35);
}

/* —— Evidence trace 卡片（与应用内 EvidenceTraceCard 视觉对齐） —— */
.asci-evidence-trace-card {
  margin: 1em 0;
  border: 1px solid rgba(120, 53, 15, 0.18);
  border-radius: 10px;
  background: var(--bg);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
  overflow: hidden;
  font-size: 13px;
  line-height: 1.5;
}
.asci-evidence-trace-card .head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: rgba(253, 230, 138, 0.18);
}
.asci-evidence-trace-card .head .label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--text);
}
.asci-evidence-trace-card .head .label .tag {
  font-weight: 400;
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.asci-evidence-trace-card .head .close {
  appearance: none;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--text-muted);
  padding: 2px 4px;
  font-size: 16px;
  line-height: 1;
  border-radius: 4px;
}
.asci-evidence-trace-card .head .close:hover { color: var(--text); background: rgba(0,0,0,0.04); }
.asci-evidence-trace-card .body {
  padding: 12px 14px 14px;
}
.asci-evidence-trace-card .meta {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.asci-evidence-trace-card .meta .paper {
  font-weight: 500;
  color: var(--text);
}
.asci-evidence-trace-card .quote {
  border-left: 2px solid var(--border);
  padding: 4px 0 4px 12px;
  margin: 0;
  font-style: italic;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
`

// ===========================================================================
// 内嵌 JS：vanilla DOM，与应用内 EvidenceTraceCard 行为对齐
//
// 与应用内的差异：
//   - 卡片只有 × 关闭，没有 "Open full context in Paper" / "Add note here" 按钮
//     （这两者依赖 Library + PDF 联动，离线 HTML 没有运行时支撑）
//   - 没有 hover Tooltip（与应用内 trace 模式一致）
// ===========================================================================
// 注意：本字符串里所有反斜杠都要 escape 一次（TS 模板字符串），所以正则要写 \\s 等
const REVIEW_STANDALONE_JS = `
(function() {
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  function escapeText(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  ready(function() {
    var root = document.querySelector('article.asci-review, article.asci-search-report');
    if (!root) return;
    root.setAttribute('data-asci-citations-root', '1');

    // 1) 解析 §7 References → 元数据 + DOM 锚点
    var refs = new Map();
    var liList = root.querySelectorAll('ol.refs > li[data-ref], section.references li[data-ref], li[id^="ref-"][data-ref]');
    liList.forEach(function(li) {
      var n = parseInt(li.getAttribute('data-ref'), 10);
      if (!Number.isInteger(n) || n <= 0) return;
      var raw = (li.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!raw) return;
      var titleEl = li.querySelector('i, em');
      var title = titleEl ? (titleEl.textContent || '').trim() : '';
      var authors = '', venue = '';
      if (title) {
        var idx = raw.indexOf(title);
        if (idx > 0) authors = raw.slice(0, idx).replace(/[\\s.]+$/, '').trim();
        var after = raw.slice(idx + title.length).replace(/^[\\s.,]+/, '').trim();
        venue = after.replace(/[\\s,(]*(?:19|20)\\d{2}\\)?\\s*\\.?\\s*$/, '').replace(/[\\s.,]+$/, '').trim();
      }
      var years = raw.match(/(?:19|20)\\d{2}/g);
      var year = years && years.length ? years[years.length - 1] : '';
      var doi = li.getAttribute('data-doi') || '';
      if (!refs.has(n)) refs.set(n, { n: n, raw: raw, title: title, authors: authors, venue: venue, year: year, doi: doi });
      li.setAttribute('data-asci-ref-n', String(n));
    });

    // 2) <cite data-ref="N"><q>X</q></cite> → [N] 角标；同时给每个含 cite 的 <p>
    //    追加一个 trace slot 占位 div（卡片渲染目标）。slot 与 paragraphKey 绑定，
    //    多 cite 同段共享同一 slot（同一时间只显示一张卡片）。
    var paragraphSlots = new Map(); // paragraphKey → slot element
    function paragraphKeyFor(p) {
      // 用 section id + section 内 <p> 序号；没 section 用全局 fallback
      var section = p.closest('section');
      var key;
      if (section) {
        var siblings = Array.from(section.querySelectorAll(':scope > p, :scope > div > p'));
        var idx = siblings.indexOf(p);
        key = (section.id || '__nosec__') + '|' + (idx < 0 ? 0 : idx);
      } else {
        var allP = Array.from(root.querySelectorAll('p'));
        key = '__nosec__|' + allP.indexOf(p);
      }
      return key;
    }
    var cites = Array.from(root.querySelectorAll('cite[data-ref]'));
    cites.forEach(function(cite) {
      var n = parseInt(cite.getAttribute('data-ref'), 10);
      if (!Number.isInteger(n)) return;
      var qEl = cite.querySelector('q');
      var quote = qEl ? (qEl.textContent || '').trim() : '';
      var p = cite.closest('p');
      var pKey = p ? paragraphKeyFor(p) : '__no_p__';
      var badge = document.createElement('span');
      badge.className = 'asci-cite-badge';
      badge.setAttribute('role', 'button');
      badge.setAttribute('tabindex', '0');
      badge.setAttribute('data-asci-cite', '1');
      badge.setAttribute('data-cite-n', String(n));
      badge.setAttribute('data-cite-quote', quote);
      badge.setAttribute('data-cite-p-key', pKey);
      badge.textContent = '[' + n + ']';
      cite.replaceWith(badge);
      // 同段第一次见 → 在 <p> 后插 slot
      if (p && !paragraphSlots.has(pKey)) {
        var slot = document.createElement('div');
        slot.setAttribute('data-asci-evidence-trace-slot', '');
        slot.setAttribute('data-asci-p-key', pKey);
        p.after(slot);
        paragraphSlots.set(pKey, slot);
      }
    });

    // 3) KaTeX（CDN 不可达 → 公式以 LaTeX 源码留存）
    if (typeof renderMathInElement === 'function') {
      try {
        renderMathInElement(root, {
          delimiters: [
            { left: '\\\\[', right: '\\\\]', display: true },
            { left: '$$',   right: '$$',   display: true },
            { left: '\\\\(', right: '\\\\)', display: false },
          ],
          throwOnError: false,
        });
      } catch (err) { console.warn('[review-html] KaTeX 渲染失败:', err); }
    }

    // 4) Trace 卡片：click 切换；同时最多一张
    var activeKey = null;       // '<paragraphKey>#<n>#<citeIdxInP>'
    var activeBadge = null;

    function buildPaperLabel(meta, n) {
      if (!meta) return '[' + n + ']';
      var firstAuthor = (meta.authors || '').split(/[,\\s]+/).filter(Boolean)[0] || '';
      var hasMore = (meta.authors || '').indexOf(',') >= 0;
      var tail = firstAuthor ? (firstAuthor + (hasMore ? ' et al.' : '')) : '';
      if (tail && meta.year) return tail + ' ' + meta.year;
      if (tail) return tail;
      if (meta.title) return meta.title;
      return '[' + n + ']';
    }
    function buildPaperSub(meta) {
      if (!meta) return '';
      var parts = [];
      if (meta.venue) parts.push(meta.venue);
      if (meta.doi) parts.push(meta.doi);
      return parts.join(' · ');
    }

    function renderCard(slot, badge) {
      var n = parseInt(badge.getAttribute('data-cite-n') || '', 10);
      var quote = badge.getAttribute('data-cite-quote') || '';
      var meta = refs.get(n);
      var label = buildPaperLabel(meta, n);
      var sub = buildPaperSub(meta);
      var html = '<div class="asci-evidence-trace-card" data-asci-evidence-trace-card>' +
        '<div class="head">' +
          '<div class="label">Evidence trace <span class="tag">EvidenceRef</span></div>' +
          '<button type="button" class="close" aria-label="Close evidence trace">&times;</button>' +
        '</div>' +
        '<div class="body">' +
          '<div class="meta">Source · <span class="paper">' + escapeText(label) + '</span>' +
            (sub ? ' · ' + escapeText(sub) : '') +
          '</div>' +
          (quote ? '<blockquote class="quote">' + escapeText(quote) + '</blockquote>' : '') +
        '</div>' +
      '</div>';
      slot.innerHTML = html;
      var closeBtn = slot.querySelector('.close');
      if (closeBtn) closeBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        clearActive();
      });
    }

    function clearActive() {
      if (activeBadge) activeBadge.classList.remove('is-active');
      activeBadge = null;
      activeKey = null;
      paragraphSlots.forEach(function(slot) { slot.innerHTML = ''; });
    }

    function onBadgeClick(badge) {
      var n = parseInt(badge.getAttribute('data-cite-n') || '', 10);
      if (!Number.isInteger(n)) return;
      var pKey = badge.getAttribute('data-cite-p-key') || '__no_p__';
      // 段内 cite 序号：扫同段 badge 找当前 index
      var sameP = Array.from(root.querySelectorAll('.asci-cite-badge[data-cite-p-key="' + pKey.replace(/"/g, '\\\\"') + '"]'));
      var citeIdx = sameP.indexOf(badge);
      var key = pKey + '#' + n + '#' + citeIdx;
      if (key === activeKey) { clearActive(); return; }
      // 切到新 cite：先清旧的，再渲染新的
      clearActive();
      var slot = paragraphSlots.get(pKey);
      if (!slot) return;
      renderCard(slot, badge);
      activeKey = key;
      activeBadge = badge;
      badge.classList.add('is-active');
    }

    root.addEventListener('click', function(e) {
      var t = e.target.closest && e.target.closest('.asci-cite-badge');
      if (t) {
        e.preventDefault();
        onBadgeClick(t);
        return;
      }
      // 点卡片内不关；点卡片外 / cite 外 → 关闭
      if (activeKey && !(e.target.closest && e.target.closest('[data-asci-evidence-trace-card]'))) {
        clearActive();
      }
    });
    root.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var t = e.target.closest && e.target.closest('.asci-cite-badge');
      if (!t) return;
      e.preventDefault();
      onBadgeClick(t);
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && activeKey) clearActive();
    });
  });
})();
`
