/**
 * useConceptSpotlight — 视图侧便捷 hook
 *
 * 入参：tour key
 * 出参：当前 tour 状态 + 4 个 action（start/advance/skip/restart）
 */

import { useAtomValue } from 'jotai'
import { conceptSpotlightAtom } from '@/atoms/concept-spotlight-atoms'
import type {
  ConceptTourKey,
  ConceptTourState,
} from '../../types/concept-spotlight'

export function useConceptSpotlight(tour: ConceptTourKey): {
  tourState: ConceptTourState | undefined
  start: () => Promise<void>
  advance: (fromSubStage: number) => Promise<void>
  skip: () => Promise<void>
  restart: () => Promise<void>
} {
  const state = useAtomValue(conceptSpotlightAtom)
  const tourState = state[tour]
  return {
    tourState,
    start: async () => {
      await window.electronAPI.startConceptSpotlight({ tour })
    },
    advance: async (fromSubStage: number) => {
      await window.electronAPI.advanceConceptSpotlight({ tour, fromSubStage })
    },
    skip: async () => {
      await window.electronAPI.skipConceptSpotlight({ tour })
    },
    restart: async () => {
      await window.electronAPI.restartConceptSpotlight({ tour })
    },
  }
}
