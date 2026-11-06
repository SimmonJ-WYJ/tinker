/**
 * PythonSkillVenvManager — 按需为 default-skill 准备独立 venv
 *
 * 责任：
 *   - 解析 skill 依赖（委托 resolveSkillDependencies）
 *   - 调 uv venv 建虚拟环境到 ~/.asci/python/skills/<name>/venv
 *   - 调 uv pip install 装依赖
 *   - 维护 .deps.lock：依赖列表的 SHA256
 *     - 命中 → 跳过
 *     - 不命中（依赖列表变了）→ uv pip install --upgrade（不删 venv）
 *
 * 并发：同一 skill 的 ensure() 调用复用 inflight promise（in-process Mutex）
 *
 * 错误：
 *   - createVenv 抛错 → 清理半成品 venv + 透传
 *   - pipInstall 抛错 → 删 venv（强制下次重建）+ 透传
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  getPythonSkillVenvDir,
  getPythonSkillDepsLock,
} from './paths.ts'
import { resolveSkillDependencies, hashDependencies } from './python-dependency-resolver.ts'

/** 抽象 uv 调用：测试用 mock，生产用 spawn-based 实现 */
export interface UvInvoker {
  /** uv venv <venvDir> --python <interpreter> */
  createVenv(opts: { venvDir: string; interpreter: string }): Promise<void>
  /**
   * uv pip install [--upgrade] --python <venvDir>/.../python <packages...>
   *
   * upgrade=true 时调 uv pip install --upgrade
   */
  pipInstall(opts: {
    venvDir: string
    packages: string[]
    upgrade: boolean
    onLog?: (line: string) => void
  }): Promise<void>
}

interface ManagerOptions {
  /** ~/.asci/default-skills 或测试隔离目录 */
  skillsRootDir: string
  /** 内置 Python 解释器绝对路径 */
  interpreterPath: string
  /** uv 调用器（生产用 spawn-based，测试用 mock） */
  uv: UvInvoker
  /** 安装日志回调 */
  onInstallLog?: (skillName: string, line: string) => void
}

export class PythonSkillVenvManager {
  /** 同一 skill 进行中的 ensure promise，防止并发重复 */
  private readonly inflight: Map<string, Promise<string>> = new Map()

  constructor(private readonly opts: ManagerOptions) {}

  /** 确保 skill 的 venv 已准备好，返回 venv 绝对路径 */
  ensure(skillName: string): Promise<string> {
    const existing = this.inflight.get(skillName)
    if (existing) return existing
    const promise = this.doEnsure(skillName).finally(() => {
      this.inflight.delete(skillName)
    })
    this.inflight.set(skillName, promise)
    return promise
  }

  private async doEnsure(skillName: string): Promise<string> {
    const venvDir = getPythonSkillVenvDir(skillName)
    const lockPath = getPythonSkillDepsLock(skillName)
    const skillDir = join(this.opts.skillsRootDir, skillName)

    const deps = await resolveSkillDependencies(skillDir)
    const newHash = deps.packages.length > 0 ? hashDependencies(deps.packages) : null

    const venvExists = existsSync(join(venvDir, 'pyvenv.cfg'))
    const lockExists = existsSync(lockPath)
    const oldHash = lockExists ? readFileSync(lockPath, 'utf-8').trim() : null

    // 已就绪且依赖未变
    if (venvExists && newHash !== null && oldHash === newHash) {
      return venvDir
    }

    // 还没建过 venv → 建
    if (!venvExists) {
      mkdirSync(dirname(venvDir), { recursive: true })
      try {
        await this.opts.uv.createVenv({ venvDir, interpreter: this.opts.interpreterPath })
      } catch (err) {
        if (existsSync(venvDir)) rmSync(venvDir, { recursive: true, force: true })
        throw err
      }
    }

    // 装依赖
    if (deps.packages.length > 0) {
      const lockHash = hashDependencies(deps.packages)
      try {
        await this.opts.uv.pipInstall({
          venvDir,
          packages: deps.packages,
          upgrade: oldHash !== null && oldHash !== lockHash,
          onLog: (line) => this.opts.onInstallLog?.(skillName, line),
        })
      } catch (err) {
        if (existsSync(venvDir)) rmSync(venvDir, { recursive: true, force: true })
        if (existsSync(lockPath)) rmSync(lockPath, { force: true })
        throw err
      }
      writeFileSync(lockPath, lockHash, 'utf-8')
    }

    return venvDir
  }
}
