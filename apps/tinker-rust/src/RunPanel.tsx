// 独立离线测试面板：只读取父草稿，不修改既有草稿/发送链路。
import React, { useEffect, useRef, useState } from 'react'
import type { TextKey } from './i18n.ts'
import { decodeRunPage, decodeRunSnapshot, isRunActive } from './run-contract.ts'
import type { RunScenario, RunSnapshot } from './run-contract.ts'
interface RunPanelProps {
  input: string
  t: (key: TextKey) => string
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>
}
interface StartRequest { requestId: string; input: string; scenario: RunScenario }
const statusKeys: Record<RunSnapshot['status'], TextKey> = {
  queued: 'runQueued', running: 'runRunning', waitingInput: 'runWaitingInput', completed: 'runCompleted',
  failed: 'runFailed', cancelled: 'runCancelled', interrupted: 'runInterrupted',
}
const errorKeys: TextKey[] = ['nativeRequired', 'protocolMismatch', 'runNotFound', 'runBusy', 'runInvalidOptions', 'requestConflict',
  'storeIo', 'unsafePath', 'corruptLog', 'unsupportedVersion', 'storeLocked', 'runLimitExceeded', 'recoveryRequired', 'runUnavailable', 'emptyInput', 'inputTooLarge']
function errorKey(cause: unknown): TextKey { return errorKeys.includes(cause as TextKey) ? cause as TextKey : 'runUnknownError' }
function snapshotErrorKey(code: string | null | undefined): TextKey | undefined {
  if (code === 'offlineFixtureFailed') return 'runFixtureFailure'
  if (code === 'processInterrupted') return 'runProcessInterrupted'
  if (code === 'truncatedLog') return 'runTruncatedLog'
  return errorKeys.includes(code as TextKey) ? code as TextKey : undefined
}

export function RunPanel({ input, t, invoke }: RunPanelProps): React.ReactElement {
  const [scenario, setScenario] = useState<RunScenario>('success')
  const [snapshot, setSnapshot] = useState<RunSnapshot>()
  const [error, setError] = useState<TextKey>()
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState<StartRequest>()
  const generation = useRef(0)
  const actionPending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const currentSnapshot = useRef<RunSnapshot>()
  function invalidate(): number {
    generation.current += 1
    clearTimeout(timer.current)
    return generation.current
  }
  useEffect(() => () => { invalidate() }, [])
  function accept(value: RunSnapshot) { currentSnapshot.current = value; setSnapshot(value) }
  function schedule(value: RunSnapshot, cursor: number, current: number) {
    if (!isRunActive(value) || generation.current !== current) return
    timer.current = setTimeout(() => void poll(value.runId, cursor, current), 100)
  }
  async function poll(runId: string, cursor: number, current: number) {
    try {
      const page = decodeRunPage(await invoke('read_lab_run', { runId, afterSequence: cursor, limit: 64 }), cursor)
      if (generation.current !== current) return
      if (page.snapshot.runId !== runId || page.snapshot.sequence < (currentSnapshot.current?.sequence ?? 0)) throw 'protocolMismatch'
      accept(page.snapshot)
      schedule(page.snapshot, page.nextAfterSequence, current)
    } catch (cause) {
      if (generation.current === current) setError(errorKey(cause))
    }
  }
  async function start(request?: StartRequest) {
    if (actionPending.current || isRunActive(currentSnapshot.current)) return
    actionPending.current = true
    const current = invalidate()
    const next = request ?? { requestId: crypto.randomUUID(), input, scenario }
    setBusy(true); setError(undefined); setRetry(undefined)
    try {
      const value = decodeRunSnapshot(await invoke('start_lab_run', { ...next }))
      if (generation.current !== current) return
      if (value.requestId !== next.requestId || value.input !== next.input || value.scenario !== next.scenario) throw 'protocolMismatch'
      accept(value)
      schedule(value, value.sequence, current)
    } catch (cause) {
      if (generation.current !== current) return
      setError(errorKey(cause)); setRetry(next)
    } finally {
      if (generation.current === current) { actionPending.current = false; setBusy(false) }
    }
  }
  async function restore() {
    if (actionPending.current) return
    actionPending.current = true
    const current = invalidate()
    setBusy(true); setError(undefined)
    try {
      const page = decodeRunPage(await invoke('read_lab_run', { afterSequence: 0, limit: 64 }))
      if (generation.current !== current) return
      accept(page.snapshot); setRetry(undefined)
      schedule(page.snapshot, page.nextAfterSequence, current)
    } catch (cause) {
      if (generation.current === current) setError(errorKey(cause))
    } finally {
      if (generation.current === current) { actionPending.current = false; setBusy(false) }
    }
  }
  async function cancel() {
    const previous = currentSnapshot.current
    if (!previous || !isRunActive(previous) || actionPending.current) return
    actionPending.current = true
    const current = invalidate()
    setBusy(true); setError(undefined)
    try {
      const value = decodeRunSnapshot(await invoke('cancel_lab_run', { runId: previous.runId }))
      if (generation.current !== current) return
      if (value.runId !== previous.runId || value.sequence < previous.sequence) throw 'protocolMismatch'
      accept(value)
      schedule(value, value.sequence, current)
    } catch (cause) {
      if (generation.current === current) setError(errorKey(cause))
    } finally {
      if (generation.current === current) { actionPending.current = false; setBusy(false) }
    }
  }
  const active = isRunActive(snapshot)
  const snapshotError = snapshotErrorKey(snapshot?.errorCode)
  return <section className="run-panel" aria-labelledby="run-title">
    <h2 id="run-title">{t('runTitle')}</h2>
    <p className="history-scope">{t('runScope')}</p>
    <p className="run-label">{t('runInput')}</p><pre className="run-text">{input || t('runEmptyInput')}</pre>
    <label className="run-label" htmlFor="run-scenario">{t('runScenario')}</label>
    <select id="run-scenario" value={scenario} disabled={busy || active} onChange={event => setScenario(event.target.value as RunScenario)}>
      <option value="success">{t('runSuccessScenario')}</option><option value="failure">{t('runFailureScenario')}</option><option value="slow">{t('runSlowScenario')}</option>
    </select>
    <div className="actions">
      <button type="button" disabled={busy || active || !input.trim()} onClick={() => void start()}>{t('runStart')}</button>
      {retry && <button type="button" disabled={busy || active} onClick={() => void start(retry)}>{t('runRetry')}</button>}
      <button type="button" disabled={busy || !active} onClick={() => void cancel()}>{t('runCancel')}</button>
      <button type="button" disabled={busy} onClick={() => void restore()}>{t('runRestore')}</button>
    </div>
    {error && <p className="notice error" role="alert">{t(error)}</p>}
    {snapshot && <div aria-busy={busy}>
      <p role="status" className="run-label">{t(statusKeys[snapshot.status])}</p>
      {snapshotError && <p className="notice error">{t(snapshotError)}</p>}
      {(snapshot.recoveryRequired || snapshot.status === 'interrupted') && <p className="notice">{t('runRecovery')}</p>}
      <p className="run-label">{t('runPreservedInput')}</p><pre className="run-text">{snapshot.input}</pre>
      <p className="run-label">{t('runOutput')}</p><pre className="run-text">{snapshot.output || t('runEmptyOutput')}</pre>
    </div>}
  </section>
}
