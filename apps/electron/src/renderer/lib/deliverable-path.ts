/**
 * 会话「交付产物」(deliverable) 路径判定 —— 用于「文件一生成即在右栏自动预览」。
 *
 * 约定来源：agent-prompt-builder 的「Deliverables」段明确——
 *   产物写在 session cwd 根目录；中间产物 / 持久上下文写 `.context/` 或子目录。
 * 因此「是产物」的结构化判据（无需解析 Agent 文本）：
 *   1. 解析后的绝对路径直接位于 cwd 的下一级（无更深子目录）
 *   2. 文件名非 `.` 开头（排除 `.context/`、`.gitignore` 等隐藏项）
 *   3. 扩展名可预览（md/html/pdf/json/图片/视频…）——避免自动打开不可渲染的二进制
 *
 * 仅做纯字符串判定，不触碰 fs / atom，便于单测。
 */

/** 可在右栏 InlinePreview 内渲染的扩展名（小写，不含点）——与 file-preview 能力对齐 */
export const PREVIEWABLE_DELIVERABLE_EXTS: ReadonlySet<string> = new Set([
  // 文档
  'md', 'markdown', 'html', 'htm', 'pdf', 'docx', 'json', 'xml',
  // 图片
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp',
  // 视频
  'mp4', 'webm', 'mov',
])

/** 统一分隔符为 `/`，并去掉尾部多余分隔符（不动盘符）。 */
function normalizeSeparators(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * 把工具结果里的 file_path 解析为绝对路径：
 * 绝对路径（POSIX `/` 或 Windows 盘符）直接用；相对路径去掉前导 `./` 后拼到 cwd 下。
 * cwd 缺失且为相对路径时原样返回（调用方据此判定不是产物）。
 */
export function resolveAgainstCwd(filePath: string, cwd: string): string {
  const trimmed = filePath.trim()
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) return trimmed
  if (!cwd) return trimmed
  const rel = trimmed.replace(/^\.\//, '')
  return `${normalizeSeparators(cwd)}/${rel}`
}

/** 从文件名取小写扩展名（不含点）；无扩展名返回空串。 */
export function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) return '' // <=0：无点，或以点开头（隐藏文件，无视为扩展名）
  return filename.slice(dot + 1).toLowerCase()
}

/**
 * 判定 `fullPath`（已解析的绝对路径）是否为 `cwd` 根目录下的可预览产物文件。
 * cwd 缺失（空串）时返回 false：无法判定层级，宁可不自动打开。
 */
export function isSessionDeliverable(fullPath: string, cwd: string): boolean {
  if (!fullPath || !cwd) return false
  const base = normalizeSeparators(cwd)
  const full = normalizeSeparators(fullPath)
  const prefix = `${base}/`
  if (!full.startsWith(prefix)) return false

  const rel = full.slice(prefix.length)
  if (!rel || rel.includes('/')) return false // 必须是 cwd 直接下一级（无子目录）

  if (rel.startsWith('.')) return false // 隐藏文件 / .context 等不算产物

  return PREVIEWABLE_DELIVERABLE_EXTS.has(extOf(rel))
}

/**
 * 判定 `fullPath` 是否为「AI 产物文件」——比 isSessionDeliverable 更宽：
 * cwd 内**任意深度**的可预览文件都算（覆盖 `searches/`、`reports/` 等子目录场景），
 * 仅排除隐藏段（任一路径段以 `.` 开头，如 `.context/`）。供对话内**产物卡片**用，
 * 「不分场景」。auto-open 仍用更保守的 isSessionDeliverable（仅 cwd 根）。
 */
export function isArtifactFile(fullPath: string, cwd: string): boolean {
  if (!fullPath || !cwd) return false
  const base = normalizeSeparators(cwd)
  const full = normalizeSeparators(fullPath)
  const prefix = `${base}/`
  if (!full.startsWith(prefix)) return false
  const rel = full.slice(prefix.length)
  if (!rel) return false
  if (rel.split('/').some((seg) => seg.startsWith('.'))) return false // 隐藏段（.context 等）不算产物
  return PREVIEWABLE_DELIVERABLE_EXTS.has(extOf(rel))
}

/** 匹配文本中疑似文件名 token 的正则（含 .ext 的路径片段；不含空格） */
const PATH_TOKEN_RE = /(?:\.?\/)?[\w.@/-]+\.[A-Za-z0-9]+/g

/**
 * 从 Agent 消息文本提取**产物卡片**应展示的文件绝对路径（不分场景，含子目录）。
 * 扫描疑似路径 token，解析到 cwd 后取第一个命中 isArtifactFile 的；无则 null。
 */
export function extractArtifactReference(text: string, cwd: string): string | null {
  if (!text || !cwd) return null
  const matches = text.match(PATH_TOKEN_RE)
  if (!matches) return null
  for (const raw of matches) {
    const full = resolveAgainstCwd(raw, cwd)
    if (isArtifactFile(full, cwd)) return full
  }
  return null
}

/**
 * 从一段 Agent 消息文本里提取「会话产物」的绝对路径（用于在消息末尾渲染产物卡片）。
 * 扫描所有疑似文件路径 token，解析到 cwd 后取**第一个**命中 isSessionDeliverable 的；无则返回 null。
 * 仅纯字符串处理，便于单测。
 */
export function extractDeliverablePath(text: string, cwd: string): string | null {
  if (!text || !cwd) return null
  const matches = text.match(PATH_TOKEN_RE)
  if (!matches) return null
  for (const raw of matches) {
    const full = resolveAgainstCwd(raw, cwd)
    if (isSessionDeliverable(full, cwd)) return full
  }
  return null
}

/** 产物类型标签 key（用于 i18n `conversation:artifactCard.type.<key>` 与图标选择） */
export type DeliverableTypeKey = 'website' | 'markdown' | 'pdf' | 'document' | 'image' | 'data' | 'file'

/** 由扩展名推断产物类型标签 key */
export function deliverableTypeKey(ext: string): DeliverableTypeKey {
  const e = ext.toLowerCase()
  if (e === 'html' || e === 'htm') return 'website'
  if (e === 'md' || e === 'markdown') return 'markdown'
  if (e === 'pdf') return 'pdf'
  if (e === 'docx') return 'document'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(e)) return 'image'
  if (e === 'json' || e === 'xml') return 'data'
  return 'file'
}

/**
 * 从 markdown / 文本内容提取「有意义的标题」：优先 frontmatter `title:`，其次首个 `# H1`。
 * 取不到返回 null（调用方回退文件名）。
 */
export function extractTitleFromMarkdown(content: string): string | null {
  if (!content) return null
  const fm = content.match(/^﻿?---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/)
  if (fm) {
    const titleLine = fm[1]!.match(/^title:\s*(.+?)\s*$/m)
    if (titleLine) {
      const v = titleLine[1]!.replace(/^["']|["']$/g, '').trim()
      if (v) return v
    }
  }
  const body = fm ? content.slice(fm[0].length) : content
  const h1 = body.match(/^#\s+(.+?)\s*#*\s*$/m)
  if (h1) {
    const v = h1[1]!.trim()
    if (v) return v
  }
  return null
}
