import * as React from 'react'
import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setAppLanguage } from '@/lib/i18n'
import { ImageVersionCompare } from './ImageVersionCompare.tsx'
import type { ImageVersion } from './image-versions'

const parent: ImageVersion = {
  imageId: 'parent-version',
  generatedImage: { localPath: 'session-1/parent.png', filename: 'parent.png', mediaType: 'image/png' },
}
const current: ImageVersion = {
  imageId: 'child-version',
  baseImageId: parent.imageId,
  generatedImage: { localPath: 'session-1/child.png', filename: 'child.png', mediaType: 'image/png' },
}

afterEach(async () => {
  cleanup()
  await act(async () => { await setAppLanguage('en') })
})

test('两张原比例图片直接展示在始终并排的列中，版本标题保持单行', async () => {
  await setAppLanguage('en')
  const read = mock(async (_path: string) => 'cG5n')
  window.electronAPI = { readAttachment: read } as unknown as Window['electronAPI']
  await act(async () => { render(<ImageVersionCompare current={current} parent={parent} open onOpenChange={() => {}} returnFocus={() => {}} />) })

  const images = await screen.findAllByRole('img')
  const figures = screen.getAllByRole('figure')
  expect(images.map(image => image.getAttribute('alt'))).toEqual(['Source version', 'This version'])
  expect(read.mock.calls.map(([path]) => path)).toEqual([parent.generatedImage.localPath, current.generatedImage.localPath])
  expect(figures[0]?.parentElement).toHaveClass('grid-cols-2', 'items-start')
  for (const [index, figure] of figures.entries()) {
    // 图片直接位于 figure 内，不再套有背景和内边距的展示框。
    expect(images[index]?.parentElement).toBe(figure)
    expect(figure.querySelector('figcaption')).toHaveClass('truncate')
    expect(images[index]).toHaveClass('h-auto', 'max-w-full', 'object-contain')
    expect(images[index]).not.toHaveClass('object-cover', 'h-full')
  }
})

test('原比例说明仅作为中英文可访问描述，关闭后仍返回原入口焦点', async () => {
  await setAppLanguage('en')
  window.electronAPI = { readAttachment: mock(async () => 'cG5n') } as unknown as Window['electronAPI']
  const returnFocus = mock(() => document.querySelector<HTMLButtonElement>('#compare-trigger')?.focus())
  function Example(): React.ReactElement {
    const [open, setOpen] = React.useState(true)
    return <><button id="compare-trigger">入口</button><ImageVersionCompare current={current} parent={parent} open={open} onOpenChange={setOpen} returnFocus={returnFocus} /></>
  }
  await act(async () => { render(<Example />) })
  const dialog = screen.getByRole('dialog', { name: 'Compare versions' })
  const note = screen.getByText(/Images keep their own aspect ratios/)
  expect(note.closest('p')).toHaveClass('sr-only')
  expect(dialog).toHaveAccessibleDescription(note.textContent ?? '')
  await act(async () => { await setAppLanguage('zh') })
  expect(screen.getByRole('dialog')).toHaveAccessibleDescription('图片按各自原始比例展示，不代表像素精确对齐。')
  expect(screen.getByRole('img', { name: '来源版本' })).toBeInTheDocument()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '关闭' })) })
  await waitFor(() => expect(returnFocus).toHaveBeenCalledTimes(1))
  expect(document.querySelector('#compare-trigger')).toHaveFocus()
})

test('父图片缺失仍保留版本标识和明确提示，当前图片正常展示', async () => {
  await setAppLanguage('en')
  window.electronAPI = {
    readAttachment: mock(async (path: string) => {
      if (path === parent.generatedImage.localPath) throw new Error('missing parent')
      return 'cG5n'
    }),
  } as unknown as Window['electronAPI']
  await act(async () => { render(<ImageVersionCompare current={current} parent={parent} open onOpenChange={() => {}} returnFocus={() => {}} />) })
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable')
  expect(screen.getByText('Source version · parent-v')).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'This version' })).toBeInTheDocument()
})
