/**
 * Proposal repo 集成测试 —— 状态机 + payload 保留语义
 */

import { describe, expect, test } from 'bun:test'

import type { ObjectId, ProposalTargetRef } from '@asci/shared'

import { openTestDb } from './_helpers.test.ts'
import {
  acceptProposal,
  createProposal,
  findProposalsByTarget,
  getProposalById,
  listPendingProposals,
  modifyProposal,
  rejectProposal,
  softDeleteProposal,
} from './proposal-repository.ts'

function paperTarget(id: string): ProposalTargetRef {
  return { kind: 'paper', id: id as ObjectId }
}

describe('proposal-repository: create', () => {
  test('createProposal 默认 status=pending；payload / reasoning 落库', () => {
    const { repo } = openTestDb()
    const p = createProposal(repo, {
      kind: 'citation-relation',
      sourceCapability: 'cap-A',
      payload: { from: 'p-1', to: 'p-2', type: 'supports' },
      reasoning: 'A 的实验数据直接支持 B 的主结论',
      targetObjectRef: paperTarget('p-1'),
      dismissPolicy: 'once',
    })
    expect(p.status).toBe('pending')
    expect(p.decidedAt).toBeUndefined()
    expect(p.payload).toEqual({ from: 'p-1', to: 'p-2', type: 'supports' })
    expect(p.modifiedPayload).toBeUndefined()
    expect(p.reasoning).toBe('A 的实验数据直接支持 B 的主结论')
  })

  test('createProposal reasoning 空串 → 应用层抛错（先于 DB CHECK）', () => {
    const { repo } = openTestDb()
    expect(() =>
      createProposal(repo, {
        kind: 'citation-relation',
        sourceCapability: 'cap',
        payload: {},
        reasoning: '',
        targetObjectRef: paperTarget('p-1'),
        dismissPolicy: 'once',
      }),
    ).toThrow(/reasoning/i)
  })
})

describe('proposal-repository: 状态机', () => {
  test('accept → status=accepted + decidedAt 写入；payload 保留', () => {
    const { repo } = openTestDb()
    const p = createProposal(repo, {
      kind: 'evidence-set',
      sourceCapability: 'cap',
      payload: { setName: 'Q1' },
      reasoning: 'r',
      targetObjectRef: paperTarget('p-1'),
      dismissPolicy: 'once',
    })
    const accepted = acceptProposal(repo, p.id)
    expect(accepted.status).toBe('accepted')
    expect(accepted.decidedAt).toBeTruthy()
    expect(accepted.payload).toEqual({ setName: 'Q1' })
    expect(accepted.modifiedPayload).toBeUndefined()
  })

  test('reject → status=rejected + decidedAt 写入', () => {
    const { repo } = openTestDb()
    const p = createProposal(repo, {
      kind: 'evidence-set',
      sourceCapability: 'cap',
      payload: {},
      reasoning: 'r',
      targetObjectRef: paperTarget('p-1'),
      dismissPolicy: 'scoped',
    })
    const r = rejectProposal(repo, p.id)
    expect(r.status).toBe('rejected')
    expect(r.decidedAt).toBeTruthy()
  })

  test('modify → modifiedPayload 写入 + status=modified；原 payload 保留', () => {
    const { repo } = openTestDb()
    const p = createProposal(repo, {
      kind: 'citation-relation',
      sourceCapability: 'cap',
      payload: { type: 'supports' },
      reasoning: 'r',
      targetObjectRef: paperTarget('p-1'),
      dismissPolicy: 'once',
    })
    const m = modifyProposal(repo, p.id, { type: 'method-ref' })
    expect(m.status).toBe('modified')
    expect(m.payload).toEqual({ type: 'supports' })
    expect(m.modifiedPayload).toEqual({ type: 'method-ref' })
  })

  test('二次决策抛错', () => {
    const { repo } = openTestDb()
    const p = createProposal(repo, {
      kind: 'citation-relation',
      sourceCapability: 'cap',
      payload: {},
      reasoning: 'r',
      targetObjectRef: paperTarget('p-1'),
      dismissPolicy: 'once',
    })
    rejectProposal(repo, p.id)
    expect(() => acceptProposal(repo, p.id)).toThrow(/already decided/)
    expect(() => modifyProposal(repo, p.id, {})).toThrow(/already decided/)
  })
})

describe('proposal-repository: list + filter', () => {
  test('listPendingProposals 排除已决策与软删', () => {
    const { repo } = openTestDb()
    const pending = createProposal(repo, {
      kind: 'citation-relation',
      sourceCapability: 'cap',
      payload: {},
      reasoning: 'r',
      targetObjectRef: paperTarget('p-1'),
      dismissPolicy: 'once',
    })
    const accepted = createProposal(repo, {
      kind: 'citation-relation',
      sourceCapability: 'cap',
      payload: {},
      reasoning: 'r',
      targetObjectRef: paperTarget('p-2'),
      dismissPolicy: 'once',
    })
    acceptProposal(repo, accepted.id)
    const deleted = createProposal(repo, {
      kind: 'citation-relation',
      sourceCapability: 'cap',
      payload: {},
      reasoning: 'r',
      targetObjectRef: paperTarget('p-3'),
      dismissPolicy: 'once',
    })
    softDeleteProposal(repo, deleted.id)
    expect(listPendingProposals(repo).map((p) => p.id)).toEqual([pending.id])
  })

  test('findProposalsByTarget 按 (target_kind, target_id) 过滤', () => {
    const { repo } = openTestDb()
    const onP1 = createProposal(repo, {
      kind: 'citation-relation',
      sourceCapability: 'cap',
      payload: {},
      reasoning: 'r',
      targetObjectRef: paperTarget('p-1'),
      dismissPolicy: 'once',
    })
    createProposal(repo, {
      kind: 'citation-relation',
      sourceCapability: 'cap',
      payload: {},
      reasoning: 'r',
      targetObjectRef: paperTarget('p-2'),
      dismissPolicy: 'once',
    })
    expect(findProposalsByTarget(repo, paperTarget('p-1')).map((p) => p.id)).toEqual([onP1.id])
  })

  test('getProposalById 缺失返回 null', () => {
    const { repo } = openTestDb()
    expect(getProposalById(repo, 'no' as ObjectId)).toBeNull()
  })
})
