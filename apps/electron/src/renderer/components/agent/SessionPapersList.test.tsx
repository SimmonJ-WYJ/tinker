import * as React from 'react'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { Provider as JotaiProvider } from 'jotai/react'
import { createStore } from 'jotai'
import { SessionPapersList } from './SessionPapersList.tsx'
import type { PaperRecord } from '@asci/shared'

afterEach(cleanup)

describe('SessionPapersList', () => {
  it('列表内容左右留白与上方 toolbar 保持一致', () => {
    const record: PaperRecord = {
      ts: '2026-06-24T00:00:00Z',
      query: 'gut depression',
      source: 'web',
      title: 'Example paper',
      authors: ['Example Author'],
      year: 2026,
      venue: null,
      doi: null,
      url: 'https://example.test/paper',
      abstract: null,
      extra: {},
    }

    const { container } = render(
      <JotaiProvider store={createStore()}>
        <SessionPapersList
          sessionId="s-papers-list"
          items={[{
            key: 'record-1',
            record,
          }]}
          onOpenPreview={() => {}}
          onLinkZotero={() => {}}
        />
      </JotaiProvider>,
    )

    const list = container.querySelector('ul')
    expect(list?.className).toContain('px-2.5')
    expect(list?.className).not.toContain('px-[18px]')
    expect(list?.className).not.toContain('px-3')
    expect(list?.className).not.toContain('px-0')
  })
})
