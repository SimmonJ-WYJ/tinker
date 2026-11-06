import { test, expect } from 'bun:test'
import type { PaperRecord, ZoteroOpenBatchImportPayload } from '@asci/shared'
import {
  createZoteroImportToolHandler,
  normalizePaperId,
} from './zotero-import-tool.ts'

test('normalizePaperId: DOI variants', () => {
  expect(normalizePaperId('10.1038/nature14539')).toBe('doi:10.1038/nature14539')
  expect(normalizePaperId('10.1038/NATURE14539')).toBe('doi:10.1038/nature14539')
  expect(normalizePaperId('https://doi.org/10.1038/nature14539')).toBe('doi:10.1038/nature14539')
  expect(normalizePaperId('http://dx.doi.org/10.1038/Nature14539')).toBe('doi:10.1038/nature14539')
  expect(normalizePaperId('doi:10.1038/Nature14539')).toBe('doi:10.1038/nature14539')
})

test('normalizePaperId: arXiv variants', () => {
  expect(normalizePaperId('2103.00020')).toBe('arx:2103.00020')
  expect(normalizePaperId('2103.00020v3')).toBe('arx:2103.00020')
  expect(normalizePaperId('arXiv:2103.00020')).toBe('arx:2103.00020')
  expect(normalizePaperId('https://arxiv.org/abs/2103.00020')).toBe('arx:2103.00020')
  expect(normalizePaperId('https://arxiv.org/pdf/2103.00020v2.pdf')).toBe('arx:2103.00020')
})

test('normalizePaperId: PMID, OpenAlex, canonical pass-through', () => {
  expect(normalizePaperId('12345678')).toBe('pmid:12345678')
  expect(normalizePaperId('pmid:12345678')).toBe('pmid:12345678')
  expect(normalizePaperId('W2741809807')).toBe('oa:W2741809807')
  expect(normalizePaperId('pid:abc123')).toBe('pid:abc123')
  expect(normalizePaperId('arx:1234.5678')).toBe('arx:1234.5678')
})

test('normalizePaperId: unrecognized returns null', () => {
  expect(normalizePaperId('')).toBeNull()
  expect(normalizePaperId('not an id')).toBeNull()
  expect(normalizePaperId('foo bar baz')).toBeNull()
})

function makeRecord(opts: Partial<PaperRecord> & { doi?: string; arxiv?: string }): PaperRecord {
  return {
    ts: '2026-05-15T00:00:00Z',
    title: opts.title ?? 'Sample',
    authors: opts.authors ?? [],
    year: opts.year,
    doi: opts.doi,
    url: opts.url,
    source: opts.source ?? 'arxiv',
    extra: { ...(opts.arxiv ? { arxivId: opts.arxiv } : {}), ...(opts.extra ?? {}) },
  } as PaperRecord
}

test('handler: empty paper_ids returns error', async () => {
  const handler = createZoteroImportToolHandler({
    sessionId: 's',
    sendOpenBatchImport: () => {},
    listSessionPapers: () => ({ records: [], filePath: '/tmp' }),
  })
  const r = await handler({ paper_ids: [] }, {})
  expect(r.isError).toBe(true)
})

test('handler: empty session returns helpful error', async () => {
  const handler = createZoteroImportToolHandler({
    sessionId: 's',
    sendOpenBatchImport: () => {},
    listSessionPapers: () => ({ records: [], filePath: '/tmp' }),
  })
  const r = await handler({ paper_ids: ['10.99/x'] }, {})
  expect(r.isError).toBe(true)
  expect((r.content[0] as { text: string }).text).toContain('process_search_results')
})

test('handler: matches DOI and arXiv, sends IPC, returns success summary', async () => {
  const records: PaperRecord[] = [
    makeRecord({ doi: '10.1038/nature14539', title: 'A' }),
    makeRecord({ arxiv: '2103.00020', title: 'B' }),
    makeRecord({ doi: '10.1/unrelated', title: 'C' }),
  ]
  let sent: ZoteroOpenBatchImportPayload | null = null
  const handler = createZoteroImportToolHandler({
    sessionId: 'sess-1',
    sendOpenBatchImport: (p) => { sent = p },
    listSessionPapers: () => ({ records, filePath: '/tmp' }),
  })

  const r = await handler({ paper_ids: ['https://doi.org/10.1038/nature14539', 'arXiv:2103.00020v2'] }, {})
  expect(r.isError).toBeFalsy()
  expect(sent).not.toBeNull()
  expect(sent!.sessionId).toBe('sess-1')
  expect(sent!.recordKeys.sort()).toEqual(['arx:2103.00020', 'doi:10.1038/nature14539'])
  expect((r.content[0] as { text: string }).text).toContain('2 papers preselected')
})

test('handler: partial match reports skipped + unrecognized', async () => {
  const records: PaperRecord[] = [makeRecord({ doi: '10.99/x' })]
  let sent: ZoteroOpenBatchImportPayload | null = null
  const handler = createZoteroImportToolHandler({
    sessionId: 's',
    sendOpenBatchImport: (p) => { sent = p },
    listSessionPapers: () => ({ records, filePath: '/tmp' }),
  })

  const r = await handler(
    { paper_ids: ['10.99/x', '10.99/missing', 'totally garbage'] },
    {},
  )
  expect(r.isError).toBeFalsy()
  expect(sent!.recordKeys).toEqual(['doi:10.99/x'])
  const text = (r.content[0] as { text: string }).text
  expect(text).toContain('1 paper preselected')
  expect(text).toContain('not in this session')
  expect(text).toContain('unrecognized id format')
})

test('handler: zero matches returns error with diagnostics', async () => {
  const records: PaperRecord[] = [makeRecord({ doi: '10.99/x' })]
  let sent: ZoteroOpenBatchImportPayload | null = null
  const handler = createZoteroImportToolHandler({
    sessionId: 's',
    sendOpenBatchImport: (p) => { sent = p },
    listSessionPapers: () => ({ records, filePath: '/tmp' }),
  })

  const r = await handler({ paper_ids: ['10.99/missing'] }, {})
  expect(r.isError).toBe(true)
  expect(sent).toBeNull()
})

test('handler: dedupes when same paper is given via different aliases', async () => {
  const records: PaperRecord[] = [makeRecord({ doi: '10.1038/nature14539' })]
  let sent: ZoteroOpenBatchImportPayload | null = null
  const handler = createZoteroImportToolHandler({
    sessionId: 's',
    sendOpenBatchImport: (p) => { sent = p },
    listSessionPapers: () => ({ records, filePath: '/tmp' }),
  })

  await handler(
    {
      paper_ids: [
        '10.1038/nature14539',
        'https://doi.org/10.1038/Nature14539',
        'doi:10.1038/nature14539',
      ],
    },
    {},
  )
  expect(sent!.recordKeys).toEqual(['doi:10.1038/nature14539'])
})
