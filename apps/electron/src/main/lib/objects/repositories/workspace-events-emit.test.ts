/**
 * Repository → WorkspaceEventBus emit 集成测试（spec §3.1）
 *
 * 0.2 数据模型重构后剩余的对象事件（pack.taskCompleted 单独在 hook 测）：
 *   - paper.created / paper.deleted
 *   - evidenceRef.created
 *
 * 验证形式：在 Repository 调用前订阅 bus → 调用 → 检查事件序列与 payload。
 * Bus 是模块级单例，afterEach 必须 dispose 以隔离测试。
 */

import { afterEach, describe, expect, test } from 'bun:test'

import type { ObjectId, WorkspaceEvent } from '@asci/shared'

import { workspaceEventBus } from '../../workspace-event-bus.ts'
import { newObjectId } from '../internal/id.ts'
import { openTestDb } from './_helpers.test.ts'
import { createEvidenceRef } from './evidence-ref-repository.ts'
import {
  createPaper,
  softDeletePaper,
} from './paper-repository.ts'

function capture(): { events: WorkspaceEvent[] } {
  const events: WorkspaceEvent[] = []
  workspaceEventBus.on((e) => events.push(e))
  return { events }
}

afterEach(() => {
  workspaceEventBus.dispose()
})

describe('paper-repository emit', () => {
  test('createPaper → emit paper.created（paperId + at）', () => {
    const { repo } = openTestDb()
    const { events } = capture()
    const paper = createPaper(repo, { title: 'T', authors: ['A'] })

    const ev = events.find((e) => e.kind === 'paper.created')
    expect(ev).toBeDefined()
    if (ev?.kind !== 'paper.created') throw new Error('discriminant')
    expect(ev.paperId).toBe(paper.id)
    expect(typeof ev.at).toBe('string')
  })

  test('softDeletePaper → emit paper.deleted', () => {
    const { repo } = openTestDb()
    const paper = createPaper(repo, { title: 'T', authors: ['A'] })
    const { events } = capture()

    softDeletePaper(repo, paper.id)

    const ev = events.find((e) => e.kind === 'paper.deleted')
    expect(ev).toBeDefined()
    if (ev?.kind !== 'paper.deleted') throw new Error('discriminant')
    expect(ev.paperId).toBe(paper.id)
  })
})


describe('evidence-ref-repository emit', () => {
  test('createEvidenceRef → emit evidenceRef.created（含 sourcePaperId + targetReviewId）', () => {
    const { repo, db } = openTestDb()
    const paper = createPaper(repo, { title: 'T', authors: ['A'] })
    // Review 由 review-repository 创建；这里走最小 SQL 直插，避免循环依赖
    const reviewId = newObjectId()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO reviews
         (id, title, intent, source_capability, visibility, created_at, updated_at)
       VALUES (?, 'T', 'i', 'lit-review', 'visible', ?, ?)`,
    ).run(reviewId, now, now)
    const { events } = capture()

    const ref = createEvidenceRef(repo, {
      source: { kind: 'paper', id: paper.id, anchor: { type: 'md', snapshotText: 'src' } },
      target: {
        kind: 'review',
        id: reviewId as ObjectId,
        anchor: { type: 'md', snapshotText: 'tgt' },
      },
    })

    const ev = events.find((e) => e.kind === 'evidenceRef.created')
    if (ev?.kind !== 'evidenceRef.created') throw new Error('discriminant')
    expect(ev.evidenceRefId).toBe(ref.id)
    expect(ev.sourcePaperId).toBe(paper.id)
    expect(ev.targetReviewId).toBe(reviewId as ObjectId)
  })
})
