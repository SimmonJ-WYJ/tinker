/**
 * 节点详情面板（Modal 右侧）
 *
 * 展示当前选中节点的元数据，并提供两个动作：
 *   - 跳转原文（DOI URL / OA landing）
 *   - 加入 Zotero（复用 workspacePapers.linkZotero，走工作区论文库链路）
 *
 * 设计取舍：只有当节点 DOI 已存在于工作区论文库时，linkZotero 才能直接调用。
 * v1 对于"图谱里发现的新论文（库外）"暂不支持一键加入 Zotero；打开原站即可。
 * v2 若接入 paper-search MCP / 工作区自动沉淀，这里的能力可以扩展。
 */

import { useMemo, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { BookMarked, Bookmark, ExternalLink, Library } from 'lucide-react'
import type { CitationGraphNode } from '@asci/shared'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  graphDataAtom,
  graphOpenStateAtom,
  graphSelectedNodeIdAtom,
  graphZoteroAddedKeysAtom,
} from '@/atoms/citation-graph-atoms'
import { workspacePapersAtom } from '@/atoms/workspace-papers-atoms'
import { NODE_COLOR } from './graph-colors'
import { useT } from '@/hooks/useT'
import { ZoteroQuickAddDialog, type ZoteroQuickAddPayload } from '@/components/agent/ZoteroQuickAddDialog'
import { sanitizeText } from '@asci/shared'

const KIND_LABEL_KEY: Record<CitationGraphNode['kind'], 'seed' | 'reference' | 'citedBy' | 'hop2'> = {
  seed: 'seed',
  reference: 'reference',
  cited_by: 'citedBy',
  hop2: 'hop2',
}

