import * as React from 'react'
import { atom, useAtomValue, useStore } from 'jotai'
import type { AgentWorkspace } from '@asci/shared'
import { agentWorkspacesAtom } from '@/atoms/agent-atoms'
import { useT } from '@/hooks/useT'
import { Button } from '@/components/ui/button'

const pickingAtom = atom<string | null>(null)
const pendingChecksAtom = atom(new Map<string, object>())

/** 绑定只接受项目 ID；用户在宿主选择目录，界面不接收绝对路径。 */
export function ProjectDirectory({ workspace }: { workspace: AgentWorkspace }): React.ReactElement {
  const { t } = useT('nav')
  const store = useStore()
  const picking = useAtomValue(pickingAtom)
  const [error, setError] = React.useState<'bindError' | 'readError' | 'unsafeDirectory' | null>(null)
  const visibleProject = React.useRef<string | null>(null)
  const id = workspace.id

  const check = React.useCallback(async (): Promise<void> => {
    const token = {}
    store.set(pendingChecksAtom, checks => new Map(checks).set(id, token))
    try {
      const list = await window.electronAPI.listAgentWorkspaces()
      if (store.get(pendingChecksAtom).get(id) !== token) return
      const selected = list.find(project => project.id === id)
      if (!selected?.directoryStatus) throw new Error('projectUnavailable')
      store.set(agentWorkspacesAtom, projects => projects.map(project =>
        project.id === id && project.directoryStatus !== selected.directoryStatus
          ? { ...project, directoryStatus: selected.directoryStatus }
          : project,
      ))
      if (visibleProject.current === id) setError(null)
    } catch {
      if (visibleProject.current === id && store.get(pendingChecksAtom).get(id) === token) setError('readError')
    } finally {
      if (store.get(pendingChecksAtom).get(id) === token) {
        store.set(pendingChecksAtom, checks => {
          const next = new Map(checks)
          next.delete(id)
          return next
        })
      }
    }
  }, [id, store])

  React.useEffect(() => {
    visibleProject.current = id
    setError(null)
    const recheck = (): void => {
      if (store.get(pickingAtom) !== id) void check()
    }
    recheck()
    window.addEventListener('focus', recheck)
    return () => {
      visibleProject.current = null
      window.removeEventListener('focus', recheck)
    }
  }, [check, id, store])

  const bind = async (): Promise<void> => {
    const open = window.__TAURI_FORMAL__?.bindProjectDirectory
    if (!open || store.get(pickingAtom)) return
    store.set(pickingAtom, id)
    try {
      if (await open(id)) await check()
    } catch (reason) {
      if (visibleProject.current === id) {
        const code = reason && typeof reason === 'object' && 'code' in reason ? reason.code : undefined
        setError(code === 'unsafeImportPath' ? 'unsafeDirectory' : 'bindError')
      }
    } finally {
      store.set(pickingAtom, null)
    }
  }

  const status = workspace.directoryStatus ?? 'unbound'
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="project-directory" data-directory-status={status}>
      <span role="status" className="text-muted-foreground">
        {t(error === 'readError' ? 'projectDirectory.readError' : `projectDirectory.${status}`)}
      </span>
      <Button type="button" size="sm" variant="outline" disabled={picking !== null} onClick={() => void bind()}>
        {t(status === 'unbound' ? 'projectDirectory.choose' : 'projectDirectory.chooseAnother')}
      </Button>
      {error && error !== 'readError' && <p role="alert" className="w-full">{t(`projectDirectory.${error}`)}</p>}
    </div>
  )
}
