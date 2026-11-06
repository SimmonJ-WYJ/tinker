import {
  GIT_READONLY_PATTERN,
  PACKAGE_READONLY_PATTERNS,
  SAFE_TOOLS,
  SIMPLE_READONLY_PATTERNS,
} from './permission-rules'

export type HardRuleAction = 'allow' | 'ask' | 'defer' | 'deny'

export interface HardRuleDecision {
  action: HardRuleAction
  ruleId: string
  reason: string
}

export interface HardRuleContext {
  cwd: string
  workspaceRoot: string
  homeDir: string
}

const HARD_SAFE_TOOLS = new Set<string>(SAFE_TOOLS)

const COMPOUND_STRUCTURE_RE = /[;&]|>{1,2}|\$\(|`|\|/
const COMPOUND_DANGEROUS_RE = /\b(rm|rmdir|mv|cp|chmod|chown|dd|kill|killall|pkill|sudo|su|ssh|scp|curl|wget)\b/i

function stripTrailingSlash(path: string): string {
  return path.replace(/\/+$/, '')
}

const decision = (action: HardRuleAction, ruleId: string, reason: string): HardRuleDecision => ({
  action,
  ruleId,
  reason,
})

export function normalizeBashCommandForPermission(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

function shellPathAlternatives(path: string): string[] {
  const normalized = path.replace(/\/+$/, '') || '/'
  return [
    normalized,
    `"${normalized}"`,
    `'${normalized}'`,
  ]
}

function containsHomeDeletion(command: string, ctx: HardRuleContext): boolean {
  const homeTargets = [
    '$HOME',
    '${HOME}',
    '~',
    ...shellPathAlternatives(ctx.homeDir),
  ]

  return homeTargets.some((target) => {
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\brm\\s+[^\\n]*${escaped}(?:\\s|$)`).test(command)
  })
}

function stripAllowedNullRedirects(command: string): string {
  return command
    .replace(/\s+(?:[12])?>\s*\/dev\/null\b/g, '')
    .replace(/\s+2>&1\b/g, '')
    .trim()
}

