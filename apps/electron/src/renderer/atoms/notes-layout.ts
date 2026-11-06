/**
 * 证据集视图（NotesView）布局状态 atoms
 *
 * 三栏布局：列表 | 证据集详情 | 预览。列表与详情的宽度可拖拽调整，预览栏可收起。
 * 用 atomWithStorage（localStorage）持久化，与 side-panel-layout / tab-atoms 一致：
 * 用户拖拽后的栏宽、预览栏收起状态，下次进入恢复。
 */
import { atomWithStorage } from 'jotai/utils'

/** 列表栏宽度 clamp 区间（px） */
export const NOTES_LIST_MIN = 280
export const NOTES_LIST_MAX = 600
/** 详情栏宽度 clamp 区间（px） */
export const NOTES_DETAIL_MIN = 360
export const NOTES_DETAIL_MAX = 760

/** 把宽度收敛到 [min, max]；同时兜底 localStorage 被改坏的非数值。 */
export function clampWidth(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/** 列表栏宽度（px）。 */
export const notesListWidthAtom = atomWithStorage<number>('asci.notesView.listWidth', 380)

/** 证据集详情栏宽度（px）。预览栏收起时该栏改为 flex-1，不用此值。 */
export const notesDetailWidthAtom = atomWithStorage<number>('asci.notesView.detailWidth', 520)

/** 预览栏是否收起。 */
export const notesPreviewCollapsedAtom = atomWithStorage<boolean>(
  'asci.notesView.previewCollapsed',
  false,
)
