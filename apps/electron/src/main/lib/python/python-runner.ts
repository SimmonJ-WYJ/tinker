/**
 * PythonRunner — 在指定 venv 里 spawn 命令并流式回传 stdout/stderr/exit
 *
 * 不走 shell：直接 spawn(command, args)，避免引号 / 路径转义陷阱。
 *
 * 跨平台：PATH 前置 venv/bin（mac/linux）或 venv/Scripts（win32），
 * 分隔符 ':' 对应 unix，';' 对应 windows。
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { pythonVenvBinRelativeDir } from './paths.ts'

export interface RunOptions {
  /** venv 根目录（如 ~/.asci/python/skills/scanpy/venv） */
  venvDir: string
  /** 要执行的命令（'python' | 'pip' | 任意 venv 内可执行文件名） */
  command: string
  /** 命令参数 */
  args?: string[]
  /** 工作目录 */
  cwd?: string
  /** 额外环境变量（覆盖默认 PATH/VIRTUAL_ENV 之外的项） */
  env?: NodeJS.ProcessEnv
  /** stdout 流式回调（每段原始字符串） */
  onStdout?: (chunk: string) => void
  /** stderr 流式回调 */
  onStderr?: (chunk: string) => void
  /** 取消信号 */
  signal?: AbortSignal
}

export interface RunResult {
  /** 子进程退出码（取消或被信号杀死时为 null） */
  exitCode: number | null
  /** 退出信号名称 */
  signal: NodeJS.Signals | null
}

/** 构造注入了 VIRTUAL_ENV 与前置 venv-bin 的 PATH 的环境变量副本 */
export function buildVenvEnv(
  venvDir: string,
  platform: NodeJS.Platform,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  // 使用平台感知的 join，保证在 macOS 宿主上测试 win32 分支时路径分隔符正确
  const platformPath = platform === 'win32' ? path.win32 : path.posix
  const binDir = platformPath.join(venvDir, pythonVenvBinRelativeDir(platform))
  const sep = platform === 'win32' ? ';' : ':'
  const existingPath = baseEnv.PATH ?? baseEnv.Path ?? ''
  const newPath = existingPath ? `${binDir}${sep}${existingPath}` : binDir
  return {
    ...baseEnv,
    VIRTUAL_ENV: venvDir,
    PATH: newPath,
  }
}

/** 在指定 venv 里 spawn 命令；resolve 时返回 exitCode/signal */
export function runInVenv(options: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const env = buildVenvEnv(options.venvDir, process.platform, { ...process.env, ...options.env })
    const child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env,
      signal: options.signal,
      shell: false,
    })

    if (options.onStdout) {
      child.stdout?.setEncoding('utf-8')
      child.stdout?.on('data', (chunk) => options.onStdout!(String(chunk)))
    }
    if (options.onStderr) {
      child.stderr?.setEncoding('utf-8')
      child.stderr?.on('data', (chunk) => options.onStderr!(String(chunk)))
    }

    child.on('error', (err) => reject(err))
    child.on('exit', (code, signal) => resolve({ exitCode: code, signal }))
  })
}
