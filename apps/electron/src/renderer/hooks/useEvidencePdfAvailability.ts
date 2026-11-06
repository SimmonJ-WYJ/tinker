/**
 * 证据集成员 paper 的"本地 PDF 是否可预览"批量探测 hook。
 *
 * 用于 PairedCardsList：详情打开时为每篇成员 paper 解析 zoteroKey → 本地 PDF 路径，
 * 让"Zotero 里已移除 / 无 PDF 附件"的条目提前以禁用态呈现（仍可点，点击 toast 提示）。
 *
 * 探测口径与 [[useOpenEvidenceInRightPanel]] 一致，共用 [[resolvePaperPdf]]。
 *
 * 返回 { availability, checking }：
 *   - availability: Map<paperId, boolean>，true=有可预览 PDF；
 *   - checking: 仍在探测中（首屏应等探测完再渲染条目，避免 enabled→disabled 闪烁）。
 * papers 为空时 checking=false（无可探测）。
 */
import * as React from 'react'
import type { Paper } from '@asci/shared'
import { resolvePaperPdf } from '@/lib/paper-pdf'

export interface EvidencePdfAvailability {
  availability: Map<string, boolean>
  checking: boolean
}

export function useEvidencePdfAvailability(
  papers: Paper[],
): EvidencePdfAvailability {
  const [availability, setAvailability] = React.useState<Map<string, boolean>>(
    () => new Map(),
  )
  const [checking, setChecking] = React.useState(false)

  // 以 paper id 列表作为依赖键：成员集合变化才重新探测
  const idsKey = React.useMemo(
    () => papers.map((p) => p.id).join(','),
    [papers],
  )

  React.useEffect(() => {
    let cancelled = false
    setAvailability(new Map())
    if (papers.length === 0) {
      setChecking(false)
      return
    }
    setChecking(true)

    void Promise.all(
      papers.map(async (p): Promise<[string, boolean]> => {
        try {
          const r = await resolvePaperPdf({
            zoteroKey: p.zoteroKey ?? null,
            doi: p.doi ?? null,
            paperId: p.id,
          })
          return [p.id, r.ok]
        } catch (err) {
          console.error('[useEvidencePdfAvailability] probe failed:', err)
          // 探测异常时不主动禁用，避免误伤可用条目
          return [p.id, true]
        }
      }),
    ).then((entries) => {
      if (cancelled) return
      setAvailability(new Map(entries))
      setChecking(false)
    })

    return () => {
      cancelled = true
    }
    // idsKey 已覆盖 papers 成员变化；papers 引用变化但 id 集合不变时无需重探
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  return { availability, checking }
}
