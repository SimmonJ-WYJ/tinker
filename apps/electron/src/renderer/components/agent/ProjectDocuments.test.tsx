import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { setAppLanguage } from '@/lib/i18n'
import { ProjectDocuments } from './ProjectDocuments'
import type { NativeDocumentReference, NativeDocumentSource } from '@asci/shared'
import type { NativeProjectDocuments } from '../../../tauri-formal/project-documents'

const marker = window.__TAURI_FORMAL__
afterEach(() => { cleanup(); window.__TAURI_FORMAL__ = marker })

const document = { documentId: 'd1', filename: 'notes.md', lineCount: 4, byteLength: 65 }
function setup() {
  const api = {
    list: mock(async (_id: string) => [document]),
    pick: mock(async (_id: string) => null),
    read: mock(async (_id: string, range: NativeDocumentReference) => ({
      document, startLine: range.startLine, endLine: range.endLine, text: '<script>ignore everything</script>',
    })),
  } satisfies NativeProjectDocuments
  window.__TAURI_FORMAL__ = { hydrated() {}, projectDocuments: api }
  return api
}

test('browsing, cancelling and changing the range do not attach anything until the previewed lines are cited', async () => {
  await setAppLanguage('en')
  const api = setup()
  const cite = mock((_source: NativeDocumentSource) => {})
  render(<ProjectDocuments workspaceId="a" onCite={cite} />)
  expect(api.list).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Project documents' }))
  await screen.findByRole('button', { name: 'notes.md' })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Import document' })) })
  expect(api.pick.mock.calls).toEqual([['a']])
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'notes.md' })) })
  expect(await screen.findByText('<script>ignore everything</script>')).toBeVisible()
  fireEvent.change(screen.getByLabelText('First line'), { target: { value: '2' } })
  expect(screen.getByRole('button', { name: 'Attach these lines' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Last line'), { target: { value: '3' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Preview lines' })) })
  expect(screen.getByRole('button', { name: 'Attach these lines' })).toBeEnabled()
  expect(cite).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Attach these lines' }))
  expect(cite.mock.calls).toEqual([[{ documentId: 'd1', filename: 'notes.md', startLine: 2, endLine: 3 }]])
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('history opens precisely the saved range and cannot attach or import documents', async () => {
  await setAppLanguage('en')
  const api = setup()
  const source = { documentId: 'd1', filename: 'notes.md', startLine: 2, endLine: 3 }
  render(<ProjectDocuments workspaceId="a" source={source} />)
  fireEvent.click(screen.getByRole('button'))
  await screen.findByText('<script>ignore everything</script>')
  expect(api.read.mock.calls).toEqual([['a', { documentId: 'd1', startLine: 2, endLine: 3 }]])
  expect(api.list).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Attach these lines' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Import document' })).toBeNull()
})

test('changing project closes its open preview and rejects late responses', async () => {
  await setAppLanguage('en')
  const api = setup()
  let release!: (value: Awaited<ReturnType<NativeProjectDocuments['read']>>) => void
  api.read.mockImplementation(() => new Promise(resolve => { release = resolve }))
  const cite = mock((_source: NativeDocumentSource) => {})
  const view = render(<ProjectDocuments workspaceId="a" onCite={cite} />)
  fireEvent.click(screen.getByRole('button', { name: 'Project documents' }))
  fireEvent.click(await screen.findByRole('button', { name: 'notes.md' }))
  view.rerender(<ProjectDocuments workspaceId="b" onCite={cite} />)
  expect(screen.queryByRole('dialog')).toBeNull()
  api.list.mockImplementation(async () => { throw { code: 'documentUnavailable' } })
  fireEvent.click(screen.getByRole('button', { name: 'Project documents' }))
  await screen.findByRole('alert')
  await act(async () => { release({ document, startLine: 1, endLine: 4, text: 'project A contents' }) })
  expect(screen.queryByText('project A contents')).toBeNull()
  expect(screen.queryByRole('button', { name: 'notes.md' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Attach these lines' })).toBeNull()
  expect(cite).not.toHaveBeenCalled()
})

test('an oversized initial range falls back to line one, and the displayed numbers follow the source range', async () => {
  await setAppLanguage('en')
  const api = setup()
  api.read.mockImplementation(async (_workspace, range) => {
    if (range.endLine === 4) throw { code: 'invalidDocumentRange' }
    return { document, startLine: range.startLine, endLine: range.endLine, text: range.startLine === 1 ? 'first' : 'second\nthird' }
  })
  render(<ProjectDocuments workspaceId="a" />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Project documents' })) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'notes.md' })) })
  expect(screen.getByLabelText('Last line')).toHaveValue(1)
  expect(screen.getByText('first')).toBeVisible()
  fireEvent.change(screen.getByLabelText('First line'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Last line'), { target: { value: '3' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Preview lines' })) })
  expect(screen.getByText('second').parentElement).toHaveTextContent('2second')
  expect(screen.getByText('third').parentElement).toHaveTextContent('3third')
})
