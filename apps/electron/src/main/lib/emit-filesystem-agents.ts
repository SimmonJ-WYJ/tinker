/**
 * emitFilesystemAgents — 把已注册的 scenario Agent 同步写成 `.claude/agents/<name>.md` 文件式（G3 修复）。
 *
 * **必要性**：debug 验证（commit db215ee8 + Adapter G3 debug log）已确认 SDK npm 包正确地把
 * `options.agents` 字段传给 claude binary CLI 子进程，但 **claude binary 的 Agent tool
 * dispatch 路径忽略 options.agents 字段**，只读文件式 `.claude/agents/*.md`（用户级 / 项目级）。
 * 这是 claude binary（闭源）的行为，从 SDK npm 侧绕不开。
 *
 * 解决方案：双轨注册 —— Registry（programatic）保留，同时把每个 scenario 写一份 .md 文件到
 * session cwd 下的 `.claude/agents/` 目录，让 claude binary 文件式路径能找到。
 *
 * 行为：
 *  1. reseed 模式：先清空 `<cwd>/.claude/agents/` 里所有 .md 文件（保留目录），再写入当前 registry 快照
 *  2. 每个 scenario → frontmatter (name/description/tools/model) + body (prompt) 的 markdown
 *  3. 写失败 → console.warn，不阻塞主流程
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk'

export interface ScenarioToEmit {
  name: string
  def: AgentDefinition
}

/**
 * 把 scenarios 同步写到 `<cwd>/.claude/agents/<name>.md`。
 * cwd 是 SDK query 的工作目录（master 子进程的 cwd），claude binary 默认读这里的项目级 agents。
 */
export function emitFilesystemAgents(scenarios: readonly ScenarioToEmit[], cwd: string): void {
  const agentsDir = join(cwd, '.claude', 'agents')

  // 1. reseed: 清掉 agentsDir 下所有 .md 文件（保留目录与其他文件）
  if (existsSync(agentsDir)) {
    try {
      const entries = readdirSync(agentsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          try { rmSync(join(agentsDir, entry.name)) } catch (err) {
            console.warn(`[emitFilesystemAgents] 清旧 .md 失败: ${entry.name}`, err)
          }
        }
      }
    } catch (err) {
      console.warn(`[emitFilesystemAgents] 读取 ${agentsDir} 失败`, err)
    }
  } else {
    try { mkdirSync(agentsDir, { recursive: true }) } catch (err) {
      console.warn(`[emitFilesystemAgents] 创建 ${agentsDir} 失败`, err)
      return
    }
  }

  // 2. 写入每个 scenario
  for (const s of scenarios) {
    try {
      const content = renderAgentMarkdown(s.name, s.def)
      writeFileSync(join(agentsDir, `${s.name}.md`), content, 'utf-8')
    } catch (err) {
      console.warn(`[emitFilesystemAgents] 写 ${s.name}.md 失败`, err)
    }
  }
}

/** 把 AgentDefinition 序列化成带 frontmatter 的 markdown。 */
export function renderAgentMarkdown(name: string, def: AgentDefinition): string {
  const lines: string[] = ['---', `name: ${name}`]
  if (def.description) lines.push(`description: ${escapeFrontmatterValue(def.description)}`)
  if (def.tools && def.tools.length > 0) lines.push(`tools: ${def.tools.join(', ')}`)
  if (def.model) lines.push(`model: ${def.model}`)
  lines.push('---', '', def.prompt ?? '')
  return lines.join('\n').trimEnd() + '\n'
}

/**
 * YAML frontmatter value 转义：description 等单行字段含冒号/引号时需要包裹。
 * 简化处理：含换行 / 冒号紧跟空格 / 引号 → 双引号包裹 + 转义内部双引号。
 */
function escapeFrontmatterValue(value: string): string {
  const needsQuote = /[\n":]/.test(value)
  if (!needsQuote) return value
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')
  return `"${escaped}"`
}
