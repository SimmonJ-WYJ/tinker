/**
 * 文献库视图状态
 */

import { atom } from 'jotai'
import type { CollectionSummary, ItemSummary, ItemDetail } from '@asci/core/zotero'

// ===== 选中 =====
/** null 代表"所有条目"（顶层） */
export const librarySelectedCollectionKeyAtom = atom<string | null>(null)
export const librarySelectedItemKeyAtom = atom<string | null>(null)

// ===== 搜索 =====
export const librarySearchQueryAtom = atom<string>('')

// ===== 数据缓存 =====
export const libraryCollectionsAtom = atom<CollectionSummary[] | null>(null)
export const libraryItemsAtom = atom<ItemSummary[] | null>(null)
export const libraryItemDetailAtom = atom<ItemDetail | null>(null)

/** items 列表是否还能加载更多（下一页） */
export const libraryItemsHasMoreAtom = atom<boolean>(false)
/** 已加载条数，用作下次请求的 offset */
export const libraryItemsLoadedCountAtom = atom<number>(0)

// ===== 加载态 =====
export const libraryLoadingCollectionsAtom = atom<boolean>(false)
export const libraryLoadingItemsAtom = atom<boolean>(false)
export const libraryLoadingDetailAtom = atom<boolean>(false)

// ===== 错误 =====
export interface LibraryError {
  type: 'zotero_not_running' | 'remote_connection_disabled' | 'unknown'
  message: string
}
export const libraryErrorAtom = atom<LibraryError | null>(null)
