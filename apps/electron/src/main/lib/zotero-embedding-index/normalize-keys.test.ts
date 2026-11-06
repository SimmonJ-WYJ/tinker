/**
 * normalizeToAttachmentKeys 单测：条目 key → 附件 key 归一
 * （真实综述会话踩坑回归：PLAN 传条目 key，paperIds 过滤全 0 命中）
 */
import { describe, expect, it } from 'bun:test'
import { normalizeToAttachmentKeys } from './index.ts'
import type { ZoteroPdfSnapshot } from '../zotero-pdf-parser/snapshot-store.ts'

/** 最小 snapshot 构造（只填归一化用到的字段） */
function snap(pdfs: Record<string, { attachmentKey: string; parentItemKey: string | null }>): ZoteroPdfSnapshot {
  return { schemaVersion: 4, capturedAt: '2026-06-10T00:00:00Z', pdfs } as unknown as ZoteroPdfSnapshot
}

const SNAPSHOT = snap({
  ATTACH01: { attachmentKey: 'ATTACH01', parentItemKey: 'PARENT01' },
  ATTACH02: { attachmentKey: 'ATTACH02', parentItemKey: 'PARENT01' }, // 同条目双附件
  ATTACH03: { attachmentKey: 'ATTACH03', parentItemKey: 'PARENT03' },
  ATTACH04: { attachmentKey: 'ATTACH04', parentItemKey: null },
})

describe('normalizeToAttachmentKeys', () => {
  it('附件 key 原样保留', () => {
    expect(normalizeToAttachmentKeys(['ATTACH03'], SNAPSHOT)).toEqual(['ATTACH03'])
  })

  it('条目 key 替换为其全部附件 key（含一对多）', () => {
    expect(normalizeToAttachmentKeys(['PARENT01'], SNAPSHOT).sort()).toEqual(['ATTACH01', 'ATTACH02'])
  })

  it('混合输入：附件 key + 条目 key + 未知 key（纯元数据条目）', () => {
    const out = normalizeToAttachmentKeys(['ATTACH04', 'PARENT03', 'NOPDFKEY'], SNAPSHOT).sort()
    expect(out).toEqual(['ATTACH04', 'ATTACH03', 'NOPDFKEY'].sort())
  })

  it('snapshot 缺失时原样返回', () => {
    expect(normalizeToAttachmentKeys(['PARENT01'], null)).toEqual(['PARENT01'])
  })

  it('去重：条目 key 与其附件 key 同时传入不重复', () => {
    expect(normalizeToAttachmentKeys(['PARENT03', 'ATTACH03'], SNAPSHOT)).toEqual(['ATTACH03'])
  })
})
