import { getWorkspacePluginName } from './agent-tool-mentions.ts'
/** 每轮自有 plugin 仅链接允许的技能；SDK/后台任务释放租约后才能删除。 */
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getWorkspaceSkills } from './agent-workspace-manager.ts'
import { getWorkspaceSkillsDir } from './config-paths.ts'

export interface RuntimeSkillProjection {
  path: string
  retain(): () => void
  observe(message: { type: string; subtype?: string; task_type?: string; task_id?: string; status?: string }): void
  forgetTasks(taskIds: Iterable<string>): void
  dispose(): void
}
interface ProjectionState { sessionId: string; tasks: Set<string>; collect(): void }
const activeProjections = new Set<ProjectionState>()
// 无终态的旧 SDK 后台任务保守保留；不通过淘汰活跃目录来限制资源。
const MAX_ACTIVE_PROJECTIONS = 64

export function createRuntimeSkillProjection(workspaceSlug: string, sessionId = workspaceSlug): RuntimeSkillProjection {
  if (activeProjections.size >= MAX_ACTIVE_PROJECTIONS) throw new Error('Too many active skill projections; finish background tasks before starting another run.')
  const path = mkdtempSync(join(tmpdir(), 'tinker-runtime-skills-'))
  let references = 1
  let disposed = false
  let removed = false
  const state: ProjectionState = {
    sessionId, tasks: new Set(),
    collect() {
      if (references || state.tasks.size || removed) return
      removed = true
      activeProjections.delete(state)
      rmSync(path, { recursive: true, force: true })
    },
  }
  try {
    mkdirSync(join(path, '.claude-plugin'))
    writeFileSync(join(path, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: getWorkspacePluginName(workspaceSlug), version: '1.0.0' }))
    mkdirSync(join(path, 'skills'))
    for (const skill of getWorkspaceSkills(workspaceSlug)) {
      symlinkSync(join(getWorkspaceSkillsDir(workspaceSlug), skill.slug), join(path, 'skills', skill.slug), 'dir')
    }
    activeProjections.add(state)
    return {
      path,
      retain() {
        if (removed) throw new Error('Skill projection has already been released')
        references++
        let released = false
        return () => { if (!released) { released = true; references--; state.collect() } }
      },
      observe(message) {
        if (message.type !== 'system' || !message.task_id) return
        if (message.subtype === 'task_started') state.tasks.add(message.task_id)
        if (message.subtype === 'task_notification' && ['completed', 'failed', 'stopped'].includes(message.status ?? '')) {
          // 后续回合也可能收到旧任务的终态，释放该会话所有投影中的相同任务。
          for (const projection of activeProjections) {
            if (projection.sessionId === sessionId) { projection.tasks.delete(message.task_id); projection.collect() }
          }
        }
      },
      forgetTasks(taskIds) { for (const id of taskIds) state.tasks.delete(id); state.collect() },
      dispose() { if (!disposed) { disposed = true; references--; state.collect() } },
    }
  } catch (error) { rmSync(path, { recursive: true, force: true }); throw error }
}
