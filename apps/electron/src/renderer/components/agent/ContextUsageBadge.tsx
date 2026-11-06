/** Click-operated context capacity, retention and compaction report panel. */

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AIThinkingOrb } from '@/components/ui/ai-thinking-orb'
import type { ContextPin, ContextRecord } from '@asci/shared'
import { useT } from '@/hooks/useT'
import { cn } from '@/lib/utils'


interface ContextUsageBadgeProps {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  costUsd?: number
  contextWindow?: number
  isCompacting: boolean
  isProcessing: boolean
  sessionId: string
  candidates?: ContextPin[]
  onCompact: () => void | Promise<void>
}

/** 格式化 token 数为可读字符串（如 1234 → "1.2k"，200000 → "200k"） */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  }
  return `${tokens}`
}

/** 圆环进度指示器 — 16×16 SVG，描边 2px */
interface UsageRingProps {
  ratio: number
  isWarning: boolean
}
function UsageRing({ ratio, isWarning }: UsageRingProps): React.ReactElement {
  const radius = 8
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(1, ratio))
  const dashOffset = circumference * (1 - clamped)

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      className={cn(
        'shrink-0 transition-colors',
        isWarning ? 'text-warning' : 'text-foreground/70',
      )}
      aria-hidden="true"
    >
      {/* 背景轨道圆：strokeOpacity 0.3，比之前 0.2 略提亮，避免被进度弧抢走存在感 */}
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="2"
      />
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform="rotate(-90 10 10)"
        style={{ transition: 'stroke-dashoffset 300ms ease-out' }}
      />
    </svg>
  )
}

/** Popover 里的一行 key/value */
interface DetailRowProps {
  label: string
  value: string
  emphasized?: boolean
}
function DetailRow({ label, value, emphasized }: DetailRowProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-foreground/70">{label}</span>
      <span className={cn('tabular-nums', emphasized ? 'font-medium text-foreground' : 'text-foreground/90')}>
        {value}
      </span>
    </div>
  )
}

