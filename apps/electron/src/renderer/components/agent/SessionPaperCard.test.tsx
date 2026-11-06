/**
 * SessionPaperCard 标签/按钮字号测试：
 * 评分、期刊名等信息标签走 text-badge；底部 DOI/Link/Add 按钮走 text-sm。
 */

import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { setAppLanguage } from '@/lib/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RecordOnlyCard, SimplePaperCard } from './SessionPaperCard.tsx'
import type { PaperRecord, PaperScore, WorkspacePaperEntry } from '@asci/shared'

afterEach(async () => {
  cleanup()
  await setAppLanguage('en')
})

function requireElement<T extends Element>(element: T | null, label: string): T {
  if (element == null) {
    throw new Error(`缺少测试元素：${label}`)
  }
  return element
}

function makeScore(finalScore = 92): PaperScore {
  return {
    version: 2,
    scores: {
      semantic_relevance: finalScore,
      method_match: 88,
      venue_quality: 90,
      publication_status: 95,
      recency: 85,
      paper_influence: 80,
      reproducibility: null,
    },
    relevanceScore: 90,
    qualityScore: 88,
    nullFields: ['reproducibility'],
    finalScore,
    level: 'S',
    dataConfidence: 0.9,
    venueTier: 'top',
    venueMatchConfidence: 0.9,
    publicationStatus: 'published_journal',
    publicationStatusConfidence: 0.9,
    venueType: 'journal',
    reason: '测试评分',
  }
}

function makeEntry(): WorkspacePaperEntry {
  return {
    title: 'Gut microbiota dysbiosis drives depression-like behavior',
    authors: ['Zhang J', 'Chen F'],
    year: 2026,
    venue: 'Transl Psychiatry',
    doi: '10.1000/test',
    url: 'https://example.com/paper',
    abstract: 'Abstract',
    status: 'unread',
    starred: false,
    tags: [],
    note: null,
    noteRelPath: null,
    pdfRelPath: null,
    linkedZoteroKey: null,
    key: 'doi:10.1000/test',
    firstSeenAt: '2026-06-24T00:00:00Z',
    lastSeenAt: '2026-06-24T00:00:00Z',
    sessionRefs: ['s1'],
    seenCount: 1,
    extra: {
      score: makeScore(),
      journalRank: { jcrPartition: 'Q1', impactFactor: '12.3' },
    },
  }
}

function makeLinkedEntry(): WorkspacePaperEntry {
  return {
    ...makeEntry(),
    linkedZoteroKey: 'zotero:item:123',
  }
}

function makeRecord(): PaperRecord {
  return {
    ts: '2026-06-24T00:00:00Z',
    query: 'gut depression',
    source: 'tool:test',
    title: 'Psychobiotic modulation of the microbiome-gut-brain axis',
    authors: ['Joana Rendeiro'],
    year: 2026,
    venue: null,
    doi: null,
    url: 'https://example.com/record',
    abstract: null,
    extra: {
      score: makeScore(89),
    },
  }
}

test('SessionPaperCard: 信息标签使用 text-badge，底部按钮使用 14px', async () => {
  await setAppLanguage('zh')

  render(
    <TooltipProvider>
      <SimplePaperCard
        entry={makeEntry()}
        onOpenPreview={() => undefined}
        onLinkZotero={() => undefined}
      />
    </TooltipProvider>,
  )

  const scoreChip = screen.getByText('92').closest('span[class*="rounded-md"]')
  expect(scoreChip).toBeTruthy()
  expect(scoreChip?.className).toContain('text-badge')
  expect(screen.getByText('评分')).toBeTruthy()
  expect(scoreChip?.parentElement?.textContent).toContain('Transl Psychiatry')
  const chipRow = requireElement(scoreChip?.parentElement ?? null, '信息标签行')
  expect(Array.from(chipRow.children).map((element) => element.textContent)).toEqual([
    '评分92',
    'Q1',
    'IF 12.3',
    'Transl Psychiatry',
  ])

  const chipLabels = ['Transl Psychiatry', 'Q1', 'IF 12.3']
  for (const label of chipLabels) {
    const chip = screen.getByText(label)
    expect(chip.className).toContain('text-badge')
    expect(chip.className).not.toContain('text-sm')
  }

  const quartileChip = screen.getByText('Q1')
  expect(quartileChip.className).toContain('bg-primary/10')
  expect(quartileChip.className).toContain('text-primary')
  expect(quartileChip.className).not.toContain('text-success')

  const doi = screen.getByText('DOI')
  expect(doi.className).toContain('text-sm')
  expect(doi.className).not.toContain('text-badge')
  const metaRow = screen.getByText(/2026 · Zhang J, Chen F/)
  expect(metaRow.parentElement?.textContent).not.toContain('Score')
})

