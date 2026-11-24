import * as React from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useT } from '@/hooks/useT'
import type { TFunction } from 'i18next'
import type { NativeDocumentSource } from '@asci/shared'
import { documentSelection, type DocumentSummary, type NativeProjectDocuments } from '../../../tauri-formal/project-documents'

interface Props {
  workspaceId: string
  onCite?(source: NativeDocumentSource): void
  source?: NativeDocumentSource
}
type Excerpt = Awaited<ReturnType<NativeProjectDocuments['read']>>

export function documentSourceLabel(t: TFunction<'nav'>, source: NativeDocumentSource) {
  return t(source.page === undefined ? 'documents.source' : 'documents.pageSource', {
    name: source.filename, page: source.page, start: source.startLine, end: source.endLine,
  })
}

function errorKey(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null
  switch (code) {
    case 'unsupportedDocumentFormat': return 'documents.unsupported'
    case 'documentTooLarge': return 'documents.tooLarge'
    case 'pdfEncrypted': return 'documents.pdfEncrypted'
    case 'pdfNoText': return 'documents.pdfNoText'
    case 'invalidPdf': return 'documents.invalidPdf'
    case 'pdfParseTimeout': return 'documents.pdfParseTimeout'
    case 'pdfParserUnavailable':
    case 'unsupportedPlatform': return 'documents.pdfParserUnavailable'
    case 'invalidDocument': return 'documents.invalid'
    case 'invalidDocumentRange':
    case 'documentExcerptTooLarge': return 'documents.rangeError'
    case 'documentUnavailable': return 'documents.unavailable'
    case 'documentQuotaExceeded': return 'documents.quota'
    case 'documentNotFound': return 'documents.missing'
    default: return 'documents.error'
  }
}

