/**
 * PythonDependencyResolver — 解析 default-skill 的 Python 依赖列表
 *
 * 优先级：requirements.txt > pyproject.toml > SKILL.md uv pip install 行
 *
 * 解析规则：
 *   - requirements.txt：行级，跳过空行/注释
 *   - pyproject.toml：仅抓 [project].dependencies 数组（PEP 621 最小子集）
 *   - SKILL.md：找首个 ```bash``` 代码块里的 uv pip install <args...>
 *
 * Token 拆分：自实现最小 shell-style 拆分器，支持双引号/单引号
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export type DependencySource = 'requirements.txt' | 'pyproject.toml' | 'SKILL.md' | 'none'

export interface SkillDependencies {
  source: DependencySource
  packages: string[]
}

/** 解析 requirements.txt 文本为依赖列表 */
export function parseRequirementsTxt(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

/**
 * 解析 pyproject.toml 中 [project].dependencies 数组
 *
 * 行级状态机（PEP 621 最小子集）：
 *   - 找到 `^dependencies = [` 行 → 进入 collect 状态
 *   - collect 中逐行抽取字符串字面量（双/单引号包裹）
 *   - 直到 `^]`（可有前置空白）行 → 结束
 *
 * 行级匹配天然规避两类 bug：
 *   1. PEP 508 extras 形如 pkg[dev] 中的 ']' 不会终止数组
 *   2. dev-dependencies / optional-dependencies 不会抢占（`^` 锚行首）
 */
export function parsePyprojectDependencies(content: string): string[] {
  const lines = content.split('\n')
  const result: string[] = []
  let inDeps = false
  for (const line of lines) {
    if (!inDeps) {
      if (/^dependencies\s*=\s*\[/.test(line)) {
        inDeps = true
        // 同一行可能已经包含字符串字面量（紧凑写法 dependencies = ["a", "b"]）
        const inline = line.slice(line.indexOf('['))
        extractStringLiterals(inline, result)
        // 同一行可能直接闭合
        if (/\]\s*$/.test(line)) inDeps = false
      }
    } else {
      extractStringLiterals(line, result)
      if (/^\s*\]/.test(line)) {
        inDeps = false
      }
    }
  }
  return result
}

/** 抽取一行中的所有字符串字面量（"..." 或 '...'）追加到 sink */
function extractStringLiterals(line: string, sink: string[]): void {
  const re = /["']([^"']+)["']/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    sink.push(m[1]!)
  }
}

/** 提取 SKILL.md 中首条 uv pip install ... 的参数 token；找不到返回 null */
export function parseInstallLineFromSkillMd(content: string): string[] | null {
  const lineMatch = content.match(/uv\s+pip\s+install\s+([^\n]+)/)
  if (!lineMatch) return null
  return splitShellTokens(lineMatch[1]!)
}

/**
 * Shell-style token 拆分（最小实现）
 *
 * 支持：双/单引号包裹保留空格；引号外的 `#` 视为行内注释起点（截断）。
 * 不支持：反斜杠转义、续行（YAGNI；约束："uv pip install" 单行）
 */
function splitShellTokens(line: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
    } else if (ch === '#') {
      // 引号外的 # 起 → 行内注释，停止解析
      break
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }
  if (current.length > 0) tokens.push(current)
  return tokens
}

/** 给定 skill 目录，按优先级解析其 Python 依赖 */
export async function resolveSkillDependencies(skillDir: string): Promise<SkillDependencies> {
  const reqPath = join(skillDir, 'requirements.txt')
  if (existsSync(reqPath)) {
    return { source: 'requirements.txt', packages: parseRequirementsTxt(readFileSync(reqPath, 'utf-8')) }
  }

  const pyproject = join(skillDir, 'pyproject.toml')
  if (existsSync(pyproject)) {
    return { source: 'pyproject.toml', packages: parsePyprojectDependencies(readFileSync(pyproject, 'utf-8')) }
  }

  const skillMd = join(skillDir, 'SKILL.md')
  if (existsSync(skillMd)) {
    const tokens = parseInstallLineFromSkillMd(readFileSync(skillMd, 'utf-8'))
    if (tokens !== null) return { source: 'SKILL.md', packages: tokens }
  }

  return { source: 'none', packages: [] }
}

/** 计算依赖列表的 SHA256（用于 .deps.lock 比对）；按字母排序去抖动 */
export function hashDependencies(packages: string[]): string {
  const sorted = [...packages].sort()
  return createHash('sha256').update(sorted.join('\n')).digest('hex')
}
