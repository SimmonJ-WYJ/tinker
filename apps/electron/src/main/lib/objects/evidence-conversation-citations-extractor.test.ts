/**
 * evidence-conversation-citations-extractor 单测
 *
 * 覆盖纯函数 extractPaperRefsFromMessages：从 SDK 消息流的工具调用还原论文候选。
 * 不碰磁盘（不测 extractConversationPaperRefs 的读盘封装）。
 */
import { describe, expect, test } from 'bun:test'

import type { PaperRecord, SDKMessage } from '@asci/shared'

import {
  extractAnswerCitationsFromMessages,
  extractPaperRefsFromMessages,
} from './evidence-conversation-citations-extractor.ts'

const GET = 'mcp__workspace_papers__workspace_papers_get'
const PDF = 'mcp__pdf_parser__pdf_parse_batch'

/** 人类 user 消息 */
function human(text: string): SDKMessage {
  return {
    type: 'user',
    message: { content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
  } as SDKMessage
}

/** assistant 消息（可带 tool_use） */
function assistant(
  uuid: string,
  blocks: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }>,
): SDKMessage {
  return {
    type: 'assistant',
    uuid,
    message: { content: blocks },
    parent_tool_use_id: null,
  } as unknown as SDKMessage
}

/** tool_result 回填的 user 消息（content 包成 MCP 文本数组） */
function toolResult(toolUseId: string, data: unknown, isError = false): SDKMessage {
  return {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: [{ type: 'text', text: JSON.stringify(data) }],
          is_error: isError,
        },
      ],
    },
    parent_tool_use_id: null,
  } as unknown as SDKMessage
}

