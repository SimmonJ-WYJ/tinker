import { lstatSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

/** 仅决定 acceptEdits 的免询问候选；不是操作系统沙箱，硬规则仍优先。 */
export function isScopedProjectEdit(tool: string, input: Record<string, unknown>, cwd: string): boolean {
  if (!['Write', 'Edit', 'NotebookEdit'].includes(tool)) return false
  const raw = tool === 'NotebookEdit' ? input.notebook_path : input.file_path
  if (typeof raw !== 'string' || !raw || raw.includes('\0')) return false
  try {
    const root = realpathSync(cwd)
    let ancestor = resolve(cwd, raw)
    const missing: string[] = []
    while (true) {
      try {
        const stat = lstatSync(ancestor)
        if (stat.isSymbolicLink()) return false
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false
        const parent = dirname(ancestor)
        if (parent === ancestor) return false
        missing.unshift(basename(ancestor)); ancestor = parent
      }
    }
    const target = resolve(realpathSync(ancestor), ...missing)
    const scoped = relative(root, target)
    if (!scoped || scoped === '..' || scoped.startsWith(`..${sep}`) || isAbsolute(scoped)) return false
    const protectedPath = /^(?:\.git|\.ssh|\.aws|\.agents|\.codex|\.claude|\.asci|\.config|\.env(?:\..*)?|AGENTS\.md|CLAUDE\.md|credentials(?:\..*)?|secrets?(?:\..*)?|auth[-.].*|.*\.(?:pem|key|p12|pfx))$/i
    return !scoped.split(sep).some(part => protectedPath.test(part))
  } catch { return false }
}
