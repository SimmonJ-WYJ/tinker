/**
 * Concept Spotlight atom — App.tsx 在 mount 时拉一次 + 订阅 onChanged 同步。
 */
import { atom } from 'jotai'
import type { ConceptSpotlightState } from '../../types/concept-spotlight'

export const conceptSpotlightAtom = atom<ConceptSpotlightState>({})
