import * as React from 'react'
import Papa from 'papaparse'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useT } from '@/hooks/useT'
import type { PreviewRendererProps } from '../preview-registry'

const MAX_ROWS = 100_000
/** 行数阈值：小于则用普通 table 布局（列对齐最稳），大于则切换到 div grid 虚滚 */
const VIRTUAL_THRESHOLD = 1000
/** 虚滚模式下的固定列宽（px），确保 header 和 body 对齐 */
const VIRTUAL_COL_WIDTH = 160

/**
 * CSV 预览器
 * - papaparse 一次性解析整个 CSV 文本
 * - < 1000 行用普通 <table> 布局（列宽自适应）
 * - ≥ 1000 行切换到 div + CSS grid 虚拟滚动（@tanstack/react-virtual）
 * - 超过 MAX_ROWS 行则截断，顶部显示警告
 */
export default function CsvRenderer({ path, onError }: PreviewRendererProps): React.ReactElement {
  const { t } = useT('preview')
  const [headers, setHeaders] = React.useState<string[]>([])
  const [rows, setRows] = React.useState<string[][]>([])
  const [truncated, setTruncated] = React.useState(false)
  const [totalRows, setTotalRows] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.previewReadText(path, 50 * 1024 * 1024).then((res) => {
      if (cancelled) return
      const parsed = Papa.parse<string[]>(res.content, { skipEmptyLines: true })
      if (parsed.errors.length > 0) {
        console.warn('[CsvRenderer] 解析警告:', parsed.errors)
      }
      const all = parsed.data
      const head = all[0] ?? []
      const body = all.slice(1)
      setHeaders(head)
      setTotalRows(body.length)
      if (body.length > MAX_ROWS) {
        setRows(body.slice(0, MAX_ROWS))
        setTruncated(true)
      } else {
        setRows(body)
        setTruncated(res.truncated)
      }
    }).catch((err) => onError(err instanceof Error ? err : new Error(String(err))))
    return () => { cancelled = true }
  }, [path, onError])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 工具栏 */}
      <div className="flex items-center gap-3 px-3 py-1 bg-muted/30 border-b border-border text-sm text-muted-foreground flex-shrink-0">
        <span>{t('csv.size', { cols: headers.length, rows: rows.length })}</span>
        {truncated && (
          <span className="text-warning">
            {t('csv.truncated', { max: MAX_ROWS.toLocaleString(), shown: rows.length.toLocaleString(), total: totalRows.toLocaleString() })}
          </span>
        )}
      </div>

      {rows.length < VIRTUAL_THRESHOLD
        ? <SimpleTable headers={headers} rows={rows} />
        : <VirtualTable headers={headers} rows={rows} />}
    </div>
  )
}

/** 普通表格：table-layout fixed + 等宽列，sticky header */
function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }): React.ReactElement {
  // 等宽列：每列平分容器宽度；配合 table-layout: fixed 保证 header 和 body 列严格对齐
  const colWidth = `${100 / Math.max(headers.length, 1)}%`
  return (
    <div className="flex-1 overflow-auto scrollbar-thin">
      {/* eslint-disable-next-line asci/min-font-size -- 渲染内容（代码/正文），不受应用 UI 14px 下限约束 */}
      <table className="w-full border-collapse text-[11px]" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          {headers.map((_, i) => <col key={i} style={{ width: colWidth }} />)}
        </colgroup>
        <thead className="sticky top-0 bg-muted z-10">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-2 py-1.5 text-left border border-border font-semibold truncate" title={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="px-2 py-1 border border-border align-top truncate"
                  title={cell}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 虚拟滚动表格：div + CSS grid + 固定列宽，确保 header/body 对齐 */
function VirtualTable({ headers, rows }: { headers: string[]; rows: string[][] }): React.ReactElement {
  const parentRef = React.useRef<HTMLDivElement | null>(null)
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 10,
  })

  const gridTemplate = headers.map(() => `${VIRTUAL_COL_WIDTH}px`).join(' ')

  return (
    <div ref={parentRef} className="flex-1 overflow-auto scrollbar-thin">
      {/* sticky header */}
      <div
        // eslint-disable-next-line asci/min-font-size -- 渲染内容（代码/正文），不受应用 UI 14px 下限约束
        className="sticky top-0 z-10 bg-muted text-[11px] font-semibold"
        style={{ display: 'grid', gridTemplateColumns: gridTemplate }}
      >
        {headers.map((h, i) => (
          <div key={i} className="px-2 py-1.5 border border-border whitespace-nowrap truncate">{h}</div>
        ))}
      </div>
      {/* 虚拟 body：总高 + 绝对定位行 */}
      <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map((vRow) => {
          const row = rows[vRow.index]
          if (!row) return null
          return (
            <div
              key={vRow.key}
              // eslint-disable-next-line asci/min-font-size -- 渲染内容（代码/正文），不受应用 UI 14px 下限约束
              className="text-[11px]"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                height: `${vRow.size}px`,
                width: `${headers.length * VIRTUAL_COL_WIDTH}px`,
                transform: `translateY(${vRow.start}px)`,
                display: 'grid',
                gridTemplateColumns: gridTemplate,
              }}
            >
              {row.map((cell, ci) => (
                <div
                  key={ci}
                  className="px-2 py-1 border border-border align-top truncate"
                  title={cell}
                >
                  {cell}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