describe('extractPaperRefsFromMessages', () => {
  test('workspace_papers_get → 取 doi + abstract 作为候选', () => {
    const messages: SDKMessage[] = [
      human('讲讲 transformer'),
      assistant('a1', [{ type: 'tool_use', id: 't1', name: GET, input: { key: 'k1' } }]),
      toolResult('t1', {
        key: 'k1',
        title: 'Attention Is All You Need',
        doi: '10.48550/arXiv.1706.03762',
        linkedZoteroKey: 'ZK1',
        abstract: 'The dominant sequence transduction models...',
      }),
      assistant('a2', [{ type: 'text', text: 'Transformer 用了自注意力。' }]),
    ]
    const out = extractPaperRefsFromMessages(messages, 'a2')
    expect(out).toHaveLength(1)
    expect(out[0]!.paper).toEqual({ doi: '10.48550/arXiv.1706.03762' })
    expect(out[0]!.snapshotText).toBe('The dominant sequence transduction models...')
    expect(out[0]!.toolName).toBe(GET)
  })

  test('无 doi 时回落 linkedZoteroKey；无摘要时 snapshotText 用 title', () => {
    const messages: SDKMessage[] = [
      human('q'),
      assistant('a1', [{ type: 'tool_use', id: 't1', name: GET, input: { key: 'k1' } }]),
      toolResult('t1', { key: 'k1', title: 'Some Paper', doi: null, linkedZoteroKey: 'ZK9', abstract: null }),
      assistant('a2', [{ type: 'text', text: 'ok' }]),
    ]
    const out = extractPaperRefsFromMessages(messages, 'a2')
    expect(out).toHaveLength(1)
    expect(out[0]!.paper).toEqual({ zoteroKey: 'ZK9' })
    expect(out[0]!.snapshotText).toBe('Some Paper')
  })

  test('notFound 结果 → 跳过', () => {
    const messages: SDKMessage[] = [
      human('q'),
      assistant('a1', [{ type: 'tool_use', id: 't1', name: GET, input: { key: 'kx' } }]),
      toolResult('t1', { notFound: true, key: 'kx' }),
      assistant('a2', [{ type: 'text', text: 'ok' }]),
    ]
    expect(extractPaperRefsFromMessages(messages, 'a2')).toHaveLength(0)
  })

  test('is_error 的 tool_result → 跳过', () => {
    const messages: SDKMessage[] = [
      human('q'),
      assistant('a1', [{ type: 'tool_use', id: 't1', name: GET, input: { key: 'kx' } }]),
      toolResult('t1', { error: { message: 'boom' } }, true),
      assistant('a2', [{ type: 'text', text: 'ok' }]),
    ]
    expect(extractPaperRefsFromMessages(messages, 'a2')).toHaveLength(0)
  })

  test('pdf_parse_batch → 每个 ok/cached item 一条 zoteroKey 候选，error 跳过', () => {
    const messages: SDKMessage[] = [
      human('解析这几篇'),
      assistant('a1', [
        { type: 'tool_use', id: 't1', name: PDF, input: { items: [{ itemKey: 'A', pdfPath: '/x/a.pdf' }] } },
      ]),
      toolResult('t1', {
        results: [
          { itemKey: 'A', status: 'ok' },
          { itemKey: 'B', status: 'cached' },
          { itemKey: 'C', status: 'error', error: 'bad' },
        ],
      }),
      assistant('a2', [{ type: 'text', text: 'done' }]),
    ]
    const out = extractPaperRefsFromMessages(messages, 'a2')
    expect(out.map((c) => c.paper)).toEqual([{ zoteroKey: 'A' }, { zoteroKey: 'B' }])
    expect(out.every((c) => c.snapshotText === '')).toBe(true)
  })

  test('同一篇论文被多次引用 → 去重一条', () => {
    const messages: SDKMessage[] = [
      human('q'),
      assistant('a1', [
        { type: 'tool_use', id: 't1', name: GET, input: { key: 'k1' } },
        { type: 'tool_use', id: 't2', name: GET, input: { key: 'k1' } },
      ]),
      toolResult('t1', { key: 'k1', title: 'P', doi: '10.1/x', abstract: 'aa' }),
      toolResult('t2', { key: 'k1', title: 'P', doi: '10.1/x', abstract: 'aa' }),
      assistant('a2', [{ type: 'text', text: 'ok' }]),
    ]
    const out = extractPaperRefsFromMessages(messages, 'a2')
    expect(out).toHaveLength(1)
    expect(out[0]!.paper).toEqual({ doi: '10.1/x' })
  })

  test('未知工具 → 不产出候选', () => {
    const messages: SDKMessage[] = [
      human('q'),
      assistant('a1', [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x' } }]),
      toolResult('t1', 'some file content'),
      assistant('a2', [{ type: 'text', text: 'ok' }]),
    ]
    expect(extractPaperRefsFromMessages(messages, 'a2')).toHaveLength(0)
  })

  test('只收集本轮（上一条人类 user 之后）的工具调用，不跨轮', () => {
    const messages: SDKMessage[] = [
      human('第一轮'),
      assistant('a1', [{ type: 'tool_use', id: 't1', name: GET, input: { key: 'k1' } }]),
      toolResult('t1', { key: 'k1', title: 'Old', doi: '10.old/1', abstract: 'old' }),
      assistant('a2', [{ type: 'text', text: '第一轮答案' }]),
      human('第二轮'),
      assistant('a3', [{ type: 'tool_use', id: 't2', name: GET, input: { key: 'k2' } }]),
      toolResult('t2', { key: 'k2', title: 'New', doi: '10.new/2', abstract: 'new' }),
      assistant('a4', [{ type: 'text', text: '第二轮答案' }]),
    ]
    const out = extractPaperRefsFromMessages(messages, 'a4')
    expect(out).toHaveLength(1)
    expect(out[0]!.paper).toEqual({ doi: '10.new/2' })
  })

  test('messageUuid 不存在 → 空数组', () => {
    const messages: SDKMessage[] = [human('q'), assistant('a1', [{ type: 'text', text: 'ok' }])]
    expect(extractPaperRefsFromMessages(messages, 'nope')).toHaveLength(0)
  })
})

/** 构造一条 PaperRecord */
function record(p: Partial<PaperRecord> & { title: string }): PaperRecord {
  return {
    ts: '2026-05-27T00:00:00Z',
    query: null,
    source: 'tool:test',
    title: p.title,
    authors: p.authors ?? [],
    year: p.year ?? null,
    venue: p.venue ?? null,
    doi: p.doi ?? null,
    url: p.url ?? null,
    abstract: p.abstract ?? null,
    extra: p.extra ?? {},
  }
}

/** 只含一条回答正文的 assistant 消息 */
function answer(uuid: string, text: string): SDKMessage {
  return assistant(uuid, [{ type: 'text', text }])
}

describe('extractAnswerCitationsFromMessages', () => {
  test('正文里的 (doi:...) 命中会话记录 → 候选带 doi + 元数据', () => {
    const messages = [human('q'), answer('a1', '幂律可预测扩展 (doi:10.48550/arXiv.2001.08361)。')]
    const records = [
      record({ title: 'Scaling Laws', year: 2020, authors: ['Kaplan'], doi: '10.48550/arXiv.2001.08361', abstract: 'abs' }),
    ]
    const out = extractAnswerCitationsFromMessages(messages, records, 'a1')
    expect(out).toHaveLength(1)
    expect(out[0]!.paper).toEqual({ doi: '10.48550/arxiv.2001.08361' })
    expect(out[0]!.meta?.title).toBe('Scaling Laws')
    expect(out[0]!.meta?.year).toBe(2020)
    expect(out[0]!.snapshotText).toBe('abs')
  })

  test('arXiv: 标识命中无 DOI 的记录 → 候选无 paper、靠 meta 兜底', () => {
    const messages = [human('q'), answer('a1', '见 (arXiv:2401.12345)。')]
    const records = [record({ title: 'Some ArXiv Paper', extra: { arxivId: '2401.12345' } })]
    const out = extractAnswerCitationsFromMessages(messages, records, 'a1')
    expect(out).toHaveLength(1)
    expect(out[0]!.paper).toBeUndefined()
    expect(out[0]!.meta?.title).toBe('Some ArXiv Paper')
  })

  test('裸 DOI 命中会话记录 → 候选带元数据', () => {
    const messages = [human('q'), answer('a1', 'as in 10.1000/xyz123 the result holds.')]
    const records = [record({ title: 'Bare Doi Paper', doi: '10.1000/xyz123' })]
    const out = extractAnswerCitationsFromMessages(messages, records, 'a1')
    expect(out).toHaveLength(1)
    expect(out[0]!.paper).toEqual({ doi: '10.1000/xyz123' })
    expect(out[0]!.meta?.title).toBe('Bare Doi Paper')
  })

  test('doi: 标识不在会话记录里 → 仍给 doi 候选（无 meta）', () => {
    const messages = [human('q'), answer('a1', '另见 (doi:10.9999/unknown).')]
    const out = extractAnswerCitationsFromMessages(messages, [], 'a1')
    expect(out).toHaveLength(1)
    expect(out[0]!.paper).toEqual({ doi: '10.9999/unknown' })
    expect(out[0]!.meta).toBeUndefined()
  })

  test('同一 DOI 以前缀 + 裸两种形式出现 → 去重一条', () => {
    const messages = [
      human('q'),
      answer('a1', '首次 (doi:10.1/x)，再次裸引 10.1/x 应去重。'),
    ]
    const records = [record({ title: 'Dup', doi: '10.1/x' })]
    const out = extractAnswerCitationsFromMessages(messages, records, 'a1')
    expect(out).toHaveLength(1)
  })

  test('正文无任何标识 → 空数组', () => {
    const messages = [human('q'), answer('a1', '这段回答没有引用任何论文。')]
    const records = [record({ title: 'X', doi: '10.1/x' })]
    expect(extractAnswerCitationsFromMessages(messages, records, 'a1')).toHaveLength(0)
  })

  test('messageUuid 不存在 → 空数组', () => {
    const messages = [human('q'), answer('a1', '(doi:10.1/x)')]
    expect(extractAnswerCitationsFromMessages(messages, [], 'nope')).toHaveLength(0)
  })
})

/** assistant 消息：带一次 Read tool_use */
function readPdf(uuid: string, filePath: string): SDKMessage {
  return assistant(uuid, [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: filePath } }])
}

