// 只读历史面板：每次替换一页，不执行记录内容，也不访问记录中的文件路径。
import React, { useEffect, useRef, useState } from 'react'
import { decodeHistoryPage } from './history-contract.ts'
import type { HistoryPage } from './history-contract.ts'
import type { TextKey } from './i18n.ts'

interface HistoryPanelProps {
  t: (key: TextKey) => string
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>
}
const historyErrors: TextKey[] = ['historyNotFound', 'historyUnsafePath', 'historyUnavailable', 'historyBusy', 'historyInvalidOptions', 'historyCorrupt', 'historyInvalidMessage', 'historyTooLarge', 'nativeRequired', 'protocolMismatch']

export function HistoryPanel({ t, invoke }: HistoryPanelProps): React.ReactElement {
  const [sessionId, setSessionId] = useState('history')
  const [page, setPage] = useState<HistoryPage>()
  const [error, setError] = useState<TextKey>()
  const [loading, setLoading] = useState(false)
  const requestId = useRef(0)
  useEffect(() => () => { requestId.current += 1 }, [])

  function changeSession(value: string) {
    requestId.current += 1
    setSessionId(value)
    setPage(undefined)
    setError(undefined)
    setLoading(false)
  }
  async function read(beforeLine: number | null) {
    const currentRequest = ++requestId.current
    setLoading(true)
    setError(undefined)
    try {
      const result = await invoke('read_session_history', { sessionId, beforeLine, limit: 64 })
      if (currentRequest !== requestId.current) return
      setPage(decodeHistoryPage(result))
    } catch (cause) {
      if (currentRequest !== requestId.current) return
      setError(historyErrors.includes(cause as TextKey) ? cause as TextKey : 'historyUnknownError')
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }

  return <details className="history-panel">
    <summary>{t('historyTitle')}</summary>
    <p className="history-scope">{t('historyScope')}</p>
    <div className="history-controls">
      <label htmlFor="history-session-id">{t('historySessionId')}</label>
      <input id="history-session-id" value={sessionId} onChange={event => changeSession(event.target.value)} autoComplete="off" spellCheck={false} />
      <div className="actions">
        <button type="button" disabled={loading || !sessionId.trim()} onClick={() => void read(null)}>{t(loading ? 'historyLoading' : 'historyRead')}</button>
        <button type="button" disabled={loading || !page || page.nextBeforeLine === null} onClick={() => void read(page?.nextBeforeLine ?? null)}>{t('historyOlder')}</button>
        <button type="button" disabled={loading || !page} onClick={() => void read(null)}>{t('historyLatest')}</button>
      </div>
    </div>
    {error && <p className="notice error" role="alert">{t(error)}</p>}
    <div className="history-page" aria-busy={loading}>
      {page && (page.entries.length === 0 ? <p className="footnote">{t('historyEmpty')}</p> : <ol className="history-entries">
        {page.entries.map(entry => <li key={entry.lineNumber}>
          <p className="history-meta">{t('historyLine')} {entry.lineNumber} · {entry.kind}</p>
          <p className="history-text">{entry.text || t('historyStructured')}</p>
        </li>)}
      </ol>)}
      {page?.incompleteTail !== null && page?.incompleteTail !== undefined && <p className="footnote">{t('historyIncompleteTail')} {page.incompleteTail}</p>}
    </div>
  </details>
}
