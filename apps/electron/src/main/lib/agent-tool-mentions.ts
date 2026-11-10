/** 工作区 plugin namespace 是 SDK 兼容契约；注册与显式 skill 引用共用。 */
export function getWorkspacePluginName(workspaceSlug: string): string {
  return `asci-workspace-${workspaceSlug}`
}

export function buildToolMentionContext(message: string, workspaceSlug: string | undefined, skills: readonly string[] = [], servers: readonly string[] = []): string {
  if (!skills.length && !servers.length) return message
  const lines = ['The user explicitly selected these capabilities for this task:']
  for (const slug of skills) lines.push(`- Skill: ${workspaceSlug ? `${getWorkspacePluginName(workspaceSlug)}:${slug}` : slug}`)
  for (const name of servers) lines.push(`- MCP server: ${name}`)
  return `<mentioned_tools>\n${lines.join('\n')}\n</mentioned_tools>\n\n${message}`
}
