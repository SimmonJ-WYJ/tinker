/**
 * 工具活动项的可复用工具函数和常量
 * 从 ToolActivityItem.tsx 中提取，供多处复用
 */

import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  Bot,
  CalendarClock,
  CalendarDays,
  CalendarX,
  ClipboardList,
  Database,
  Download,
  FilePenLine,
  SquareCheck,
  FileSearch,
  FileText,
  FolderSearch,
  GitBranch,
  Globe,
  ImagePlus,
  Layers,
  List,
  ListChecks,
  LogIn,
  LogOut,
  Map,
  MapPinOff,
  MessageCircleQuestion,
  OctagonX,
  Pencil,
  Plug,
  Radio,
  Search,
  Send,
  Server,
  Terminal,
  UserMinus,
  Users,
  Wrench,
  Zap,
} from 'lucide-react'

/** 工具名称到图标组件的映射 */
export const TOOL_ICONS: Record<string, LucideIcon> = {
  Edit: Pencil,
  Write: FilePenLine,
  Read: FileText,
  Bash: Terminal,
  Glob: FolderSearch,
  Grep: Search,
  Task: GitBranch,
  WebFetch: Download,
  WebSearch: Globe,
  NotebookEdit: BookOpen,
  Skill: Zap,
  TodoWrite: ListChecks,
  TodoRead: ClipboardList,
  TaskCreate: SquareCheck,
  TaskUpdate: ListChecks,
  TaskGet: FileSearch,
  TaskList: List,
  TeamCreate: Users,
  TeamDelete: UserMinus,
  Agent: Bot,
  EnterPlanMode: Map,
  ExitPlanMode: MapPinOff,
  generate_image: ImagePlus,
  TaskOutput: Layers,
  TaskStop: OctagonX,
  AskUserQuestion: MessageCircleQuestion,
  CronCreate: CalendarClock,
  CronDelete: CalendarX,
  CronList: CalendarDays,
  RemoteTrigger: Radio,
  EnterWorktree: LogIn,
  ExitWorktree: LogOut,
  ReadMcpResourceTool: Database,
  ListMcpResourcesTool: Server,
  SendMessage: Send,
}

/**
 * 根据工具名称获取对应的图标组件
 * MCP 工具（mcp__serverName__toolName）使用 Plug 图标
 * 未匹配时返回默认的 Wrench 图标
 */
export function getToolIcon(toolName: string): LucideIcon {
  if (TOOL_ICONS[toolName]) return TOOL_ICONS[toolName]
  if (toolName.startsWith('mcp__')) return Plug
  return Wrench
}

/**
 * 从工具输入参数中提取文件路径
 * 按优先级依次检查常见的路径字段名
 */
export function extractFilePath(
  input: Record<string, unknown>
): string | null {
  const value =
    input.file_path ?? input.filePath ?? input.path ?? input.notebook_path
  if (typeof value === 'string') {
    return value
  }
  return null
}

/**
 * 计算 Edit 工具的差异统计（新增/删除行数）
 * 仅对 Edit 工具有效，其他工具返回 null
 */
export function computeDiffStats(
  toolName: string,
  input: Record<string, unknown>
): { additions: number; deletions: number } | null {
  if (toolName !== 'Edit') {
    return null
  }

  const oldString = input.old_string
  const newString = input.new_string

  if (typeof oldString !== 'string' || typeof newString !== 'string') {
    return null
  }

  const oldLines = oldString ? oldString.split('\n').length : 0
  const newLines = newString ? newString.split('\n').length : 0

  return {
    additions: newLines,
    deletions: oldLines,
  }
}

/**
 * 将秒数格式化为可读的耗时字符串
 * 60 秒以内显示 "X.Xs"，超过 60 秒显示 "Xm Ys"
 */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}

/** 文件扩展名到语言标识的映射 */
const EXT_LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  json: 'json',
  jsonl: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  mdx: 'mdx',
  sql: 'sql',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  fish: 'shellscript',
  ps1: 'powershell',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  lua: 'lua',
  r: 'r',
  scala: 'scala',
  dart: 'dart',
  vue: 'vue',
  svelte: 'svelte',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'protobuf',
  env: 'shellscript',
  ini: 'ini',
  conf: 'ini',
  cfg: 'ini',
}

/**
 * 根据文件路径推断语法高亮语言标识
 * 返回 Shiki 可识别的语言 ID，未知扩展名返回 'text'
 */
export function inferLanguageFromPath(filePath: string): string {
  const basename = filePath.split('/').pop() ?? filePath
  // 处理无扩展名的特殊文件
  const lowerBasename = basename.toLowerCase()
  if (lowerBasename === 'dockerfile') return 'dockerfile'
  if (lowerBasename === 'makefile' || lowerBasename === 'gnumakefile') return 'makefile'
  if (lowerBasename.startsWith('.env')) return 'shellscript'

  const dotIndex = basename.lastIndexOf('.')
  if (dotIndex === -1) return 'text'
  const ext = basename.slice(dotIndex + 1).toLowerCase()
  return EXT_LANGUAGE_MAP[ext] ?? 'text'
}