export function NodeInspector() {
  const { t } = useT('library')
  const openState = useAtomValue(graphOpenStateAtom)
  const data = useAtomValue(graphDataAtom)
  const selectedId = useAtomValue(graphSelectedNodeIdAtom)
  const zoteroAdded = useAtomValue(graphZoteroAddedKeysAtom)
  const setZoteroAdded = useSetAtom(graphZoteroAddedKeysAtom)
  const wsPapers = useAtomValue(workspacePapersAtom)
  // F39：加入 Zotero 走选择 collection 的弹窗
  const [zoteroDialogOpen, setZoteroDialogOpen] = useState(false)

  const node = useMemo<CitationGraphNode | null>(() => {
    if (selectedId && data.nodes.has(selectedId)) return data.nodes.get(selectedId)!
    // 默认显示 seed
    for (const n of data.nodes.values()) {
      if (n.kind === 'seed') return n
    }
    return null
  }, [selectedId, data.nodes])

  // 判断能否直接 linkZotero：需要工作区 + 节点 DOI 与工作区论文库有匹配
  // 必须在条件 return 之前调用（hooks 规则）
  const wsEntry = useMemo(() => {
    if (!node || !openState.workspaceId || !node.doi) return null
    const doiLower = node.doi.toLowerCase()
    return wsPapers.find((e) => e.doi?.toLowerCase() === doiLower) ?? null
  }, [openState.workspaceId, node, wsPapers])

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground p-6">
        {t('graph.node.loading')}
      </div>
    )
  }

  const hasUrl = Boolean(node.url)
  const hasDoi = Boolean(node.doi)
  const addedThisSession = zoteroAdded.has(node.id)
  const alreadyLinked = Boolean(node.linkedZoteroKey) || addedThisSession
  // 只要节点至少有标题就能加入；图谱里 99% 的节点都满足
  const canLinkZotero = !alreadyLinked && Boolean(node.title)

  const handleOpenUrl = async () => {
    if (!node.url) return
    try {
      await window.electronAPI.openExternal(node.url)
    } catch (error) {
      toast.error(t('graph.node.toast.openLinkFailed', { message: error instanceof Error ? error.message : String(error) }))
    }
  }

  const handleOpenZoteroDialog = (): void => {
    setZoteroDialogOpen(true)
  }

  const handleConfirmZotero = async ({ targetTreeViewID, tags }: ZoteroQuickAddPayload): Promise<void> => {
    try {
      let pdfStatus: 'attached' | 'no_pdf' | 'skipped' | 'unknown' = 'unknown'
      if (openState.workspaceId && wsEntry) {
        // 路径 1：节点对应的论文已在工作区论文库 → 走标准 linkZotero（会回写 linkedZoteroKey）
        const result = await window.electronAPI.workspacePapers.linkZotero(
          openState.workspaceId,
          wsEntry.key,
          { tags, targetTreeViewID },
        )
        pdfStatus = result.pdfStatus
      } else {
        // 路径 2：图谱节点不在工作区论文库 → 直接用节点字段创建 Zotero 条目
        const result = await window.electronAPI.citationGraph.addToZotero({
          title: node.title,
          authors: node.authors,
          year: node.year,
          venue: node.venue,
          doi: node.doi,
          url: node.url,
          tags,
          targetTreeViewID,
        })
        pdfStatus = result.pdfStatus
      }
      // 乐观更新（图谱会话内即时反馈）
      setZoteroAdded((prev) => {
        const next = new Set(prev)
        next.add(node.id)
        return next
      })
      // 仅展示成功挂附件的正面信号；resolver 报 no_pdf 时 Zotero 自带的
      // "Automatically find available PDFs" 仍可能后台挂上 PDF，避免误报负面 toast
      toast.success(pdfStatus === 'attached' ? t('graph.node.toast.addSuccessWithPdf') : t('graph.node.toast.addSuccess'))
    } catch (error) {
      toast.error(t('graph.node.toast.addFailed', { message: error instanceof Error ? error.message : String(error) }))
      throw error
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 gap-3 scrollbar-thin">
      {/* 节点角色 + 库内徽章 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge
          tone="neutral"
          variant="solid"
          className="text-white"
          style={{ backgroundColor: NODE_COLOR[node.kind] }}
        >
          {t(`graph.node.kind.${KIND_LABEL_KEY[node.kind]}`)}
        </Badge>
        {node.inLibrary && (
          <Badge tone="success" variant="outline">
            <Library className="h-3 w-3 mr-1" />
            {t('graph.node.inLibrary')}
          </Badge>
        )}
        {alreadyLinked && (
          <Badge tone="warning" variant="outline">
            <BookMarked className="h-3 w-3 mr-1" />
            {t('graph.node.alreadyAdded')}
          </Badge>
        )}
      </div>

      {/* 标题 */}
      <h3 className="text-base font-semibold leading-tight">{sanitizeText(node.title)}</h3>

      {/* 元数据 */}
      <div className="space-y-1 text-xs text-muted-foreground">
        {Array.isArray(node.authors) && node.authors.length > 0 && (
          <div>
            <span className="font-medium text-foreground">{t('graph.node.meta.authors')}</span>
            {node.authors.slice(0, 5).join('，')}
            {node.authors.length > 5 ? t('graph.node.meta.andOthers', { count: node.authors.length }) : ''}
          </div>
        )}
        {node.year && (
          <div>
            <span className="font-medium text-foreground">{t('graph.node.meta.year')}</span>
            {node.year}
          </div>
        )}
        {node.venue && (
          <div>
            <span className="font-medium text-foreground">{t('graph.node.meta.venue')}</span>
            {node.venue}
          </div>
        )}
        {node.citedByCount != null && (
          <div>
            <span className="font-medium text-foreground">{t('graph.node.meta.citedByCount')}</span>
            {node.citedByCount.toLocaleString()}
          </div>
        )}
        {node.doi && (
          <div className="break-all">
            <span className="font-medium text-foreground">{t('graph.node.meta.doi')}</span>
            {node.doi}
          </div>
        )}
      </div>

      {/* 操作 */}
      <div className="flex flex-col gap-2 mt-auto pt-3">
        <Button
          onClick={handleOpenUrl}
          disabled={!hasUrl}
          variant="default"
          size="sm"
          className="w-full"
        >
          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
          {hasDoi ? t('graph.node.actions.openDoi') : t('graph.node.actions.openUrl')}
        </Button>

        <Button
          onClick={handleOpenZoteroDialog}
          disabled={!canLinkZotero}
          variant={alreadyLinked ? 'outline' : 'secondary'}
          size="sm"
          className="w-full"
          title={
            alreadyLinked
              ? t('graph.node.actions.addedTitle')
              : !node.title
                ? t('graph.node.actions.missingTitleTitle')
                : wsEntry
                  ? t('graph.node.actions.useExistingTitle')
                  : t('graph.node.actions.createNewTitle')
          }
        >
          {alreadyLinked ? (
            <>
              <BookMarked className="h-3.5 w-3.5 mr-1.5" />
              {t('graph.node.alreadyAdded')}
            </>
          ) : (
            <>
              <Bookmark className="h-3.5 w-3.5 mr-1.5" />
              {t('graph.node.actions.addToZotero')}
            </>
          )}
        </Button>
      </div>

      <ZoteroQuickAddDialog
        open={zoteroDialogOpen}
        onOpenChange={setZoteroDialogOpen}
        title={node.title}
        authors={node.authors}
        workspaceId={openState.workspaceId ?? null}
        onConfirm={handleConfirmZotero}
      />
    </div>
  )
}
