/**
 * 从消息文本里抽取 Zotero mention 的 key。
 * - @zotero-item:<key>
 * - @zotero-col:<key>
 * 结果保序且去重。
 */

function extractUnique(text: string, re: RegExp): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(re)) {
    const raw = m[1]
    if (!raw) continue
    // 形如 "KEY|encodedLabel"，取 | 前的 KEY
    const key = raw.split('|')[0]
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

export function extractZoteroItemKeys(text: string): string[] {
  return extractUnique(text, /@zotero-item:(\S+)/g)
}

export function extractZoteroCollectionKeys(text: string): string[] {
  return extractUnique(text, /@zotero-col:(\S+)/g)
}

/** 抽取 @evidence-set:<id>|<label> 里的证据集 id（保序去重，去掉 |label 后缀）。 */
export function extractEvidenceSetIds(text: string): string[] {
  return extractUnique(text, /@evidence-set:(\S+)/g)
}

/** 匹配各类 mention token（与聊天输入/消息渲染同口径）：
 *  @<type>:<val>（file/dir/zotero-item/zotero-col/evidence-set）、/skill:<slug>、#mcp:<name>。 */
const MENTION_HUMANIZE_RE =
  /@(zotero-item|zotero-col|evidence-set|file|dir):(\S+)|\/(skill):(\S+)|#(mcp):(\S+)/g

/**
 * 把文本里的 @提及 token 替换成可读名（纯字符串变换，无需查 DB）。
 *
 * 显示名已编码在 token 内（序列化时 `encodeURIComponent(label)`，见 AgentView 发送逻辑）：
 *   - zotero-item / zotero-col / evidence-set：取 `KEY|encodedName` 的 name 段 decode → `@<名>`
 *   - file / dir：取路径 basename → `@<文件名>`
 *   - skill / mcp：保留原前缀 + slug/name（无编码）
 * 边界：无 `|name` 段的旧 token → 回退显示 KEY；decode 失败 → 保留原串。
 *
 * 用途：会话证据快照「问题」段的可读化展示（answer 段已由 MessageResponse 渲染成 chip）。
 */
export function humanizeMentions(text: string): string {
  return text.replace(
    MENTION_HUMANIZE_RE,
    (full, atType, atVal, _skillKw, skillVal, _mcpKw, mcpVal) => {
      if (atType) {
        const val = atVal as string
        if (atType === 'file' || atType === 'dir') {
          return `@${val.split('/').pop() || val}`
        }
        // zotero-item / zotero-col / evidence-set：KEY|encodeURIComponent(name)
        const pipe = val.indexOf('|')
        if (pipe < 0) return `@${val}` // 旧 token 无 name 段 → 显示 KEY
        const encoded = val.slice(pipe + 1)
        try {
          return `@${decodeURIComponent(encoded)}`
        } catch {
          return `@${encoded}`
        }
      }
      if (skillVal) return `/${skillVal}`
      if (mcpVal) return `#${mcpVal}`
      return full
    },
  )
}
