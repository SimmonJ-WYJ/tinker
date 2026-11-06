/**
 * asci_python_run — Agent 透明调用 Python 的 MCP 工具
 *
 * 输入：{ skill, command: [argv0, ...args], cwd? }
 * 行为：
 *   1. 让 PythonSkillVenvManager 确保该 skill 的 venv 已就绪（按需建/装）
 *   2. 用 PythonRunner 在 venv 里 spawn 命令
 *   3. 把 stdout/stderr/exitCode 拼成文本返回给 Agent
 *
 * 通过 createSdkMcpServer + tool() 暴露给 claude-agent-sdk 的 in-process MCP 通道。
 */

import { z } from 'zod'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { PythonSkillVenvManager } from '../lib/python/python-skill-venv-manager.ts'
import { runInVenv } from '../lib/python/python-runner.ts'

/** Runner 抽象：生产用 runInVenv；测试可注入 stub */
export type RunnerFn = (input: {
  venvDir: string
  command: string
  args: string[]
  cwd?: string
}) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>

/** stdout/stderr 单流缓冲上限（字节）；超出后停止累积并附"已截断"提示，防止 pip 大输出 OOM */
const MAX_STREAM_BYTES = 1 << 20 // 1 MiB

export function appendCapped(buffer: string, chunk: string): string {
  if (buffer.length >= MAX_STREAM_BYTES) return buffer
  const remaining = MAX_STREAM_BYTES - buffer.length
  if (chunk.length <= remaining) return buffer + chunk
  return buffer + chunk.slice(0, remaining) + '\n[... 输出已截断（超过 1 MiB）]\n'
}

const defaultRunner: RunnerFn = async (input) => {
  let stdout = ''
  let stderr = ''
  const result = await runInVenv({
    venvDir: input.venvDir,
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    onStdout: (c) => { stdout = appendCapped(stdout, c) },
    onStderr: (c) => { stderr = appendCapped(stderr, c) },
  })
  return { stdout, stderr, exitCode: result.exitCode }
}

interface HandlerDeps {
  venvManager: PythonSkillVenvManager
  runner?: RunnerFn
}

/** Tool input shape — z raw shape（不是 z.object）以匹配 tool() 签名 */
const inputShape = {
  skill: z.string().min(1).describe('要使用的 default-skill 名称（如 scanpy / anndata）'),
  command: z.array(z.string()).min(1).describe('要在 venv 里执行的命令 argv，如 ["python", "-c", "print(1)"]'),
  cwd: z.string().optional().describe('工作目录，默认继承 Agent 当前 cwd'),
}

/** tool() handler 推导出的入参类型 */
interface ToolInput {
  skill: string
  command: string[]
  cwd?: string
}

/** 测试入口：返回 handler 函数本身（独立于 SDK MCP 注册壳） */
export function createAsciPythonToolHandler(deps: HandlerDeps) {
  const runner = deps.runner ?? defaultRunner
  return async (input: ToolInput, _extra: unknown): Promise<CallToolResult> => {
    if (!input.command || input.command.length === 0) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'command 不能为空' }],
      }
    }
    try {
      const venvDir = await deps.venvManager.ensure(input.skill)
      const [argv0, ...args] = input.command
      const result = await runner({ venvDir, command: argv0!, args, cwd: input.cwd })
      const lines = [
        `exitCode: ${result.exitCode}`,
        '',
        '----- stdout -----',
        result.stdout,
        '----- stderr -----',
        result.stderr,
      ]
      return {
        isError: result.exitCode !== 0,
        content: [{ type: 'text', text: lines.join('\n') }],
      }
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `asci_python_run 执行失败：${err instanceof Error ? err.message : String(err)}` }],
      }
    }
  }
}

/** 生产入口：构造 SDK MCP server，供 agent-orchestrator 注入到 mcpServers */
export function createAsciPythonMcpServer(deps: HandlerDeps) {
  const handler = createAsciPythonToolHandler(deps)
  return createSdkMcpServer({
    name: 'asci-python',
    version: '0.1.0',
    tools: [
      tool(
        'asci_python_run',
        '在内置 Python venv 中为指定 skill 跑命令；自动按需建立 venv 并安装依赖',
        inputShape,
        handler,
      ),
    ],
  })
}
