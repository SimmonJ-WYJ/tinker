/**
 * Paper —— 0.2 北极星 5 个核心持久对象之一
 *
 * 工作区内的可变论文实体，由用户 / Agent 共同维护。
 * 与 `ZoteroParentItemInfo`（packages/shared/src/types/zotero.ts）区别：
 * Zotero 那一份是 **只读元数据缓存**，本对象是 **工作区可写实体**，
 * 通过可选 `zoteroKey` 维护软关联，不强制外键。
 *
 * 参见 docs/milestones/0.2/north-star.md §一 对象表第 1 行。
 */

import type { ObjectMeta } from './common.ts'

export interface Paper extends ObjectMeta {
  /** 论文标题（必填，作为最小可识别字段） */
  title: string
  /** 作者列表，按论文署名顺序 */
  authors: string[]
  /** 论文摘要（0.1 检索结果继承；UI 详情页 / 综述上下文可用） */
  abstract?: string
  /** 出版年份 */
  year?: number
  /** 期刊 / 会议名称 */
  venue?: string
  /** DOI（不带 `https://doi.org/` 前缀） */
  doi?: string
  /** 论文 URL（优先 DOI URL，其次 open-access URL） */
  url?: string
  /** 软关联 Zotero parent item 的 `itemKey`；删除 Zotero 条目不会级联 */
  zoteroKey?: string
}
