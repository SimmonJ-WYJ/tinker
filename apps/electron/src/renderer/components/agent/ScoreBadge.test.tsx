import * as React from 'react'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ScoreBadge } from './ScoreBadge.tsx'
import type { PaperScore } from '@asci/shared'

afterEach(cleanup)

function requireElement<T extends Element>(element: T | null, label: string): T {
  if (element == null) {
    throw new Error(`缺少测试元素：${label}`)
  }
  return element
}

function makeScore(finalScore: number): PaperScore {
  return {
    version: 2,
    finalScore,
    relevanceScore: finalScore,
    qualityScore: finalScore,
    scores: {
      semantic_relevance: finalScore,
      method_match: finalScore,
      venue_quality: finalScore,
      publication_status: finalScore,
      recency: finalScore,
      paper_influence: finalScore,
      reproducibility: null,
    },
    nullFields: ['reproducibility'],
    level: 'B',
    dataConfidence: 0.8,
    venueTier: 'normal',
    venueMatchConfidence: 0.8,
    publicationStatus: 'published_journal',
    publicationStatusConfidence: 0.8,
    venueType: 'journal',
    reason: '',
  }
}

describe('ScoreBadge', () => {
  it('不同分数段使用一致的 badge 形态，低分不使用实心灰底', () => {
    render(
      <TooltipProvider>
        <ScoreBadge score={makeScore(73)} />
        <ScoreBadge score={makeScore(44)} />
      </TooltipProvider>,
    )

    expect(screen.getAllByText('Score')).toHaveLength(2)
    const score73 = requireElement(screen.getByText('73').closest('span[class*="rounded-md"]'), 'Score 73')
    const score44 = requireElement(screen.getByText('44').closest('span[class*="rounded-md"]'), 'Score 44')
    for (const badge of [score73, score44]) {
      expect(badge.className).toContain('rounded-md')
      expect(badge.className).toContain('gap-0.5')
      expect(badge.className).toContain('px-1.5')
      expect(badge.className).toContain('py-0.5')
      expect(badge.className).toContain('text-badge')
      expect(badge.className).not.toContain('leading-none')
    }
    expect(score73.className).toContain('bg-info/10')
    expect(score44.className).toContain('bg-muted-foreground/10')
    expect(score44.className).not.toContain('bg-muted ')
  })
})
