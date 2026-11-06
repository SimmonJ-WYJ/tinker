/**
 * 对象 ID 生成器
 *
 * 0.2 北极星 A-2 硬约束：ObjectId 必须在主进程生成（不可让 renderer
 * 自造 ID）。本模块是工作区内唯一的 ID 生成入口。
 *
 * 实现选择：`crypto.randomUUID()`（Node 自带，零新增依赖）。UUIDv4
 * 不可时间排序，但 schema 内 `created_at` 已能承担排序职责，故不引入
 * uuidv7 / nanoid。如果未来需要严格按生成时间索引，再单独切换。
 */

import { randomUUID } from 'node:crypto'

import type { ObjectId } from '@asci/shared'

/** 生成一个新的 ObjectId（UUID v4，带 brand） */
export function newObjectId(): ObjectId {
  return randomUUID() as ObjectId
}