export function ContextUsageBadge({
  inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, contextWindow,
  isCompacting, isProcessing, onCompact, sessionId, candidates = [],
}: ContextUsageBadgeProps): React.ReactElement | null {
  const { i18n } = useT('conversation')
  const zh = i18n.language.startsWith('zh')
  const text = (cn: string, en: string): string => zh ? cn : en
  const [open, setOpen] = React.useState(false)
  const [record, setRecord] = React.useState<ContextRecord>({ pins: [] })
  const [saving, setSaving] = React.useState(false)
  const [localWorking, setLocalWorking] = React.useState(false)
  const [error, setError] = React.useState('')
  const [note, setNote] = React.useState('')
  const [before, setBefore] = React.useState<number | undefined>()
  const latestTokens = React.useRef<number | undefined>(inputTokens)
  const requestId = React.useRef(0)
  React.useEffect(() => {
    requestId.current += 1; setRecord({ pins: [] }); setError(''); setLocalWorking(false); setBefore(undefined); setOpen(false)
    latestTokens.current = inputTokens
  }, [sessionId])
  if (inputTokens && inputTokens > 0) latestTokens.current = inputTokens
  const refresh = React.useCallback(async (): Promise<void> => {
    const version = requestId.current
    try {
      const next = await window.electronAPI.getContextRecord(sessionId)
      if (version === requestId.current) setRecord(next)
    } catch (err) { if (version === requestId.current) setError(String(err)) }
  }, [sessionId])
  React.useEffect(() => {
    if (!open && !isCompacting && !localWorking) return
    void refresh()
    const timer = setInterval(() => { void refresh() }, 1500)
    return () => clearInterval(timer)
  }, [open, isCompacting, localWorking, refresh])
  const working = isCompacting || localWorking || (isProcessing && record.status === 'working')
  const tokens = latestTokens.current
  const percent = tokens && contextWindow ? Math.round(tokens / contextWindow * 100) : undefined
  const savePins = async (pins: ContextPin[]): Promise<void> => {
    setSaving(true); setError('')
    const version = requestId.current
    try { const next = await window.electronAPI.saveContextPins(sessionId, pins); if (version === requestId.current) { setRecord(next); setNote('') } }
    catch (err) { if (version === requestId.current) setError(String(err)) }
    finally { if (version === requestId.current) setSaving(false) }
  }
  const compact = async (): Promise<void> => {
    setBefore(tokens); setError(''); setLocalWorking(true)
    try { await onCompact(); await refresh() }
    catch (err) { setError(String(err)) }
    finally { setLocalWorking(false) }
  }
  if (!tokens && !working && !candidates.length) return null
  const choices = [...record.pins, ...candidates.filter(c => !record.pins.some(p => p.id === c.id))]
  const displayError = error || (record.status === 'failed' ? record.error ?? text('整理未完成，请重试。', 'Could not finish organizing. Please retry.') : '')
  const completed = !working && record.status === 'complete' && !!record.report
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon"
      className="size-9 rounded-full text-muted-foreground" aria-label={text('管理上下文', 'Manage context')}
      title={working ? text('正在整理上下文', 'Organizing context') : text(`上下文已使用 ${percent ?? '—'}%`, `Context used ${percent ?? '—'}%`)}>
      {working ? <AIThinkingOrb state="weaving" /> : <UsageRing ratio={(tokens ?? 0) / (contextWindow || 1)} isWarning={(percent ?? 0) >= 80} />}
    </Button></PopoverTrigger>
    <PopoverContent side="top" align="end" sideOffset={10} className="!bg-popover supports-[backdrop-filter]:!bg-popover w-[360px] max-w-[calc(100vw-32px)] max-h-[min(640px,var(--radix-popover-content-available-height))] overflow-y-auto p-4 space-y-4" onOpenAutoFocus={event => event.preventDefault()}>
      <div className="flex items-center justify-between"><h3 className="text-sm font-medium">{text('上下文', 'Context')}</h3><span className="text-xs tabular-nums text-muted-foreground">{percent == null ? '—' : `${percent}%`}</span></div>
      <div><div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground/70 transition-[width]" style={{ width: `${Math.min(100, percent ?? 0)}%` }} /></div>
        <p className="mt-2 text-xs text-muted-foreground tabular-nums">{tokens ? formatTokens(tokens) : '—'} / {contextWindow ? formatTokens(contextWindow) : '—'} tokens</p></div>
      <p className="text-xs leading-relaxed text-muted-foreground">{text('本轮会参考对话记录、项目资料与工具结果。整理会将较早内容汇总为摘要，原始聊天记录仍可浏览。', 'This conversation uses messages, project material and tool results. Organizing summarizes older context; your original chat remains available.')}</p>
      {working && <div role="status" className="flex items-start gap-2 rounded-lg bg-muted/50 p-3"><div><p className="text-xs font-medium">{text('正在整理上下文', 'Organizing context')}</p><p className="mt-1 text-xs text-muted-foreground">{text('正在生成摘要。你可以关闭面板继续浏览。', 'Creating a summary. You can close this panel and keep reading.')}</p></div></div>}
      {completed && <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-2"><p className="font-medium">{text('上下文已整理', 'Context organized')}</p>
        <p className="text-muted-foreground">{(record.report?.afterTokens ?? 0) > 0 ? text('用量来自整理后的实际模型请求。', 'Usage measured from the actual request after compaction.') : text('已生成真实摘要；容量将在下一次模型请求后更新。', 'Summary received. Capacity updates after the next model request.')}</p>
        {(record.report?.beforeTokens ?? before) != null && <p>{text('整理前', 'Before')}: {formatTokens((record.report?.beforeTokens ?? before)!)} tokens</p>}
        {(record.report?.afterTokens ?? 0) > 0 && <p>{text('整理后', 'After')}: {formatTokens(record.report!.afterTokens!)} tokens</p>}
        <details><summary className="cursor-pointer">{text('查看保留摘要', 'View summary')}</summary><p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed text-muted-foreground">{record.report?.summary}</p></details>
      </div>}
      {displayError && <p role="alert" className="text-xs text-destructive break-words">{text('操作未完成：', 'Could not complete: ')}{displayError}</p>}
      <details className="border-t border-border pt-3"><summary className="cursor-pointer text-xs font-medium">{text('固定保留内容', 'Retained excerpts')} · {record.pins.length}/20</summary>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{text('勾选的原文会单独保存，并重新带入后续请求。未勾选内容仍由 AI 正常整理，不会删除聊天。最多 24,000 字符。', 'Selected text is stored separately and reintroduced in future requests. Other content is still summarized normally. Chat is never deleted. Limit: 24,000 characters.')}</p>
        <div className="mt-3 max-h-52 overflow-y-auto space-y-2">{choices.map(pin => {
          const selected = record.pins.some(p => p.id === pin.id)
          return <div key={pin.id} className="rounded-lg border border-border p-2"><label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={selected} disabled={saving || working || isProcessing} onChange={() => { void savePins(selected ? record.pins.filter(p => p.id !== pin.id) : [...record.pins, pin]) }} /><span className="min-w-0 truncate">{pin.label}</span></label>
            <details className="mt-1 pl-5 text-xs text-muted-foreground"><summary className="cursor-pointer">{text('查看原文', 'View excerpt')}</summary>{selected ? <textarea aria-label={text('编辑保留内容', 'Edit retained excerpt')} defaultValue={pin.text} key={pin.text} maxLength={24000} disabled={saving || working || isProcessing} className="mt-2 min-h-20 w-full rounded border border-border bg-transparent p-2 text-xs" onBlur={event => { const value = event.target.value.trim(); if (value && value !== pin.text) void savePins(record.pins.map(p => p.id === pin.id ? { ...p, text: value } : p)) }} /> : <p className="mt-1 whitespace-pre-wrap break-words">{pin.text}</p>}</details></div>
        })}</div>
        <textarea aria-label={text('添加保留备注', 'Add retained note')} placeholder={text('补充必须保留的目标、约束或结论…', 'Add an important goal, constraint or decision…')} maxLength={6000} value={note} onChange={event => setNote(event.target.value)} className="mt-3 min-h-16 w-full rounded-lg border border-border bg-transparent p-2 text-xs" />
        <Button variant="outline" size="sm" className="mt-2 h-7 text-xs" disabled={!note.trim() || saving || working || isProcessing} onClick={() => { const value = note.trim(); void savePins([...record.pins, { id: crypto.randomUUID(), label: value.slice(0, 70), text: value }]) }}>{text('添加备注', 'Add note')}</Button>
      </details>
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{text('用量明细', 'Usage details')}</summary><div className="mt-2 space-y-1"><DetailRow label="Input" value={String(inputTokens ?? '—')} /><DetailRow label="Output" value={String(outputTokens ?? '—')} /><DetailRow label="Cache read" value={String(cacheReadTokens ?? '—')} /><DetailRow label="Cache write" value={String(cacheCreationTokens ?? '—')} /></div></details>
      <Button className="h-8 w-full text-xs" disabled={working || isProcessing || saving || !tokens} onClick={() => { void compact() }}>{working ? text('正在整理…', 'Organizing…') : displayError ? text('重试整理', 'Retry') : text('整理上下文', 'Organize context')}</Button>
    </PopoverContent>
  </Popover>
}
