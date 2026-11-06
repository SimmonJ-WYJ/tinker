/**
 * 工作区论文库 atoms
 *
 * B 路线下 UI 层只保留"本次检索 → 加入 Zotero"路径，
 * 底层仍汇集论文数据供未来"ASCI 论文库 + Zotero 并行"时复用。
 *
 * - workspacePapersAtom：当前工作区论文条目（由全局监听器刷新）
 */

import { atom } from 'jotai'
import type { WorkspacePaperEntry } from '@asci/shared'

/** 当前工作区论文条目（由全局监听器刷新） */
export const workspacePapersAtom = atom<WorkspacePaperEntry[]>([])
