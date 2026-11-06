/**
 * EvidenceSetDetailSheet 开关的单一事实源
 *
 * 多入口（NotesView 按集合分组 / Sheet 内部成员 paper 切换等）共用此 atom；
 * Sheet 实例只在视图根挂一次，避免重复挂载。
 */
import { atom } from 'jotai'
import type { ObjectId } from '@asci/shared'

export const openEvidenceSetIdAtom = atom<ObjectId | null>(null)