test('SessionPaperCard: 旧会话 scoreV2 键兜底 — 评分徽章仍渲染', async () => {
  await setAppLanguage('zh')
  // 评分键由 scoreV2 重命名为 score；旧会话 entry 仍带 extra.scoreV2，readScore 须兜底读出
  const legacyEntry: WorkspacePaperEntry = {
    ...makeEntry(),
    extra: { scoreV2: makeScore(77) } as WorkspacePaperEntry['extra'],
  }
  render(
    <TooltipProvider>
      <SimplePaperCard
        entry={legacyEntry}
        onOpenPreview={() => undefined}
        onLinkZotero={() => undefined}
      />
    </TooltipProvider>,
  )
  const scoreChip = screen.getByText('77').closest('span[class*="rounded-md"]')
  expect(scoreChip).toBeTruthy()
  expect(screen.getByText('评分')).toBeTruthy()
})

test('SessionPaperCard: 信息标签行可换行但单个标签内容不内部换行', async () => {
  await setAppLanguage('zh')

  render(
    <TooltipProvider>
      <SimplePaperCard
        entry={makeEntry()}
        onOpenPreview={() => undefined}
        onLinkZotero={() => undefined}
      />
    </TooltipProvider>,
  )

  const scoreChip = requireElement(screen.getByText('评分').closest('span[class*="rounded-md"]'), '评分标签')
  const chipRow = requireElement(scoreChip.parentElement, '信息标签行')
  expect(chipRow.className).toContain('flex-wrap')

  const chips = [
    scoreChip,
    screen.getByText('Transl Psychiatry'),
    screen.getByText('Q1'),
    screen.getByText('IF 12.3'),
  ]
  for (const chip of chips) {
    expect(chip.className).toContain('whitespace-nowrap')
  }
})

test('SessionPaperCard: 未添加卡片使用白底描边，区别于已添加灰底卡片', async () => {
  await setAppLanguage('zh')

  const { container } = render(
    <TooltipProvider>
      <SimplePaperCard
        entry={makeEntry()}
        onOpenPreview={() => undefined}
        onLinkZotero={() => undefined}
      />
    </TooltipProvider>,
  )

  const card = requireElement(container.querySelector('li[role="button"]'), '未添加卡片')
  expect(card.className).toContain('rounded-xl')
  expect(card.className).toContain('bg-background')
  expect(card.className).toContain('ring-1')
  expect(card.className).toContain('ring-border/70')
  expect(card.className).toContain('shadow-sm')
  expect(card.className).toContain('shadow-black/[0.04]')
  expect(card.className).not.toContain('shadow-[inset_3px_0_0')
  expect(card.className).not.toContain('bg-muted/50')
  expect(card.className).not.toContain('hover:bg-muted/70')
  expect(card.className).not.toContain('rounded-md')
  expect(card.className).not.toContain('bg-muted/40')
  expect(card.className).not.toContain('hover:bg-muted/60')
  expect(card.className).not.toContain('bg-muted/30')
})

test('SessionPaperCard: 已添加卡片不使用侧边状态线，外形保持统一', async () => {
  await setAppLanguage('zh')

  const { container } = render(
    <TooltipProvider>
      <SimplePaperCard
        entry={makeLinkedEntry()}
        onOpenPreview={() => undefined}
        onLinkZotero={() => undefined}
      />
    </TooltipProvider>,
  )

  const card = requireElement(container.querySelector('li[role="button"]'), '已添加卡片')
  expect(card.className).toContain('bg-muted/50')
  expect(card.className).toContain('hover:bg-muted/70')
  expect(card.className).not.toContain('shadow-[inset_3px_0_0')
  expect(card.className).not.toContain('ring-1')
  expect(card.className).not.toContain('shadow-sm')
  expect(card.className).not.toContain('bg-muted/35')
  expect(card.className).not.toContain('hover:bg-muted/45')
})

test('SessionPaperCard: 卡片内边距统一为 16px', async () => {
  await setAppLanguage('zh')

  const { container } = render(
    <TooltipProvider>
      <SimplePaperCard
        entry={makeEntry()}
        size="expanded"
        onOpenPreview={() => undefined}
        onLinkZotero={() => undefined}
      />
    </TooltipProvider>,
  )

  const card = requireElement(container.querySelector('li[role="button"]'), '扩展卡片')
  expect(card.className).toContain('p-4')
  expect(card.className).not.toContain('p-3')
  expect(card.className).not.toContain('px-4')
  expect(card.className).not.toContain('py-3')
  expect(card.className).not.toContain('px-2.5')
  expect(card.className).not.toContain('py-2')
})

