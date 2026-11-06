/**
 * markClaudeProjectTrusted — 模拟用户完成"信任项目级 MCP"对话框（G5 修复 v2 + issue #587 v3）。
 *
 * **必要性**：G5 修复 v1（commit 57a7447c + hotfix 6a2d6fb5）写出 `<cwd>/.mcp.json`，但 dev
 * 实测 scenario 子上下文仍看不到 paper-search MCP。诊断（debug dump）显示根因不在文件写入而
 * 在 claude binary 安全设计：项目级 `.mcp.json` 默认**不信任**，必须用户在交互模式弹出的
 * trust dialog 中显式接受才会启用。SDK 跑 query 是非交互模式，trust dialog 弹不出来，
 * `.mcp.json` 永远被忽略。
 *
 * **v3（issue #587）**：v2 只 patch `~/.claude.json`（homedir），但 ASCI 给所有 claude
 * 子进程设了 `CLAUDE_CONFIG_DIR=~/.asci(-dev)/sdk-config`（agent-session-manager.ts），
 * binary 在该变量设置时读写的是 `$CLAUDE_CONFIG_DIR/.claude.json` —— v2 的 trust 标记
 * 写到了 binary 根本不看的文件里（实机验证：sdk-config/.claude.json 的 projects 恒为空）。
 * 现改为**双写**：homedir 路径保留（向后兼容 + 用户未设隔离目录的场景），
 * sdk-config 路径补上（binary 实际消费的那份）。
 *
 * 每个目标文件写入：
 *  - `projects[<cwd>].hasTrustDialogAccepted: true` — 标记用户已接受 trust dialog
 *  - `projects[<cwd>].enabledMcpjsonServers: [...names]` — 项目级 MCP 全部启用
 * 不动其他 projects entry（保留用户已有的 Claude Code CLI 配置）。
 *
 * 单文件行为：
 *  1. read（不存在 → 初始化为 `{ projects: {} }`）
 *  2. ensure projects[cwd] entry 存在（保留 entry 原有其他字段如 lastSessionId / 历史 metrics）
 *  3. set 上述两个字段
 *  4. 原子写入（temp + rename）防止崩溃损坏配置
 *  5. 失败 console.warn 不阻塞主流程
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getSdkConfigDir } from './config-paths.ts'

export interface MarkProjectTrustedInput {
  /** session cwd 的绝对路径 — 用作 `.claude.json` projects 字典的 key */
  cwd: string
  /** 当前 master 已合成的 MCP server names — 写入 `enabledMcpjsonServers` */
  mcpServerNames: readonly string[]
  /** 覆盖默认双写路径（测试用）；提供时仅写该单一路径 */
  claudeJsonPath?: string
  /** 覆盖默认双写路径列表（测试用）；优先级低于 claudeJsonPath */
  claudeJsonPaths?: readonly string[]
}

interface ProjectEntry {
  hasTrustDialogAccepted?: boolean
  enabledMcpjsonServers?: string[]
  [key: string]: unknown
}

interface ClaudeConfig {
  projects?: Record<string, ProjectEntry>
  [key: string]: unknown
}

/** 默认双写目标：homedir（向后兼容）+ sdk-config（CLAUDE_CONFIG_DIR 指向、binary 实际消费） */
export function resolveTrustPatchTargets(): string[] {
  return [join(homedir(), '.claude.json'), join(getSdkConfigDir(), '.claude.json')]
}

export function markClaudeProjectTrusted(input: MarkProjectTrustedInput): void {
  const targets = input.claudeJsonPath
    ? [input.claudeJsonPath]
    : input.claudeJsonPaths ?? resolveTrustPatchTargets()

  for (const claudeJsonPath of targets) {
    patchClaudeJsonTrust(claudeJsonPath, input)
  }
}

function patchClaudeJsonTrust(claudeJsonPath: string, input: MarkProjectTrustedInput): void {
  // 1. read（不存在 → 初始化）
  let config: ClaudeConfig
  if (existsSync(claudeJsonPath)) {
    try {
      config = JSON.parse(readFileSync(claudeJsonPath, 'utf-8')) as ClaudeConfig
    } catch (err) {
      console.warn(`[markClaudeProjectTrusted] 读 ${claudeJsonPath} 失败，跳过（不破坏现有配置）`, err)
      return
    }
  } else {
    config = { projects: {} }
  }
  if (!config.projects) config.projects = {}

  // issue #587 诊断：记录目标文件 patch 前是否已有该 cwd 的 trust entry，
  // 用于在失败复现时确证/证伪 "trust 标记没写到 binary 消费的文件" 这条根因链
  const hadEntry = config.projects[input.cwd]?.hasTrustDialogAccepted === true

  // 2. ensure projects[cwd] entry — 保留已有字段
  const existing = config.projects[input.cwd] ?? {}
  config.projects[input.cwd] = {
    ...existing,
    hasTrustDialogAccepted: true,
    enabledMcpjsonServers: [...input.mcpServerNames],
  }

  // 3. 原子写入（temp + rename）
  const tmpPath = `${claudeJsonPath}.asci-tmp-${process.pid}`
  try {
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
    renameSync(tmpPath, claudeJsonPath)
    console.log(`[markClaudeProjectTrusted] 已 patch ${claudeJsonPath}（patch 前已信任=${hadEntry}）`)
  } catch (err) {
    console.warn(`[markClaudeProjectTrusted] 写 ${claudeJsonPath} 失败`, err)
  }
}
