import { Code2, Search } from 'lucide-react'
import * as React from 'react'
import { atom, useAtom, useAtomValue } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { useT } from '@/hooks/useT'
import type { AgentSendInput } from '@asci/shared'
export type TaskMode = NonNullable<AgentSendInput['taskMode']>
export const taskModesAtom = atomWithStorage<Record<string, TaskMode>>('asci.session-modes.v1', {}, undefined, { getOnInit: true })
export const lockedTaskModesAtom = atomWithStorage<Record<string, boolean>>('asci.session-mode-locks.v1', {}, undefined, { getOnInit: true })
export const lockTaskModeAtom = atom(null, (get, set, sessionId: string) => {
  set(taskModesAtom, { ...get(taskModesAtom), [sessionId]: get(taskModesAtom)[sessionId] ?? 'search' })
  set(lockedTaskModesAtom, { ...get(lockedTaskModesAtom), [sessionId]: true })
})
export function useTaskMode(sessionId: string): readonly [TaskMode, (mode: TaskMode) => void] {
  const [modes, setModes] = useAtom(taskModesAtom)
  const locks = useAtomValue(lockedTaskModesAtom)
  return [modes[sessionId] ?? 'search', (mode) => { if (!locks[sessionId]) setModes(prev => ({ ...prev, [sessionId]: mode })) }] as const
}
export function TaskModeSelector({ value, onChange, disabled = false, locked = false }: { value: TaskMode; onChange: (mode: TaskMode) => void; disabled?: boolean; locked?: boolean }): React.ReactElement | null {
  const { t } = useT('conversation')
  if (locked) return null
  return <div className="task-mode-selector" data-selected={value} role="group" aria-label={t('taskMode.label')}>
    <span className="task-mode-selector__thumb" aria-hidden="true" />
    {(['search', 'coding'] as const).map((mode) => <button key={mode} data-mode={mode} type="button" aria-label={t(`taskMode.${mode}`)} title={value !== mode ? t(`taskMode.${mode}`) : undefined} aria-pressed={value === mode} disabled={disabled} onClick={() => onChange(mode)}>{mode === 'search' ? <Search size={15} strokeWidth={1.5} /> : <Code2 size={15} strokeWidth={1.5} />}<span className="task-mode-selector__label" aria-hidden={value !== mode}>{t(`taskMode.${mode}`)}</span></button>)}
  </div>
}
