import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useT } from './i18n.ts'
import { HistoryPanel } from './HistoryPanel.tsx'
import type { TextKey } from './i18n.ts'
import './style.css'
import { decodeSnapshot } from './desktop-contract.ts'
import type { Snapshot } from './desktop-contract.ts'
declare global { interface Window { __TAURI__?: { core: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } } } }
function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const api = window.__TAURI__?.core
  return api ? api.invoke<T>(command, args) : Promise.reject('nativeRequired')
}
const errorKeys: TextKey[] = ['emptyInput', 'inputTooLarge', 'modelNotMigrated', 'stateUnavailable', 'nativeRequired', 'protocolMismatch', 'storageUnavailable', 'storageLocked', 'storageUnsafePath', 'storageCorrupt', 'storageVersionUnsupported', 'storageFileTooLarge', 'storageConflict', 'storageRecoveryRequired', 'storageUncertain']
function App(): React.ReactElement {
  const { t, language, toggleLanguage } = useT()
  const [health, setHealth] = useState<Snapshot>()
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<TextKey>()
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(true)
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  function showError(error: unknown) {
    setStatus(errorKeys.includes(error as TextKey) ? error as TextKey : 'unknownError')
    setFailed(true)
  }
  async function readSnapshot() {
    try {
      const snapshot = decodeSnapshot(await invoke<unknown>('snapshot'))
      setHealth(snapshot)
      return snapshot
    } catch (error) { setHealth(undefined); throw error }
  }
  useEffect(() => { readSnapshot().then(snapshot => setDraft(snapshot.draft)).catch(showError).finally(() => setBusy(false)) }, [])
  useEffect(() => { document.documentElement.lang = language; document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [language, dark])
  async function act(action: 'save' | 'restore' | 'submit' | 'recover') {
    setBusy(true)
    try {
      if (action === 'restore') {
        const snapshot = await readSnapshot()
        setDraft(snapshot.draft); setStatus(snapshot.storageKind === 'file' ? 'restoredFile' : 'restored')
      } else if (action === 'recover') {
        await invoke<void>('recover_draft', { expectedRevision: health?.revision })
        const snapshot = await readSnapshot()
        setDraft(snapshot.draft); setStatus('recovered')
      } else {
        await invoke<void>(action === 'save' ? 'save_draft' : 'submit_draft', { input: draft })
        const snapshot = await readSnapshot()
        setStatus(snapshot.storageKind === 'file' ? 'savedFile' : 'saved')
      }
      setFailed(false)
    } catch (error) { showError(error) } finally { setBusy(false) }
  }
  return <div className="shell">
    <aside>
      <img className="wordmark" src={dark ? '/Tinker-horizontal-white.svg' : '/Tinker-horizontal-color.svg'} alt="Tinker" />
      <nav aria-label="Tinker"><div className="nav-item selected">{t('newTask')}</div>
        {(['projects', 'search', 'channels'] as const).map(key => <button disabled className="nav-item" key={key}>{t(key)}<small>{t('notMigrated')}</small></button>)}
      </nav>
      <div className="sidebar-bottom"><button onClick={toggleLanguage}>{t('language')}</button><button onClick={() => setDark(!dark)}>{t('theme')}</button></div>
    </aside>
    <main><header><span>{t('stage')}</span><span>{health ? t('connected') : t('connecting')}</span></header>
      <section className="workspace">
        <img className="symbol" src={dark ? '/Tinker-symbol-white.svg' : '/Tinker-symbol-color.svg'} alt="" />
        <h1>{t('title')}</h1><p className="scope">{t('note')}</p>
        <form onSubmit={event => { event.preventDefault(); void act('submit') }}>
          <label className="sr-only" htmlFor="draft">{t('inputLabel')}</label>
          <textarea id="draft" value={draft} disabled={busy || health?.recoveryRequired} onChange={event => setDraft(event.target.value)} placeholder={t('placeholder')} />
          <div className="actions"><button type="button" disabled={busy} onClick={() => void act('restore')}>{t('restore')}</button><button type="button" disabled={busy || !health || health.recoveryRequired} onClick={() => void act('save')}>{t('save')}</button><button className="primary" disabled={busy || !health || health.recoveryRequired} type="submit">{t('submit')}</button></div>
        </form>
        {status && <p role={failed ? 'alert' : 'status'} className={failed ? 'notice error' : 'notice'}>{t(status)}</p>}
        {health?.recoveryRequired && <div className="notice error" role="alert"><p>{t('recoveryNotice')}</p><button disabled={busy} onClick={() => void act('recover')}>{t('recover')}</button></div>}
        <p className="footnote">{t(!health ? 'storageUnknown' : health.storageKind === 'file' ? 'fileStorage' : 'memory')}</p>
        {health && <p className="footnote">{t('architecture')}: {health.architecture} · IPC v{health.protocolVersion}</p>}
        <HistoryPanel t={t} invoke={invoke} />
      </section>
    </main>
  </div>
}
createRoot(document.getElementById('root')!).render(<App />)
