import type { AgentSendInput } from '@asci/shared'
/** 模式为任务意图指令，不替代权限控制。 */
export function taskModePrompt(mode: AgentSendInput['taskMode']): string {
  if (mode === 'search') return '\n\n## Current task mode: General Agent\nHelp with writing, analysis, planning, files and web research. Complete the requested task using relevant tools. Use available search and browsing tools when needed. Cite verifiable source URLs for factual findings and distinguish evidence from inference. Respect the user\'s requested scope and host permission checks for file changes and commands. If search tools are unavailable, state that limitation rather than inventing sources.'
  if (mode === 'coding') return '\n\n## Current task mode: Coding\nFocus on implementing, debugging, and explaining software. Inspect the project before editing, follow its conventions, and verify relevant changes. Use information retrieval when it supports the coding task.'
  return ''
}
