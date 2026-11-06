/**
 * 工具语义化短语生成器
 *
 * 将工具名 + 输入参数合成为一句连贯、可读的短语，
 * 用于工具活动行的收起态展示和 Loading 态展示。
 *
 * 文案统一走 i18n（conversation.tool.*），调用方传入 t 函数，
 * 让中英文 UI 都能拿到符合当前语言的短语。
 */

import type { TFunction } from 'i18next'
import { computeDiffStats } from './tool-utils'

/** 翻译函数：来自 useT('conversation') 的 t；命名空间锁定 'conversation' */
export type Translator = TFunction<'conversation'>

/** 工具短语 */
export interface ToolPhrase {
  /** 完成态/收起态短语 */
  label: string
  /** Loading 态短语 */
  loadingLabel: string
}

/** 从路径中提取文件名 */
function filename(path: string): string {
  return path.split('/').pop() ?? path
}

/** 截断文本 */
function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

/**
 * 根据工具名和输入参数生成语义化短语
 */
export function getToolPhrase(toolName: string, input: Record<string, unknown>, t: Translator): ToolPhrase {
  // i18next 严格类型对模板字符串 key 不友好；这里走 any 通道，
  // 资源的存在性由 key-parity 测试 + 单元测试覆盖。
  const tx = t as unknown as (key: string, vars?: Record<string, unknown>) => string
  const phrase = (label: string): ToolPhrase => ({
    label,
    loadingLabel: tx('tool.loadingPrefix', { label }),
  })
  const T = (key: string, vars?: Record<string, unknown>) => tx(`tool.label.${key}`, vars)

  switch (toolName) {
    case 'Read': {
      const fp = input.file_path ?? input.filePath
      if (typeof fp === 'string') {
        const name = filename(fp)
        const offset = typeof input.offset === 'number' ? input.offset : undefined
        const limit = typeof input.limit === 'number' ? input.limit : undefined
        if (offset !== undefined && limit !== undefined) {
          return phrase(T('readLines', { name, from: offset, to: offset + limit }))
        }
        if (offset !== undefined) {
          return phrase(T('readFromLine', { name, from: offset }))
        }
        return phrase(T('read', { name }))
      }
      return phrase(T('readFile'))
    }

    case 'Edit': {
      const fp = input.file_path ?? input.filePath
      const hasName = typeof fp === 'string'
      const name = hasName ? filename(fp as string) : ''
      const diff = computeDiffStats('Edit', input)
      if (hasName && diff) {
        const parts: string[] = []
        if (diff.additions > 0) parts.push(`+${diff.additions}`)
        if (diff.deletions > 0) parts.push(`-${diff.deletions}`)
        return phrase(T('editWithDiff', { name, diff: parts.join(' ') }))
      }
      if (hasName) return phrase(T('edit', { name }))
      return phrase(T('editFile'))
    }

    case 'Write': {
      const fp = input.file_path ?? input.filePath
      const hasName = typeof fp === 'string'
      const name = hasName ? filename(fp as string) : ''
      const content = input.content
      if (hasName && typeof content === 'string' && content.length > 0) {
        const lines = content.split('\n').length
        return phrase(T('write', { name, lines }))
      }
      if (hasName) return phrase(T('writeNoLines', { name }))
      return phrase(T('writeFile'))
    }

    case 'Bash': {
      const cmd = input.command
      if (typeof cmd === 'string') {
        return phrase(T('bash', { cmd: truncate(cmd, 80) }))
      }
      return phrase(T('bashFallback'))
    }

    case 'Grep': {
      const pattern = input.pattern
      if (typeof pattern === 'string') {
        const parts = [T('grepWith', { pattern })]
        const path = input.path
        const glob = input.glob
        if (typeof glob === 'string') {
          parts.push(`in ${glob}`)
        } else if (typeof path === 'string') {
          parts.push(`in ${path}`)
        }
        return phrase(parts.join(' '))
      }
      return phrase(T('grepFallback'))
    }

    case 'Glob': {
      const pattern = input.pattern
      if (typeof pattern === 'string') {
        const parts = [T('globWith', { pattern })]
        const path = input.path
        if (typeof path === 'string') {
          parts.push(`in ${path}`)
        }
        return phrase(parts.join(' '))
      }
      return phrase(T('globFallback'))
    }

    case 'WebFetch': {
      const url = input.url
      if (typeof url === 'string') {
        return phrase(T('webFetch', { url: truncate(url, 60) }))
      }
      return phrase(T('webFetchFallback'))
    }

    case 'WebSearch': {
      const query = input.query
      if (typeof query === 'string') {
        return phrase(T('webSearch', { query: truncate(query, 60) }))
      }
      return phrase(T('webSearchFallback'))
    }

    case 'Skill': {
      const skill = input.skill
      if (typeof skill === 'string') {
        return phrase(T('skillUse', { skill }))
      }
      return phrase(T('skillUseFallback'))
    }

    case 'NotebookEdit': {
      const fp = input.notebook_path
      if (typeof fp === 'string') {
        return phrase(T('notebookEdit', { name: filename(fp) }))
      }
      return phrase(T('notebookEditFallback'))
    }

    case 'Task': {
      const desc = input.description ?? input.prompt
      if (typeof desc === 'string') {
        return phrase(T('task', { desc: truncate(desc, 80) }))
      }
      return phrase(T('taskFallback'))
    }

    case 'Agent': {
      const name = input.name
      const desc = input.description ?? input.prompt
      if (typeof name === 'string' && typeof desc === 'string') {
        return phrase(T('agentWithNameDesc', { name, desc: truncate(desc, 60) }))
      }
      if (typeof desc === 'string') return phrase(T('agentWithDesc', { desc: truncate(desc, 80) }))
      if (typeof name === 'string') return phrase(T('agentWithName', { name }))
      return phrase(T('agentFallback'))
    }

    case 'TaskCreate': {
      const subject = input.subject
      if (typeof subject === 'string') {
        return phrase(T('taskCreate', { subject: truncate(subject, 80) }))
      }
      return phrase(T('taskCreateFallback'))
    }

    case 'TaskUpdate': {
      // TaskUpdate 是自描述工具，label 即完整语义
      const parts: string[] = []
      if (typeof input.taskId === 'string') parts.push(tx('tool.taskHash', { id: input.taskId }))
      if (typeof input.status === 'string') {
        parts.push(tx(`tool.taskStatus.${input.status}`) || input.status)
      }
      if (typeof input.subject === 'string') parts.push(truncate(input.subject, 60))
      if (parts.length > 0) return phrase(parts.join(' '))
      return phrase(T('taskUpdateFallback'))
    }

    case 'TaskGet': {
      const taskId = input.taskId
      if (typeof taskId === 'string') return phrase(T('taskGet', { id: taskId }))
      return phrase(T('taskGetFallback'))
    }

    case 'TaskList': {
      return phrase(T('taskList'))
    }

    case 'TodoWrite': {
      const todos = input.todos
      if (Array.isArray(todos)) {
        return phrase(T('todoWrite', { count: todos.length }))
      }
      return phrase(T('todoWriteFallback'))
    }

    case 'TodoRead': {
      return phrase(T('todoRead'))
    }

    case 'TeamCreate': {
      const name = input.team_name
      if (typeof name === 'string') return phrase(T('teamCreate', { name }))
      return phrase(T('teamCreateFallback'))
    }

    case 'TeamDelete': {
      const name = input.team_name
      if (typeof name === 'string') return phrase(T('teamDelete', { name }))
      return phrase(T('teamDeleteFallback'))
    }

    case 'EnterPlanMode': {
      return phrase(T('enterPlanMode'))
    }

    case 'ExitPlanMode': {
      return phrase(T('exitPlanMode'))
    }

    case 'generate_image': {
      const prompt = input.prompt
      if (typeof prompt === 'string') return phrase(T('generateImage', { prompt: truncate(prompt, 60) }))
      return phrase(T('generateImageFallback'))
    }

    case 'TaskOutput': {
      const taskId = input.task_id ?? input.taskId
      if (typeof taskId === 'string') return phrase(T('taskOutput', { id: taskId }))
      return phrase(T('taskOutputFallback'))
    }

    case 'TaskStop': {
      const taskId = input.task_id ?? input.taskId
      if (typeof taskId === 'string') return phrase(T('taskStop', { id: taskId }))
      return phrase(T('taskStopFallback'))
    }

    case 'AskUserQuestion': {
      const questions = input.questions
      if (Array.isArray(questions) && questions.length > 0) {
        const first = questions[0] as Record<string, unknown>
        if (typeof first.question === 'string') {
          return phrase(T('askUser', { question: truncate(first.question, 60) }))
        }
      }
      return phrase(T('askUserFallback'))
    }

    case 'CronCreate': {
      const cron = input.cron
      const prompt = input.prompt
      if (typeof cron === 'string' && typeof prompt === 'string') {
        return phrase(T('cronCreateWithPrompt', { cron, prompt: truncate(prompt, 40) }))
      }
      if (typeof cron === 'string') return phrase(T('cronCreate', { cron }))
      return phrase(T('cronCreateFallback'))
    }

    case 'CronDelete': {
      const id = input.id
      if (typeof id === 'string') return phrase(T('cronDelete', { id }))
      return phrase(T('cronDeleteFallback'))
    }

    case 'CronList': {
      return phrase(T('cronList'))
    }

    case 'RemoteTrigger': {
      const action = input.action
      const triggerId = input.trigger_id
      const actionLabel = typeof action === 'string'
        ? (tx(`tool.remoteAction.${action}`) || action)
        : undefined
      if (actionLabel && typeof triggerId === 'string') {
        return phrase(T('remoteTriggerWithId', { action: actionLabel, id: triggerId }))
      }
      if (actionLabel) return phrase(T('remoteTrigger', { action: actionLabel }))
      return phrase(T('remoteTriggerFallback'))
    }

    case 'EnterWorktree': {
      const name = input.name
      if (typeof name === 'string') return phrase(T('enterWorktree', { name }))
      return phrase(T('enterWorktreeFallback'))
    }

    case 'ExitWorktree': {
      const action = input.action
      if (action === 'remove') return phrase(T('exitWorktreeRemove'))
      return phrase(T('exitWorktreeKeep'))
    }

    case 'ReadMcpResourceTool': {
      const server = input.server
      const uri = input.uri
      if (typeof server === 'string' && typeof uri === 'string') {
        return phrase(T('readMcpResourceFull', { server, uri: truncate(uri, 40) }))
      }
      if (typeof uri === 'string') return phrase(T('readMcpResourceUri', { uri: truncate(uri, 60) }))
      return phrase(T('readMcpResourceFallback'))
    }

    case 'ListMcpResourcesTool': {
      const server = input.server
      if (typeof server === 'string') return phrase(T('listMcpResources', { server }))
      return phrase(T('listMcpResourcesFallback'))
    }

    case 'SendMessage': {
      const to = input.to
      if (typeof to === 'string') return phrase(T('sendMessageTo', { to }))
      return phrase(T('sendMessage'))
    }

    default: {
      // MCP 工具：mcp__serverName__toolName
      const mcpParts = toolName.split('__')
      if (mcpParts[0] === 'mcp' && mcpParts.length >= 3 && mcpParts[1]) {
        const server = mcpParts[1].toUpperCase()
        const tool = mcpParts.slice(2).join('_')
        const summary = extractFirstMeaningfulValue(input)
        if (summary) {
          return phrase(T('mcpWithSummary', { server, tool, summary: truncate(summary, 60) }))
        }
        return phrase(T('mcp', { server, tool }))
      }
      // 未知工具
      const summary = extractFirstMeaningfulValue(input)
      if (summary) {
        return phrase(T('unknownWithSummary', { tool: toolName, summary: truncate(summary, 60) }))
      }
      return phrase(T('unknown', { tool: toolName }))
    }
  }
}

/** 从 input 中提取第一个有意义的字符串值作为摘要 */
function extractFirstMeaningfulValue(input: Record<string, unknown>): string | null {
  // 优先检查常见的描述性字段
  const priorityKeys = ['description', 'prompt', 'query', 'command', 'name', 'subject', 'path', 'file_path', 'url']
  for (const key of priorityKeys) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  // 回退到第一个非下划线开头的字符串值
  for (const [key, value] of Object.entries(input)) {
    if (!key.startsWith('_') && typeof value === 'string' && value.length > 0 && value.length < 200) {
      return value
    }
  }
  return null
}
