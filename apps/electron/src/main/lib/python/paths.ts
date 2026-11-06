/**
 * Python skill venv 路径工具
 *
 * 注意：4 工具 runtime（含 Python 解释器）的路径已迁到
 * `runtime/paths.ts`（由 RuntimeProvisioner 暴露）。本模块仅保留
 * **skill venv** 相关路径 —— skill venv 仍然落在 ~/.asci(-dev)/python/skills/
 * 下面（用户数据，不随 installer 迁移）。
 */

import { join } from 'node:path'
import { getConfigDir } from '../config-paths.ts'
import { getUvBinPath, PYTHON_MAJOR_MINOR } from '../runtime/paths.ts'

// PYTHON_MAJOR_MINOR 单源在 runtime/paths.ts，此处仅 re-export 给历史调用方
export { PYTHON_MAJOR_MINOR }

/** ~/.asci(-dev)/python/skills/ — 所有 skill venv 的父目录 */
export function getPythonSkillsDir(): string {
  return join(getConfigDir(), 'python', 'skills')
}

/** ~/.asci/python/skills/<name>/venv — 单个 skill 的 venv 根 */
export function getPythonSkillVenvDir(skillName: string): string {
  return join(getPythonSkillsDir(), skillName, 'venv')
}

/** ~/.asci/python/skills/<name>/.deps.lock — 依赖快照 SHA256 */
export function getPythonSkillDepsLock(skillName: string): string {
  return join(getPythonSkillsDir(), skillName, '.deps.lock')
}

/** 解释器在 runtime 根下的相对路径（与 runtime/paths.ts 共享语义） */
export function pythonInterpreterRelativePath(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'python.exe' : `bin/python${PYTHON_MAJOR_MINOR}`
}

/** venv 内可执行文件目录的相对路径（venv/bin 或 venv/Scripts） */
export function pythonVenvBinRelativeDir(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'Scripts' : 'bin'
}

/** 内置 uv 二进制绝对路径（委托给 runtime/paths.ts 的 getUvBinPath） */
export function getPythonUvBin(): string {
  return getUvBinPath()
}
