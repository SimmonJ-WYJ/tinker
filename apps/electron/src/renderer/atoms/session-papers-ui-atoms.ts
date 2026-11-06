/**
 * SessionPapers 面板 UI 状态 atoms
 *
 * 这些是纯 UI 态（多选激活 / 已选集合 / 显示密度），跟数据层
 * (sessionPapersFilterFamilyAtom / sessionPapersSortFamilyAtom) 分开。
 *
 * 多选 / 已选 per session（atomFamily by sessionId）；密度全局。
 */
import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'

/** 多选模式是否激活，per session */
export const sessionPapersMultiSelectActiveFamilyAtom = atomFamily(
  (_sessionId: string) => atom<boolean>(false),
)

/** 已选 paper key 集合，per session；多选退出时清空 */
export const sessionPapersSelectedKeysFamilyAtom = atomFamily(
  (_sessionId: string) => atom<Set<string>>(new Set<string>()),
)

/**
 * 对话内"批量导入 Zotero"的待处理 recordKeys，per session。
 *
 * 由全局监听器（useGlobalAgentListeners，永不销毁）在收到 asci-zotero MCP 工具的
 * ZOTERO_OPEN_BATCH_IMPORT IPC 时写入；SessionPapersPanel 挂载后读取并消费（消费后置 null）。
 *
 * 关键点：监听器与面板解耦——监听器常驻，面板只在 session-papers tab 激活时挂载。
 * 把待导入意图落到这个常驻 atom，面板（重新）挂载时仍能读到，避免面板未挂载时 IPC 被静默丢弃。
 */
export const sessionPapersPendingZoteroImportFamilyAtom = atomFamily(
  (_sessionId: string) => atom<string[] | null>(null),
)

/** 显示密度（全局，不分 session） */
export const sessionPapersDensityAtom = atom<'compact' | 'normal'>('normal')
