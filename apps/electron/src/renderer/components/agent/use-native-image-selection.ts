import * as React from 'react'
import { atom, useStore } from 'jotai'
import { imageEditDraftsAtom, type SelectedImageVersion } from '@/atoms/image-edit-atoms'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { applyPickedImage, reportImageFileError } from './native-image-files'

/** 同一会话中的文件选择器和历史选图共享序号，避免先点的图覆盖后点的图。 */
export const pendingNativeImageSelectionsAtom = atom(new Map<string, symbol>())

export function useNativeImageSelection(sessionId: string | null) {
  const store = useStore()
  const cancel = React.useRef<() => void>()
  React.useLayoutEffect(() => () => cancel.current?.(), [sessionId, store])

  return React.useCallback(async (pick: () => Promise<SelectedImageVersion | null>): Promise<boolean> => {
    if (!sessionId) return false
    cancel.current?.()
    const token = Symbol()
    const previous = store.get(imageEditDraftsAtom).get(sessionId)
    const current = () => store.get(pendingNativeImageSelectionsAtom).get(sessionId) === token
    const finish = () => {
      if (!current()) return
      store.set(pendingNativeImageSelectionsAtom, pending => {
        const next = new Map(pending)
        next.delete(sessionId)
        return next
      })
    }
    store.set(pendingNativeImageSelectionsAtom, pending => new Map(pending).set(sessionId, token))
    cancel.current = finish
    const unsubscribeDraft = store.sub(imageEditDraftsAtom, () => {
      if (store.get(imageEditDraftsAtom).get(sessionId) !== previous) finish()
    })
    const unsubscribeSession = store.sub(currentAgentSessionIdAtom, () => {
      if (store.get(currentAgentSessionIdAtom) !== sessionId) finish()
    })
    let applied = false
    try {
      await applyPickedImage(pick, current, selected => {
        store.set(imageEditDraftsAtom, drafts => new Map(drafts).set(sessionId, selected))
        applied = true
      })
    } catch (error) {
      if (current()) reportImageFileError(error)
    } finally {
      unsubscribeDraft()
      unsubscribeSession()
      finish()
      if (cancel.current === finish) cancel.current = undefined
    }
    return applied
  }, [sessionId, store])
}
