// journal 检索源的 MCP 子进程环境变量构造。
// 把主进程持有的 OPENSCI access token 与 ASCI-Server base URL 转成 paper-search-mcp
// 能识别的 env（PAPER_SEARCH_MCP_ 前缀）。无 token 时返回空，journal 连接器据
// requires_key 门控不会激活。纯函数，无 I/O，便于单测。

/** 构造 journal 源注入用的 MCP env；无有效 token 时返回空对象。 */
export function buildJournalMcpEnv(
  token: string | null,
  asciServerBaseUrl: string,
): Record<string, string> {
  if (!token) return {}
  const base = asciServerBaseUrl.endsWith('/') ? asciServerBaseUrl : `${asciServerBaseUrl}/`
  return {
    PAPER_SEARCH_MCP_JOURNAL_ACCESS_TOKEN: token,
    PAPER_SEARCH_MCP_JOURNAL_BASE_URL: `${base}journal`,
  }
}
