/**
 * 把消息文本里的 @ mention 全部替换成可读形式，供 autoGenerateTitle 截断前使用。
 *
 * 显示规则与 message.tsx 的 MentionChip 保持一致：
 *   @file:path/to/foo.pdf       → foo.pdf
 *   @dir:path/to/searches       → searches
 *   /skill:foo                  → foo
 *   #mcp:bar                    → bar
 *   @zotero-item:KEY|encoded    → decodeURIComponent(encoded)
 *   @zotero-col:KEY|encoded     → decodeURIComponent(encoded)
 *   @evidence-set:ID|encoded    → decodeURIComponent(encoded)
 *   无 |label 的旧格式          → 回退到 KEY
 *
 * 不复用 message.tsx 的正则常量是为避免主进程依赖渲染层文件。
 */
const MENTION_PATTERN = /@file:(\S+)|@dir:(\S+)|\/skill:(\S+)|#mcp:(\S+)|@zotero-item:(\S+)|@zotero-col:(\S+)|@evidence-set:(\S+)/g

export function humanizeMessageForTitle(text: string): string {
  const content = text.includes('<attached_files>') ? text.replace(/<attached_files>[\s\S]*?<\/attached_files>/g, '').trim() : text
  return content.replace(
    MENTION_PATTERN,
    (match, file, dir, skill, mcp, zoteroItem, zoteroCol, evidenceSet) => {
      if (file) return file.split('/').pop() || file
      if (dir) return dir.split('/').pop() || dir
      if (skill) return skill
      if (mcp) return mcp
      const value = zoteroItem || zoteroCol || evidenceSet
      if (!value) return match
      const pipeIdx = value.indexOf('|')
      if (pipeIdx > 0) {
        const encoded = value.slice(pipeIdx + 1)
        try {
          return decodeURIComponent(encoded)
        } catch {
          return encoded
        }
      }
      return value
    },
  )
}
