/**
 * DOI 点击 → 右栏文献详情 的解析 hook（spec: docs/specs/doi-paper-jump-spec.md §5.2）
 *
 * 三层兜底、永不留死胡同：
 *   1. 命中「本次检索」（listSessionPapers × workspacePapers 同面板口径合并）
 *      → 打开与面板点击一致的详情页（entry 优先），并设置 siblings 翻页
 *   2. 未命中 → 主进程 crossref 即时查询（5s 超时）→ 临时 record 详情页（无翻页，
 *      不写入本次检索 —— 保护检索报告统计口径）
 *   3. 查询失败 / 超时 → toast 提示 + 系统浏览器打开 doi.org 页面
 *
 * loading 态由调用方（DoiChip）自持；本 hook 只负责解析与跳转。
 */
import { useCallback } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms.ts'
import { workspacePapersAtom } from '@/atoms/workspace-papers-atoms'
import { previewPaperSiblingsAtom } from '@/atoms/side-panel-layout.ts'
import { buildMergedPaperItems } from '@/components/agent/session-papers-filter'
import { recordKey } from '@/components/agent/session-papers-utils'
import { normalizeDoi } from '@/lib/doi.ts'
import { useT } from '@/hooks/useT'
import { useOpenInRightPanel } from './useOpenInRightPanel.ts'

/** 解析结果（调用方目前只关心 promise 完结以收口 loading，类型供测试/扩展） */
export type OpenDoiResult =
  | 'opened-entry'      // 命中本次检索且已入工作区
  | 'opened-record'     // 命中本次检索（仅 record）
  | 'opened-lookup'     // crossref 即时查询命中
  | 'opened-external'   // 走 doi.org 外链兜底
  | 'invalid'           // 入参不是合法 DOI（理论不可达，chip 渲染前已校验）

export function useOpenDoiInRightPanel(): (doi: string) => Promise<OpenDoiResult> {
  const sessionId = useAtomValue(currentAgentSessionIdAtom)
  const workspacePapers = useAtomValue(workspacePapersAtom)
  const setPaperSiblings = useSetAtom(previewPaperSiblingsAtom)
  const openInRightPanel = useOpenInRightPanel()
  const { t } = useT('conversation')

  return useCallback(
    async (doi: string) => {
      const norm = normalizeDoi(doi)
      if (!norm) return 'invalid'

      // —— 第 1 层：本次检索匹配（点击时实时取数，历史会话同样生效）——
      if (sessionId) {
        try {
          const res = await window.electronAPI.listSessionPapers(sessionId)
          const merged = buildMergedPaperItems(res.records, workspacePapers)
          const key = `doi:${norm}`
          const idx = merged.findIndex(
            (it) =>
              recordKey(it.record) === key ||
              it.entry?.doi?.toLowerCase() === norm,
          )
          if (idx >= 0) {
            const hit = merged[idx]!
            setPaperSiblings({ items: merged, currentIndex: idx })
            if (hit.entry) {
              openInRightPanel({ kind: 'paper-entry', entry: hit.entry })
              return 'opened-entry'
            }
            openInRightPanel({ kind: 'paper', record: hit.record })
            return 'opened-record'
          }
        } catch (err) {
          // 列表读取失败不终结链路：落到 crossref / 外链兜底
          console.error('[doi-jump] listSessionPapers 失败，跳过本地匹配:', err)
        }
      }

      // —— 第 2 层：crossref 即时查询（主进程 5s 超时，永不 reject）——
      try {
        const res = await window.electronAPI.papers.lookupDoiMetadata({ doi: norm })
        if (res.status === 'found') {
          setPaperSiblings(null) // 临时 record 不参与翻页
          openInRightPanel({ kind: 'paper', record: res.record })
          return 'opened-lookup'
        }
      } catch (err) {
        console.error('[doi-jump] lookupDoiMetadata IPC 异常:', err)
      }

      // —— 第 3 层：外链兜底 ——
      toast.info(t('doiChip.lookupFallback'))
      try {
        await window.electronAPI.openExternal(`https://doi.org/${norm}`)
      } catch (err) {
        console.error('[doi-jump] openExternal 失败:', err)
      }
      return 'opened-external'
    },
    [sessionId, workspacePapers, setPaperSiblings, openInRightPanel, t],
  )
}