/** 每次打开挂载一个独立面板，关闭或切换项目后丢弃未完成请求的界面结果。 */
function DocumentPanel({ workspaceId, onCite, source, api, close }: Props & {
  api: NativeProjectDocuments; close(): void
}) {
  const { t } = useT('nav')
  const [documents, setDocuments] = React.useState<DocumentSummary[] | null>(null)
  const [selected, setSelected] = React.useState<DocumentSummary | null>(null)
  const [excerpt, setExcerpt] = React.useState<Excerpt | null>(null)
  const [page, setPage] = React.useState<number>()
  const [start, setStart] = React.useState('')
  const [end, setEnd] = React.useState('')
  const [busy, setBusy] = React.useState(true)
  const [error, setError] = React.useState<ReturnType<typeof errorKey> | null>(null)
  const token = React.useRef(0)
  const operation = React.useCallback(async function run<T>(work: () => Promise<T>, apply: (result: T) => void) {
    const id = ++token.current
    setBusy(true)
    setError(null)
    try {
      const result = await work()
      if (id === token.current) apply(result)
    } catch (reason) {
      if (id === token.current) setError(errorKey(reason))
    } finally {
      if (id === token.current) setBusy(false)
    }
  }, [])

  const load = React.useCallback(() => source
    ? operation(() => api.read(workspaceId, documentSelection(source)), setExcerpt)
    : operation(() => api.list(workspaceId), setDocuments), [api, workspaceId, operation, source])
  React.useEffect(() => { void load(); return () => { ++token.current } }, [load])

  const preview = (item: DocumentSummary, pageNumber: number | undefined, first: number, last: number, initial = false) => {
    setExcerpt(null)
    return operation(async () => {
      const id = token.current
      const read = (endLine: number) => api.read(workspaceId, { documentId: item.documentId, ...(pageNumber !== undefined && { page: pageNumber }), startLine: first, endLine })
      try {
        return await read(last)
      } catch (reason) {
        // 初始页可能超出摘录字节上限。单行在导入时已受限，显式选区则保留原范围并提示。
        if (!initial || last === first || id !== token.current || errorKey(reason) !== 'documents.rangeError') throw reason
        return read(first)
      }
    }, result => {
      setEnd(String(result.endLine))
      setExcerpt(result)
    })
  }
  const select = (item: DocumentSummary, pageNumber = item.pageLineCounts ? 1 : undefined) => {
    const lines = pageNumber === undefined ? item.lineCount : item.pageLineCounts?.[pageNumber - 1] ?? 0
    const last = Math.min(lines, 12)
    setSelected(item)
    setPage(pageNumber)
    setStart(lines ? '1' : '')
    setEnd(lines ? String(last) : '')
    setExcerpt(null)
    if (lines) void preview(item, pageNumber, 1, last, true)
    else setError(null)
  }
  const importFile = () => operation(() => api.pick(workspaceId), item => {
    if (!item) return
    setDocuments(rows => [...(rows ?? []).filter(row => row.documentId !== item.documentId), item])
    select(item)
  })
  const first = Number(start), last = Number(end)
  const lineCount = page === undefined ? selected?.lineCount ?? 0 : selected?.pageLineCounts?.[page - 1] ?? 0
  const valid = selected && first >= 1 && Number.isInteger(first) && Number.isInteger(last)
    && last >= first && last <= lineCount && last - first < 80
  const visibleSource = excerpt && {
    ...documentSelection({ documentId: excerpt.document.documentId, page: excerpt.page, startLine: excerpt.startLine, endLine: excerpt.endLine }),
    filename: excerpt.document.filename,
  }
  const current = visibleSource && visibleSource.page === page && visibleSource.startLine === first
    && visibleSource.endLine === last && visibleSource.documentId === selected?.documentId
  return <>
    <DialogHeader><DialogTitle>{source ? source.filename : t('documents.title')}</DialogTitle></DialogHeader>
    {!source && <>
      <div><Button type="button" size="sm" variant="outline" data-document-import disabled={busy || !documents} onClick={() => void importFile()}>{t('documents.import')}</Button></div>
      {documents && <div data-document-list-ready className="max-h-32 overflow-y-auto">
        {documents.length === 0 && <p className="text-sm text-muted-foreground">{t('documents.empty')}</p>}
        {documents.map(item => <Button type="button" variant={selected?.documentId === item.documentId ? 'secondary' : 'ghost'} size="sm" key={item.documentId}
          data-document-id={item.documentId} disabled={busy} onClick={() => select(item)}>{item.filename}</Button>)}
      </div>}
    </>}
    {selected?.pageLineCounts && <label className="flex items-center gap-2 text-sm">
      {t('documents.page')}
      <select aria-label={t('documents.page')} data-document-page value={page} disabled={busy}
        className="rounded border bg-background px-1" onChange={event => select(selected, Number(event.target.value))}>
        {selected.pageLineCounts.map((_, index, pages) => <option value={index + 1} key={index}>
          {t('documents.pagePosition', { page: index + 1, total: pages.length })}
        </option>)}
      </select>
    </label>}
    {selected && lineCount === 0 && <p role="status" className="text-sm text-muted-foreground">{t('documents.emptyPage')}</p>}
    {selected && lineCount > 0 && <div className="flex flex-wrap items-end gap-2 text-sm">
      {([{ value: start, update: setStart, key: 'start' }, { value: end, update: setEnd, key: 'end' }] as const).map(field =>
        <label key={field.key}>{t(`documents.${field.key}`)}
          <input type="number" min={1} max={lineCount} value={field.value} disabled={busy}
            data-document-start={field.key === 'start' ? '' : undefined} data-document-end={field.key === 'end' ? '' : undefined}
            className="ml-1 w-16 rounded border bg-background px-1" onChange={event => field.update(event.target.value)} />
        </label>)}
      <Button type="button" size="sm" variant="outline" data-document-preview disabled={busy || !valid}
        onClick={() => void preview(selected, page, first, last)}>{t('documents.preview')}</Button>
      <span className="text-muted-foreground">{t('documents.lineCount', { count: lineCount })}</span>
      {!valid && <p role="status">{t('documents.rangeError')}</p>}
    </div>}
    {excerpt && visibleSource && (source || current) && <>
      <span data-document-location className="text-sm text-muted-foreground">{documentSourceLabel(t, visibleSource)}</span>
      <div data-document-text className="max-h-56 overflow-auto rounded-md bg-muted p-3 font-mono text-sm">
        {excerpt.text.split('\n').map((line, index) => {
          const number = excerpt.startLine + index
          return <div key={number} data-document-line={number} className="flex gap-3">
            <span data-document-line-number className="w-[4ch] shrink-0 select-none text-right tabular-nums text-muted-foreground">{number}</span>
            <span data-document-line-text className="min-w-0 whitespace-pre-wrap break-words">{line}</span>
          </div>
        })}
      </div>
    </>}
    {busy && <p role="status" className="text-sm text-muted-foreground">{t('documents.loading')}</p>}
    {error && <div role="alert" data-document-error className="text-sm text-destructive">{t(error)}
      {(source || !documents) && <Button type="button" size="sm" variant="ghost" onClick={() => void load()}>{t('documents.retry')}</Button>}
    </div>}
    {onCite && selected && <div>
      <p className="mb-2 text-sm text-muted-foreground">{t('documents.sendHint')}</p>
      <Button type="button" size="sm" data-document-cite disabled={busy || !current} onClick={() => {
        if (visibleSource && current) {
          onCite(visibleSource)
          close()
        }
      }}>{t('documents.cite')}</Button>
    </div>}
  </>
}

export function ProjectDocuments(props: Props) {
  const key = [props.workspaceId, props.source?.documentId, props.source?.page, props.source?.startLine, props.source?.endLine]
  return <ScopedProjectDocuments key={JSON.stringify(key)} {...props} />
}

function ScopedProjectDocuments({ workspaceId, onCite, source }: Props) {
  const { t } = useT('nav')
  const [open, setOpen] = React.useState(false)
  const api = window.__TAURI_FORMAL__?.projectDocuments
  if (!api) return null
  const label = source ? documentSourceLabel(t, source) : t('documents.title')
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <Button type="button" size={onCite ? 'icon-sm' : 'sm'} variant={onCite ? 'ghost' : 'outline'} aria-label={label} title={label}
        data-project-documents={source ? undefined : onCite ? 'composer' : 'library'} data-document-source={source?.documentId}>
        <FileText aria-hidden="true" />{!onCite && label}
      </Button>
    </DialogTrigger>
    {open && <DialogContent className="max-h-[90vh] overflow-y-auto">
      <DocumentPanel api={api} workspaceId={workspaceId} source={source} onCite={onCite} close={() => setOpen(false)} />
    </DialogContent>}
  </Dialog>
}
