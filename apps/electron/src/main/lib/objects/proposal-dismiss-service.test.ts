/**
 * Proposal dismiss-policy 三档静默矩阵测试 —— V6f 端到端验证（数据层切片）
 *
 * 三档场景：
 *   - once：拒绝后同 spec → 不静默（false）
 *   - scoped：在 paper-A 上 scoped 决策后 → paper-A 静默（true）、paper-B 不（false）
 *   - silence-this-kind：决策后 → 同 capability × kind 全工作区静默（true，任何 target）
 *
 * 同时验证：accepted / modified / rejected 三种决策状态都触发静默
 *（dismissPolicy 字段本身就是用户态度的载体，与最终采纳/拒绝无关）。
 */

import { describe, expect, test } from 'bun:test'

import type { ObjectId, ProposalTargetRef } from '@asci/shared'

import { isProposalSilenced } from './proposal-dismiss-service.ts'
import { openTestDb } from './repositories/_helpers.test.ts'
import {
  acceptProposal,
  createProposal,
  modifyProposal,
  rejectProposal,
} from './repositories/proposal-repository.ts'

function tgt(id: string): ProposalTargetRef {
  return { kind: 'paper', id: id as ObjectId }
}

describe('proposal-dismiss: once', () => {
  test('once 决策后，同 spec 仍不静默', () => {
    const { repo } = openTestDb()
    const p = createProposal(repo, {
      kind: 'citation-relation',
      sourceCapability: 'cap-A',
      payload: {},
      reasoning: 'r',
      targetObjectRef: tgt('paper-1'),
      dismissPolicy: 'once',
    })
    rejectProposal(repo, p.id)
    expect(
      isProposalSilenced(repo, {
        sourceCapability: 'cap-A',
        kind: 'citation-relation',
        targetRef: tgt('paper-1'),
      }),
    ).toBe(false)
  })
})

describe('proposal-dismiss: scoped', () => {
  test('在 paper-A 上 scoped 拒绝 → paper-A 静默；paper-B 不受影响', () => {
    const { repo } = openTestDb()
    const p = createProposal(repo, {
      kind: 'citation-relation',
      sourceCapability: 'cap-A',
      payload: {},
      reasoning: 'r',
      targetObjectRef: tgt('paper-A'),
      dismissPolicy: 'scoped',
    })
    rejectProposal(repo, p.id)
    expect(
      isProposalSilenced(repo, {
        sourceCapability: 'cap-A',
        kind: 'citation-relation',
        targetRef: tgt('paper-A'),
      }),
    ).toBe(true)
    expect(
      isProposalSilenced(repo, {
        sourceCapability: 'cap-A',
        kind: 'citation-relation',
        targetRef: tgt('paper-B'),
      }),
    ).toBe(false)
  })

  test('scoped 静默只匹配同 capability × kind', () => {
    const { repo } = openTestDb()
    const p = createProposal(repo, {
      kind: 'citation-relation',
      sourceCapability: 'cap-A',
      payload: {},
      reasoning: 'r',
      targetObjectRef: tgt('paper-1'),
      dismissPolicy: 'scoped',
    })
    rejectProposal(repo, p.id)
    expect(
      isProposalSilenced(repo, {
        sourceCapability: 'cap-B', // 不同 capability
        kind: 'citation-relation',
        targetRef: tgt('paper-1'),
      }),
    ).toBe(false)
    expect(
      isProposalSilenced(repo, {
        sourceCapability: 'cap-A',
        kind: 'evidence-set', // 不同 kind
        targetRef: tgt('paper-1'),
      }),
    ).toBe(false)
  })

  test('scoped + accept / modify 一样触发静默（dismissPolicy 与决策类型独立）', () => {
    const { repo } = openTestDb()
    const accepted = createProposal(repo, {
      kind: 'citation-relation',
      sourceCapability: 'cap-A',
      payload: {},
      reasoning: 'r',
      targetObjectRef: tgt('paper-X'),
      dismissPolicy: 'scoped',
    })
    acceptProposal(repo, accepted.id)
    expect(
      isProposalSilenced(repo, {
        sourceCapability: 'cap-A',
        kind: 'citation-relation',
        targetRef: tgt('paper-X'),
      }),
    ).toBe(true)

    const modified = createProposal(repo, {
      kind: 'evidence-set',
      sourceCapability: 'cap-A',
      payload: {},
      reasoning: 'r',
      targetObjectRef: tgt('paper-Y'),
      dismissPolicy: 'scoped',
    })
    modifyProposal(repo, modified.id, {})
    expect(
      isProposalSilenced(repo, {
        sourceCapability: 'cap-A',
        kind: 'evidence-set',
        targetRef: tgt('paper-Y'),
      }),
    ).toBe(true)
  })
})

describe('proposal-dismiss: silence-this-kind', () => {
  test('决策后 → 同 capability × kind 任意 target 都静默', () => {
    const { repo } = openTestDb()
    const p = createProposal(repo, {
      kind: 'citation-relation',
      sourceCapability: 'cap-H',
      payload: {},
      reasoning: 'r',
      targetObjectRef: tgt('paper-1'),
      dismissPolicy: 'silence-this-kind',
    })
    rejectProposal(repo, p.id)
    expect(
      isProposalSilenced(repo, {
        sourceCapability: 'cap-H',
        kind: 'citation-relation',
        targetRef: tgt('paper-1'),
      }),
    ).toBe(true)
    expect(
      isProposalSilenced(repo, {
        sourceCapability: 'cap-H',
        kind: 'citation-relation',
        targetRef: tgt('paper-999'), // 完全不同的 target
      }),
    ).toBe(true)
    expect(
      isProposalSilenced(repo, {
        sourceCapability: 'cap-H',
        kind: 'evidence-set', // 不同 kind 不受影响
        targetRef: tgt('paper-1'),
      }),
    ).toBe(false)
  })
})

describe('proposal-dismiss: pending 不触发静默', () => {
  test('未决策的 Proposal（status=pending）不计入静默判定', () => {
    const { repo } = openTestDb()
    createProposal(repo, {
      kind: 'citation-relation',
      sourceCapability: 'cap',
      payload: {},
      reasoning: 'r',
      targetObjectRef: tgt('paper-1'),
      dismissPolicy: 'silence-this-kind',
    })
    // 没有 reject/accept/modify
    expect(
      isProposalSilenced(repo, {
        sourceCapability: 'cap',
        kind: 'citation-relation',
        targetRef: tgt('paper-1'),
      }),
    ).toBe(false)
  })
})
