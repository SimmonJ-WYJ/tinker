/**
 * 构造 <zotero-context> 片段给 agent-orchestrator 注入到用户消息前。
 * 纯函数，无 Electron 依赖，便于单测。
 */

export function buildZoteroContextBlock(
  items: Array<{ key: string; title: string; creators: string[]; date?: string }> | undefined,
  collections: Array<{ key: string; name: string; path: string }> | undefined,
): string | null {
  const hasItems = items && items.length > 0
  const hasCols = collections && collections.length > 0
  if (!hasItems && !hasCols) return null

  const lines: string[] = ['<zotero-context>']
  lines.push('用户在本次消息中引用了以下 Zotero 资源。你可以通过 Zotero MCP 服务（如 zotero_search_items / zotero_get_item / zotero_list_collection_items）进一步查询全文或同类目其他条目。')
  lines.push('')

  if (hasItems) {
    lines.push('<mentioned-items>')
    for (const it of items!) {
      const year = it.date?.match(/\d{4}/)?.[0]
      const creators = it.creators.length > 3
        ? `${it.creators.slice(0, 3).join(', ')} et al.`
        : it.creators.join(', ')
      const bylineParts = [creators, year].filter(Boolean)
      const byline = bylineParts.length > 0 ? ` · ${bylineParts.join(' · ')}` : ''
      lines.push(`- key=${it.key} · 《${it.title}》${byline}`)
    }
    lines.push('</mentioned-items>')
  }

  if (hasCols) {
    if (hasItems) lines.push('')
    lines.push('<mentioned-collections>')
    for (const c of collections!) {
      lines.push(`- key=${c.key} · 路径: ${c.path}`)
    }
    lines.push('</mentioned-collections>')
  }

  // 防止 LLM 看到 collection 但没看到具体条目时编造 itemKey 调 zotero_read_attachment：
  // 只要进了 zotero-context，就显式写出"未列出的 itemKey 必须先验证"的硬约束。
  lines.push('')
  lines.push('<itemkey-constraint>')
  if (!hasItems && hasCols) {
    lines.push('注意：仅给出了类目引用，没有具体条目。要读取该类目下文献时，必须先调 zotero_list_collection_items 拿到真实 itemKey 再用；禁止从对话上下文推测/编造 itemKey。')
  } else {
    lines.push('注意：上面 <mentioned-items> 之外的 itemKey 必须先调 zotero_search_items 或 zotero_list_collection_items 验证存在；禁止编造 itemKey 直接调 zotero_read_attachment / zotero_get_item。')
  }
  lines.push('</itemkey-constraint>')

  lines.push('</zotero-context>')
  return lines.join('\n')
}