function stripSafeCommandSubstitutions(command: string): string | null {
  if (command.includes('`')) return null
  if (!command.includes('$(')) return command
  let next = command
  for (let i = 0; i < 10; i += 1) {
    const prev = next
    next = next
      .replace(/\$\(\s*pwd\s*\)/g, 'SUBST')
      .replace(/\$\(\s*basename\s+(?:"SUBST"|'SUBST'|SUBST|["'][^"']+["']|[^\s)]+)\s*\)/g, 'SUBST')
      .replace(/\$\(\s*cd\s+(?:"[^"]*"|'[^']*'|[^\s)]+)\s*&&\s*pwd\s*\)/g, 'SUBST')
    if (next === prev) break
    if (!next.includes('$(')) return next
  }
  return next.includes('$(') ? null : next
}

function stripEnvAssignments(segment: string): string {
  let rest = segment.trim()
  for (let i = 0; i < 20; i += 1) {
    const next = rest.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s;&|<>`$()]+)\s*/, '').trim()
    if (next === rest) break
    rest = next
  }
  return rest
}

function isSafeFindCommand(segment: string, ctx: HardRuleContext): boolean {
  if (/\s-(?:exec|delete)(?:\s|$)/i.test(segment)) return false

  const tokens = segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  const roots: string[] = []
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i]!
    if (token.startsWith('-')) break
    roots.push(token)
  }
  const explicitRoots = roots.length > 0 ? roots : ['.']

  const cwdBase = stripTrailingSlash(ctx.cwd)
  const workspaceBase = stripTrailingSlash(ctx.workspaceRoot)
  const asciHomeBase = `${stripTrailingSlash(ctx.homeDir)}/.asci`

  return explicitRoots.every((rawRoot) => {
    const root = rawRoot.replace(/^["']|["']$/g, '')
    return (
      root === '.' ||
      root.startsWith('./') ||
      root.startsWith('~/.asci') ||
      root.startsWith(cwdBase) ||
      root.startsWith(workspaceBase) ||
      root.startsWith(asciHomeBase)
    )
  })
}

function isSafeReadonlySegment(segment: string, ctx: HardRuleContext): boolean {
  const rest = stripEnvAssignments(segment)
  if (!rest) return true

  const lower = rest.toLowerCase()
  if (GIT_READONLY_PATTERN.test(lower)) return true
  if (
    SIMPLE_READONLY_PATTERNS.some((pattern) => pattern.test(lower)) ||
    PACKAGE_READONLY_PATTERNS.some((pattern) => pattern.test(lower))
  ) {
    return true
  }

  if (/^command\s+-v\s+[A-Za-z0-9._+-]+$/.test(rest)) return true
  if (/^[A-Za-z0-9._+-]+\s+--version$/.test(rest)) return true
  if (/^echo\s+(?:"[^"`$()<>]*"|'[^'`$()<>]*'|[^;&|<>`$()]*)$/.test(rest)) return true
  if (/^find\b/.test(lower)) return isSafeFindCommand(rest, ctx)
  if (/^(sed\s+-n|cut|sort|uniq)\b/.test(lower)) return true

  return false
}

function isSafeReadonlyCompoundBash(command: string, ctx: HardRuleContext): boolean {
  const withoutRedirects = stripAllowedNullRedirects(command)
  if (/>/.test(withoutRedirects)) return false

  const substituted = stripSafeCommandSubstitutions(withoutRedirects)
  if (!substituted) return false

  if (COMPOUND_DANGEROUS_RE.test(substituted)) return false

  const segments = substituted
    .split(/\s*(?:;|&&|\|\||\|)\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean)

  return segments.length > 0 && segments.every((segment) => isSafeReadonlySegment(segment, ctx))
}

function evaluateBash(commandInput: unknown, ctx: HardRuleContext): HardRuleDecision {
  const command = typeof commandInput === 'string'
    ? normalizeBashCommandForPermission(commandInput)
    : ''
  const lower = command.toLowerCase()

  if (/^rm\s+.*--no-preserve-root\s+.*\/(?:\s|$)/.test(lower) || /^rm\s+.*(?:\s|^)\/(?:\s|$)/.test(lower)) {
    return decision('deny', 'bash.deny.rm-root', 'Deleting the filesystem root is blocked by ASCI hard rules')
  }

  if (containsHomeDeletion(command, ctx)) {
    return decision('deny', 'bash.deny.rm-home', 'Deleting the home directory is blocked by ASCI hard rules')
  }

  if (/:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/.test(command)) {
    return decision('deny', 'bash.deny.fork-bomb', 'Fork bomb pattern is blocked by ASCI hard rules')
  }

  if (/^git\s+push\b/.test(lower)) {
    return decision('ask', 'bash.ask.git-push', 'Pushing to a remote repository requires confirmation')
  }

  if (/^git\s+reset\s+--hard\b/.test(lower)) {
    return decision('ask', 'bash.ask.git-reset-hard', 'Hard git reset requires confirmation')
  }

  if (/^rm\s+/.test(lower) || /^rmdir\s+/.test(lower)) {
    return decision('ask', 'bash.ask.rm', 'File deletion requires confirmation')
  }

  if (/\b(curl|wget)\b[\s\S]*\|[\s\S]*\b(?:sh|bash|zsh|fish)\b/.test(lower)) {
    return decision('ask', 'bash.ask.pipe-shell', 'Piping downloaded content into a shell requires confirmation')
  }

  if (/\bfind\b[\s\S]*\s-delete(?:\s|$)/.test(lower)) {
    return decision('ask', 'bash.ask.find-delete', 'find -delete requires confirmation')
  }

  if (/\bfind\b[\s\S]*\s-exec(?:\s|$)/.test(lower)) {
    return decision('ask', 'bash.ask.find-exec', 'find -exec requires confirmation')
  }

  if (/\bsudo\b|\bsu\b/.test(lower)) {
    return decision('ask', 'bash.ask.privilege-escalation', 'Privilege escalation requires confirmation')
  }

  if (COMPOUND_STRUCTURE_RE.test(command)) {
    return isSafeReadonlyCompoundBash(command, ctx)
      ? decision('allow', 'bash.allow.readonly-compound', 'Read-only compound shell command is allowed by ASCI hard rules')
      : decision('ask', 'bash.ask.dangerous-structure', 'Shell control structures require confirmation')
  }

  if (GIT_READONLY_PATTERN.test(lower)) {
    return decision('allow', 'bash.allow.git-readonly', 'Read-only git command is allowed by ASCI hard rules')
  }

  if (
    SIMPLE_READONLY_PATTERNS.some((pattern) => pattern.test(lower)) ||
    PACKAGE_READONLY_PATTERNS.some((pattern) => pattern.test(lower))
  ) {
    return decision('allow', 'bash.allow.readonly', 'Simple read-only shell command is allowed by ASCI hard rules')
  }

  return decision('defer', 'bash.defer.unclassified', 'Bash command is not covered by ASCI hard rules')
}

export function evaluateHardRule(
  toolName: string,
  input: Record<string, unknown>,
  ctx: HardRuleContext,
): HardRuleDecision {
  if (toolName === 'Bash') {
    return evaluateBash(input.command, ctx)
  }

  if (HARD_SAFE_TOOLS.has(toolName)) {
    return decision('allow', 'tool.allow.safe', 'Safe tool is allowed by ASCI hard rules')
  }

  return decision('defer', 'tool.defer.unclassified', 'Tool is not covered by ASCI hard rules')
}