test('SessionPaperCard: 标签、链接和操作按钮样式分层', async () => {
  await setAppLanguage('zh')

  render(
    <TooltipProvider>
      <SimplePaperCard
        entry={makeEntry()}
        onOpenPreview={() => undefined}
        onLinkZotero={() => undefined}
      />
    </TooltipProvider>,
  )

  const venue = screen.getByText('Transl Psychiatry')
  expect(venue.className).toContain('bg-foreground/[0.04]')
  expect(venue.className).toContain('cursor-default')
  expect(venue.className).not.toContain('border-border')

  const doi = screen.getByText('DOI')
  expect(doi.className).toContain('border-border/70')
  expect(doi.className).toContain('bg-background')
  expect(doi.className).toContain('text-foreground')
  expect(doi.className).toContain('shadow-sm')
  expect(doi.className).toContain('font-normal')
  expect(doi.className).not.toContain('font-medium')
  expect(doi.querySelector('svg')).toBeTruthy()
  expect(doi.querySelector('svg')?.getAttribute('class')).toContain('!size-3.5')
  expect(doi.className).toContain('text-sm')
  expect(doi.className).not.toContain('bg-foreground')
  expect(doi.className).not.toContain('text-badge')

  const actionRow = doi.closest('div')
  expect(actionRow?.className).toContain('justify-end')
  expect(actionRow?.className).toContain('gap-1.5')

  const addButton = screen.getByRole('button', { name: '加入 Zotero' })
  expect(addButton.className).toContain('bg-foreground')
  expect(addButton.className).toContain('text-background')
  expect(addButton.className).toContain('hover:text-background')
  expect(addButton.className).not.toContain('hover:text-accent-foreground')
  expect(addButton.className).toContain('gap-1')
  expect(addButton.className).toContain('px-1.5')
  expect(addButton.className).toContain('font-normal')
  expect(addButton.className).not.toContain('font-medium')
  expect(addButton.className).not.toContain('gap-2')
  expect(addButton.className).not.toContain('px-2')
  expect(addButton.className).not.toContain('px-2.5')
  expect(addButton.className).toContain('rounded-md')
  const plusIcon = addButton.querySelector('svg')
  expect(plusIcon).toBeTruthy()
  expect(plusIcon?.getAttribute('class')).toContain('!size-3.5')
  expect(addButton.className).not.toContain('bg-foreground/[0.06]')
})

test('SessionPaperCard: RecordOnly 的 Link 也是右侧按钮组里的按钮', async () => {
  await setAppLanguage('zh')

  render(
    <TooltipProvider>
      <RecordOnlyCard
        record={makeRecord()}
        size="expanded"
        onOpenPreview={() => undefined}
        onLinkZotero={() => undefined}
      />
    </TooltipProvider>,
  )

  const link = screen.getByText('链接')
  expect(screen.queryByText('摘要不可获取')).toBeNull()
  const actionRow = link.closest('div')
  expect(actionRow?.className).toContain('justify-end')
  expect(actionRow?.className).toContain('gap-1.5')
  expect(link.className).toContain('border-border/70')
  expect(link.className).toContain('bg-background')
  expect(link.className).toContain('text-sm')
  expect(link.querySelector('svg')).toBeTruthy()
  expect(link.className).not.toContain('text-badge')
  expect(screen.getByText('加入 Zotero').closest('button')).toBeTruthy()
})

test('SessionPaperCard: 已加入状态下 DOI 与 Added 在右侧同组，Added 使用禁用按钮样式', async () => {
  await setAppLanguage('zh')

  render(
    <TooltipProvider>
      <SimplePaperCard
        entry={makeLinkedEntry()}
        onOpenPreview={() => undefined}
        onLinkZotero={() => undefined}
      />
    </TooltipProvider>,
  )

  const doi = screen.getByText('DOI')
  const actionRow = doi.closest('div')
  expect(actionRow?.className).toContain('justify-end')

  const added = screen.getByText('已加入').closest('span')
  expect(added).toBeTruthy()
  expect(added?.className).toContain('bg-background/80')
  expect(added?.className).toContain('border-border/60')
  expect(added?.className).toContain('text-sm')
  expect(added?.className).toContain('font-normal')
  expect(added?.className).not.toContain('font-medium')
  expect(added?.className).toContain('px-2')
  expect(added?.className).toContain('opacity-75')
  expect(added?.getAttribute('aria-disabled')).toBe('true')
  expect(added?.className).not.toContain('ml-auto')
  expect(screen.queryByRole('button', { name: /加入 Zotero/ })).toBeNull()
})