describe('extractPaperRefsFromMessages — Read-PDF 扫描', () => {
  test('Read Zotero storage PDF → 候选带 pdfAttachmentKey + 文件名 meta', () => {
    const messages: SDKMessage[] = [
      human('精读这篇'),
      readPdf('a1', '/Users/x/Zotero/storage/4XW2QLJE/Dao 等 - 2022 - FlashAttention Fast and Memory-Efficient Exact Attention.pdf'),
      assistant('a2', [{ type: 'text', text: 'done' }]),
    ]
    const out = extractPaperRefsFromMessages(messages, 'a2')
    expect(out).toHaveLength(1)
    expect(out[0]!.pdfAttachmentKey).toBe('4XW2QLJE')
    expect(out[0]!.paper).toBeUndefined()
    expect(out[0]!.meta?.year).toBe(2022)
    expect(out[0]!.meta?.authors).toEqual(['Dao 等'])
    expect(out[0]!.meta?.title).toBe('FlashAttention Fast and Memory-Efficient Exact Attention')
    expect(out[0]!.snapshotText).toBe('FlashAttention Fast and Memory-Efficient Exact Attention')
  })

  test('Read parsed-papers/{key}.txt → 候选 zoteroKey', () => {
    const messages: SDKMessage[] = [
      human('q'),
      readPdf('a1', '/Users/x/.asci/agent-workspaces/ws/parsed-papers/ABCD1234.txt'),
      assistant('a2', [{ type: 'text', text: 'ok' }]),
    ]
    const out = extractPaperRefsFromMessages(messages, 'a2')
    expect(out).toHaveLength(1)
    expect(out[0]!.paper).toEqual({ zoteroKey: 'ABCD1234' })
  })

  test('Read 普通文件（非论文 PDF）→ 不产候选', () => {
    const messages: SDKMessage[] = [
      human('q'),
      readPdf('a1', '/Users/x/project/src/index.ts'),
      assistant('a2', [{ type: 'text', text: 'ok' }]),
    ]
    expect(extractPaperRefsFromMessages(messages, 'a2')).toHaveLength(0)
  })

  test('文件名不符合 {作者} - {年} - {标题} → title 兜底用整文件名', () => {
    const messages: SDKMessage[] = [
      human('q'),
      readPdf('a1', '/Users/x/Zotero/storage/ZZZZ9999/some_random_name.pdf'),
      assistant('a2', [{ type: 'text', text: 'ok' }]),
    ]
    const out = extractPaperRefsFromMessages(messages, 'a2')
    expect(out).toHaveLength(1)
    expect(out[0]!.pdfAttachmentKey).toBe('ZZZZ9999')
    expect(out[0]!.meta?.title).toBe('some_random_name')
    expect(out[0]!.meta?.year).toBeUndefined()
  })

  test('同一 Zotero PDF 被 Read 两次 → 按 attachmentKey 去重一条', () => {
    const messages: SDKMessage[] = [
      human('q'),
      assistant('a1', [
        { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/Z/storage/4XW2QLJE/A - 2020 - T.pdf' } },
        { type: 'tool_use', id: 'r2', name: 'Read', input: { file_path: '/Z/storage/4XW2QLJE/A - 2020 - T.pdf' } },
      ]),
      assistant('a2', [{ type: 'text', text: 'ok' }]),
    ]
    const out = extractPaperRefsFromMessages(messages, 'a2')
    expect(out).toHaveLength(1)
  })
})

describe('extractPaperRefsFromMessages — papers-rg 结构化精读', () => {
  const RG_SEARCH = 'mcp__papers-rg__papers_search_keywords'
  const RG_SECTION = 'mcp__papers-rg__papers_read_article_section'
  const RG_OUTLINE = 'mcp__papers-rg__papers_read_outline'

  test('papers_search_keywords → 每个 hit 一条候选（pdfAttachmentKey + snippet + passageKey）', () => {
    const messages: SDKMessage[] = [
      human('英语霸权有数据吗'),
      assistant('a1', [{ type: 'tool_use', id: 't1', name: RG_SEARCH, input: { query: 'English' } }]),
      toolResult('t1', {
        query: 'English',
        total: 2,
        truncated: false,
        hits: [
          { paperId: 'NTVZRGIT', lineNumber: 12, byteOffset: 1000, snippet: 'non-English only 3%' },
          { paperId: '8GJKQFT9', lineNumber: 34, byteOffset: 2000, snippet: 'English-centric corpora' },
        ],
      }),
      assistant('a2', [{ type: 'text', text: '找到两条。' }]),
    ]
    const out = extractPaperRefsFromMessages(messages, 'a2')
    expect(out).toHaveLength(2)
    expect(out[0]!.pdfAttachmentKey).toBe('NTVZRGIT')
    expect(out[0]!.snapshotText).toBe('non-English only 3%')
    expect(out[0]!.passageKey).toBe('kw:1000')
    expect(out[1]!.pdfAttachmentKey).toBe('8GJKQFT9')
  })

  test('papers_read_article_section 命中 → section.raw 作 snapshot；同篇不同章节各成一条', () => {
    const messages: SDKMessage[] = [
      human('读 NTVZRGIT 的方法和结论'),
      assistant('a1', [
        { type: 'tool_use', id: 't1', name: RG_SECTION, input: { paperId: 'NTVZRGIT', sectionIndex: 3 } },
        { type: 'tool_use', id: 't2', name: RG_SECTION, input: { paperId: 'NTVZRGIT', sectionIndex: 5 } },
      ]),
      toolResult('t1', { paperId: 'NTVZRGIT', found: true, section: { index: 3, title: 'Methods', raw: '# 3. Methods\n\nWe trained on...' } }),
      toolResult('t2', { paperId: 'NTVZRGIT', found: true, section: { index: 5, title: 'Conclusion', raw: '# 5. Conclusion\n\nResults show...' } }),
      assistant('a2', [{ type: 'text', text: 'ok' }]),
    ]
    const out = extractPaperRefsFromMessages(messages, 'a2')
    // 同一篇两个章节 → 两条候选（passageKey 不同，不折叠）
    expect(out).toHaveLength(2)
    const byKey = Object.fromEntries(out.map((c) => [c.passageKey, c]))
    expect(byKey['sec:3']!.snapshotText).toContain('# 3. Methods')
    expect(byKey['sec:5']!.snapshotText).toContain('# 5. Conclusion')
    expect(out.every((c) => c.pdfAttachmentKey === 'NTVZRGIT')).toBe(true)
  })

  test('papers_read_outline → 论文成员候选（snapshot 空，无 passageKey）', () => {
    const messages: SDKMessage[] = [
      human('看下目录'),
      assistant('a1', [{ type: 'tool_use', id: 't1', name: RG_OUTLINE, input: { paperId: 'GMWZ6UCS' } }]),
      toolResult('t1', { paperId: 'GMWZ6UCS', hasArticle: true, outlineRaw: '- 1. Intro\n- 2. Method' }),
      assistant('a2', [{ type: 'text', text: 'ok' }]),
    ]
    const out = extractPaperRefsFromMessages(messages, 'a2')
    expect(out).toHaveLength(1)
    expect(out[0]!.pdfAttachmentKey).toBe('GMWZ6UCS')
    expect(out[0]!.snapshotText).toBe('')
    expect(out[0]!.passageKey).toBeUndefined()
  })

  test('outline + 同篇 section 命中 → 成员候选与片段候选并存（不互相折叠）', () => {
    const messages: SDKMessage[] = [
      human('读 NTVZRGIT'),
      assistant('a1', [
        { type: 'tool_use', id: 't1', name: RG_OUTLINE, input: { paperId: 'NTVZRGIT' } },
        { type: 'tool_use', id: 't2', name: RG_SECTION, input: { paperId: 'NTVZRGIT', sectionIndex: 1 } },
      ]),
      toolResult('t1', { paperId: 'NTVZRGIT', hasArticle: true, outlineRaw: '- 1. Intro' }),
      toolResult('t2', { paperId: 'NTVZRGIT', found: true, section: { index: 1, title: 'Intro', raw: '# 1. Intro\n\nText' } }),
      assistant('a2', [{ type: 'text', text: 'ok' }]),
    ]
    const out = extractPaperRefsFromMessages(messages, 'a2')
    // 成员候选 att:NTVZRGIT + 片段候选 att:NTVZRGIT#sec:1 = 2 条
    expect(out).toHaveLength(2)
  })

  test('papers_read_article_section 未命中 → 退化为论文成员候选（无 passageKey）', () => {
    const messages: SDKMessage[] = [
      human('读第 9 章'),
      assistant('a1', [{ type: 'tool_use', id: 't1', name: RG_SECTION, input: { paperId: 'NTVZRGIT', sectionIndex: 9 } }]),
      toolResult('t1', { paperId: 'NTVZRGIT', found: false, availableSections: [{ index: 1, title: 'Intro' }] }),
      assistant('a2', [{ type: 'text', text: 'ok' }]),
    ]
    const out = extractPaperRefsFromMessages(messages, 'a2')
    expect(out).toHaveLength(1)
    expect(out[0]!.pdfAttachmentKey).toBe('NTVZRGIT')
    expect(out[0]!.passageKey).toBeUndefined()
  })
})

describe('extractPaperRefsFromMessages — zotero_read_attachment', () => {
  test('mcp__zotero__zotero_read_attachment 入参 itemKey → {zoteroKey} 候选', () => {
    const messages: SDKMessage[] = [
      human('精读这篇 Zotero 论文'),
      assistant('a1', [
        { type: 'tool_use', id: 'z1', name: 'mcp__zotero__zotero_read_attachment', input: { itemKey: 'PARENT77' } },
      ]),
      assistant('a2', [{ type: 'text', text: 'done' }]),
    ]
    const out = extractPaperRefsFromMessages(messages, 'a2')
    expect(out).toHaveLength(1)
    expect(out[0]!.paper).toEqual({ zoteroKey: 'PARENT77' })
    expect(out[0]!.toolName).toBe('zotero_read_attachment')
  })

  test('后缀匹配兼容不同 server 前缀（asci-zotero）', () => {
    const messages: SDKMessage[] = [
      human('q'),
      assistant('a1', [
        { type: 'tool_use', id: 'z1', name: 'mcp__asci-zotero__zotero_read_attachment', input: { itemKey: 'KEY9' } },
      ]),
      assistant('a2', [{ type: 'text', text: 'ok' }]),
    ]
    const out = extractPaperRefsFromMessages(messages, 'a2')
    expect(out).toHaveLength(1)
    expect(out[0]!.paper).toEqual({ zoteroKey: 'KEY9' })
  })

  test('缺 itemKey → 不产候选', () => {
    const messages: SDKMessage[] = [
      human('q'),
      assistant('a1', [
        { type: 'tool_use', id: 'z1', name: 'mcp__zotero__zotero_read_attachment', input: {} },
      ]),
      assistant('a2', [{ type: 'text', text: 'ok' }]),
    ]
    expect(extractPaperRefsFromMessages(messages, 'a2')).toHaveLength(0)
  })

  test('其它 zotero 工具（get_item）不计入', () => {
    const messages: SDKMessage[] = [
      human('q'),
      assistant('a1', [
        { type: 'tool_use', id: 'z1', name: 'mcp__zotero__zotero_get_item', input: { itemKey: 'X' } },
      ]),
      assistant('a2', [{ type: 'text', text: 'ok' }]),
    ]
    expect(extractPaperRefsFromMessages(messages, 'a2')).toHaveLength(0)
  })
})

describe('extractPaperRefsFromMessages — papers_semantic_search 语义检索', () => {
  const RG_SEMANTIC = 'mcp__papers-rg__papers_semantic_search'

  test('每个 hit 一条段落级候选（snippet 作 snapshot，锚点进 passageKey）', () => {
    const messages: SDKMessage[] = [
      human('哪些文献讨论了注意力成本优化'),
      assistant('a1', [
        { type: 'tool_use', id: 't1', name: RG_SEMANTIC, input: { query: '注意力成本优化' } },
      ]),
      toolResult('t1', {
        query: '注意力成本优化',
        modelId: 'multilingual-e5-small-q8',
        total: 3,
        hits: [
          { paperId: 'NTVZRGIT', textKind: 'raw', anchorStart: 'b1200', anchorEnd: 'b1480', sectionIndex: null, sectionTitle: null, snippet: 'GQA reduces KV cache cost', score: 0.031, rawCosine: 0.84, rawBm25: -6.1 },
          { paperId: 'NTVZRGIT', textKind: 'article', anchorStart: 'p3_2', anchorEnd: 'p3_2', sectionIndex: 3, sectionTitle: 'Method', snippet: '本段提出分组查询注意力', score: 0.027, rawCosine: 0.82, rawBm25: null },
          { paperId: '8GJKQFT9', textKind: 'title_abstract', anchorStart: null, anchorEnd: null, sectionIndex: null, sectionTitle: null, snippet: 'Cost-Optimal GQA for Long-Context', score: 0.02, rawCosine: 0.8, rawBm25: null },
        ],
      }),
      assistant('a2', [{ type: 'text', text: '找到三段。' }]),
    ]
    const out = extractPaperRefsFromMessages(messages, 'a2')
    expect(out).toHaveLength(3)
    const byKey = Object.fromEntries(out.map((c) => [c.passageKey, c]))
    // 字节偏移锚点
    expect(byKey['sem:b1200']!.pdfAttachmentKey).toBe('NTVZRGIT')
    expect(byKey['sem:b1200']!.snapshotText).toBe('GQA reduces KV cache cost')
    // 段落 id 锚点：同篇不同段不折叠
    expect(byKey['sem:p3_2']!.pdfAttachmentKey).toBe('NTVZRGIT')
    // title_abstract 层：无锚点 → ta:textKind
    expect(byKey['sem:ta:title_abstract']!.pdfAttachmentKey).toBe('8GJKQFT9')
  })

  test('工具失败 / hits 缺失 → 不产生候选', () => {
    const messages: SDKMessage[] = [
      human('q'),
      assistant('a1', [
        { type: 'tool_use', id: 't1', name: RG_SEMANTIC, input: { query: 'x' } },
        { type: 'tool_use', id: 't2', name: RG_SEMANTIC, input: { query: 'y' } },
      ]),
      toolResult('t1', { error: 'boom' }, true),
      toolResult('t2', { query: 'y', modelId: 'm', total: 0, degraded: 'index_empty', hits: [] }),
      assistant('a2', [{ type: 'text', text: 'ok' }]),
    ]
    expect(extractPaperRefsFromMessages(messages, 'a2')).toHaveLength(0)
  })

  test('同一锚点重复命中 → 按 passageKey 折叠为一条', () => {
    const messages: SDKMessage[] = [
      human('q'),
      assistant('a1', [
        { type: 'tool_use', id: 't1', name: RG_SEMANTIC, input: { query: 'x' } },
        { type: 'tool_use', id: 't2', name: RG_SEMANTIC, input: { query: 'x again' } },
      ]),
      toolResult('t1', { query: 'x', modelId: 'm', total: 1, hits: [
        { paperId: 'K1', textKind: 'raw', anchorStart: 'b100', anchorEnd: 'b200', sectionIndex: null, sectionTitle: null, snippet: 's', score: 0.03, rawCosine: null, rawBm25: null },
      ] }),
      toolResult('t2', { query: 'x again', modelId: 'm', total: 1, hits: [
        { paperId: 'K1', textKind: 'raw', anchorStart: 'b100', anchorEnd: 'b200', sectionIndex: null, sectionTitle: null, snippet: 's', score: 0.02, rawCosine: null, rawBm25: null },
      ] }),
      assistant('a2', [{ type: 'text', text: 'ok' }]),
    ]
    expect(extractPaperRefsFromMessages(messages, 'a2')).toHaveLength(1)
  })
})
