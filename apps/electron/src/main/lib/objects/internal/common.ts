/**
 * Repo 层通用 helper
 *
 * 集中放：
 *   - 当前时间 ISO 8601 工厂
 *   - 软删通用 SQL（统一字段：visibility='deleted' + deleted_at）
 *   - JSON 列序列化/反序列化（防御类型错位）
 *
 * 不放 ID 生成（→ ./id.ts）、不放 row mapper（→ ./mappers/*）。
 */

import type { ObjectId, ObjectVisibility, Timestamp } from '@asci/shared'
import { nowIso as sharedNowIso } from '@asci/shared'

import type { RepoDb } from './repo-db.ts'

/** 当前时间 ISO 8601 字符串，全局唯一时间源（便于测试时打桩） */
export function nowIso(): Timestamp {
  return sharedNowIso() as Timestamp
}

/**
 * 通用软删：将主表的 `visibility` 置 'deleted'，`deleted_at` 置传入时间，
 * 同时刷新 `updated_at`。表名由调用方传入，因 SQLite 不支持表名参数化。
 *
 * 仅适用于带 visibility / deleted_at / updated_at 三列的 7 张主表
 * （papers / reviews / evidence_refs / notes / evidence_sets /
 *   citation_relations / proposals）。关联表无此三列，不能用本函数。
 *
 * 幂等：对已软删行重复调用只会刷新 deleted_at / updated_at，无副作用。
 */
export function softDeleteRow(
  db: RepoDb,
  table: string,
  id: ObjectId,
  now: Timestamp,
): void {
  db.prepare(
    `UPDATE ${table}
       SET visibility = 'deleted',
           deleted_at = ?,
           updated_at = ?
     WHERE id = ?`,
  ).run(now, now, id)
}

/**
 * 业务侧把 ObjectVisibility 联合类型直接交给 SQLite 即可（字符串就是
 * SQLite 接受的形态），这里只做类型 narrow 的占位 helper。预留位置：
 * 未来如要做"默认隐藏 archived"等行为时，统一在这里加默认值。
 */
export function visibilityOrDefault(v: ObjectVisibility | undefined): ObjectVisibility {
  return v ?? 'visible'
}

/** 把任意 JS 值编成存进 `*_json` TEXT 列的字符串；undefined → null 列 */
export function encodeJson(value: unknown): string | null {
  if (value === undefined) return null
  return JSON.stringify(value)
}

/** 把 `*_json` 列的 TEXT 还原成 JS 值；null/empty → undefined */
export function decodeJson<T = unknown>(text: string | null | undefined): T | undefined {
  if (text === null || text === undefined || text === '') return undefined
  return JSON.parse(text) as T
}
