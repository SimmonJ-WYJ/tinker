/**
 * UvSpawnInvoker — 生产环境的 UvInvoker 实现
 *
 * 通过 spawn 调用 uv 二进制，把命令行参数构造与子进程执行分离，
 * 方便单测构造参数而不实际跑 uv。
 *
 * 用法：
 *   const invoker = createUvSpawnInvoker({ uvBinPath, onLog })
 *   new PythonSkillVenvManager({ ..., uv: invoker })
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import type { UvInvoker } from './python-skill-venv-manager.ts'
import { pythonVenvBinRelativeDir } from './paths.ts'

export interface UvVenvArgsInput {
  venvDir: string
  interpreter: string
}

export function buildUvVenvArgs(input: UvVenvArgsInput): string[] {
  return ['venv', input.venvDir, '--python', input.interpreter]
}

export interface UvPipInstallArgsInput {
  venvDir: string
  packages: string[]
  upgrade: boolean
  platform: NodeJS.Platform
}

export function buildUvPipInstallArgs(input: UvPipInstallArgsInput): string[] {
  // 选与 platform 一致的 path 实现，避免 mac host 上跑 win 测试时分隔符出错
  const platformPath = input.platform === 'win32' ? path.win32 : path.posix
  const interp = platformPath.join(
    input.venvDir,
    pythonVenvBinRelativeDir(input.platform),
    input.platform === 'win32' ? 'python.exe' : 'python',
  )
  const args = ['pip', 'install', '--python', interp]
  if (input.upgrade) args.push('--upgrade')
  args.push(...input.packages)
  return args
}

interface FactoryOptions {
  uvBinPath: string
  /** 默认日志输出（可被 PythonSkillVenvManager 的 onLog 覆盖） */
  onLog?: (line: string) => void
}

export function createUvSpawnInvoker(opts: FactoryOptions): UvInvoker {
  const runUv = (args: string[], onLog?: (line: string) => void): Promise<void> => {
    return new Promise((resolve, reject) => {
      const child = spawn(opts.uvBinPath, args, { shell: false })
      child.stdout?.setEncoding('utf-8')
      child.stderr?.setEncoding('utf-8')
      child.stdout?.on('data', (chunk: string) => (onLog ?? opts.onLog)?.(chunk))
      child.stderr?.on('data', (chunk: string) => (onLog ?? opts.onLog)?.(chunk))
      child.on('error', reject)
      child.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`uv ${args[0]} 退出码非零：${code}`))
      })
    })
  }

  return {
    async createVenv(input) {
      await runUv(buildUvVenvArgs(input))
    },
    async pipInstall(input) {
      await runUv(
        buildUvPipInstallArgs({ ...input, platform: process.platform }),
        input.onLog,
      )
    },
  }
}
