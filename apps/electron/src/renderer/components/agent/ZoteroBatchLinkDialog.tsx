/**
 * ZoteroBatchLinkDialog — 批量加入 Zotero 弹窗
 *
 * 复用 ZoteroLinkDialog 的"读 destination → 收集 tags → 提交"骨架，
 * 但提交时按顺序逐条调用 linkZotero（Zotero 远程协议是单条接口，
 * 排队提交避免并发竞态），并向上层反馈每条的成功/失败。
 *
 * 失败回流：onComplete(failedSelectionKeys) 让上层保留失败项的勾选态，便于重试。
 *
 * 状态门控由 useZoteroReadyGate 统一处理（与 ZoteroLinkDialog 一致）：未运行/未安装/
 * 未开远程时渲染引导块而非 picker，且 ready 隐含 remoteEnabled → 保证后续 PATCH 可写。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/hooks/useT'
import type { WorkspacePaperEntry } from '@asci/shared'
import { sanitizeText } from '@asci/shared'
import { ZoteroCollectionTree } from './ZoteroCollectionTree'
import { persistDest } from './ZoteroLinkDialog'
import { useZoteroReadyGate, ZoteroNotReadyGuard } from './zotero-ready-gate'
import {
  type DestSelection,
  type FlatNode,
  destToTargetTreeViewID,
  flattenCollectionTargets,
  resolveDefaultDest,
} from '@/lib/zotero-destination'

export interface BatchLinkItem {
  /** 上层用来回流"失败保留勾选"的稳定 key */
  selectionKey: string
  entry: WorkspacePaperEntry
}

interface ZoteroBatchLinkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: BatchLinkItem[]
  workspaceId: string | null
  /** 提交结束时回调：返回失败项的 selectionKey 列表（成功时为空数组） */
  onComplete: (failedSelectionKeys: string[]) => void
}

const PREVIEW_LIMIT = 5

export function ZoteroBatchLinkDialog({
  open,
  onOpenChange,
  items,
  workspaceId,
  onComplete,
}: ZoteroBatchLinkDialogProps): React.ReactElement {
  const { t } = useT('library')
  // null = 用户尚未选择 destination；Confirm 禁用直到选定（打开时由 resolveDefaultDest 预填）
  const [dest, setDest] = React.useState<DestSelection | null>(null)
  const [tagsInput, setTagsInput] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [progressDone, setProgressDone] = React.useState(0)
  const [nodes, setNodes] = React.useState<FlatNode[]>([])
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const reloadCollections = React.useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const list = await window.electronAPI.zotero.library.listCollectionTargets()
      setNodes(flattenCollectionTargets(list))
    } catch (err) {
      console.warn('[Zotero 批量] 加载 collection 失败:', err)
      setLoadError(err instanceof Error ? err.message : String(err))
      setNodes([])
    } finally {
      setLoading(false)
    }
  }, [])

  // 状态门控：就绪时（含启动连上后）自动拉 collection（与单条弹窗一致）
  const { gate, launching, handleLaunch } = useZoteroReadyGate(open, reloadCollections)

  // 弹窗打开时：重置表单 + 解析默认 destination（collection 拉取交给 ready gate）
  React.useEffect(() => {
    if (!open) return
    setTagsInput('')
    setProgressDone(0)
    setSubmitting(false)
    void (async () => {
      try {
        const s = await window.electronAPI.getSettings()
        setDest(resolveDefaultDest(
          s.zoteroLastCollectionKeyByWorkspace,
          s.zoteroLastCollectionKey,
          workspaceId,
        ))
      } catch (err) {
        console.warn('[Zotero 批量] 读取上次 destination 失败:', err)
        // 保持 null —— 读取失败时不臆造默认，Confirm 维持禁用直到用户主动选
      }
    })()
  }, [open, workspaceId])

  const total = items.length

  const destDisplayName = (): string | null => {
    if (dest?.kind === 'target') {
      return nodes.find((n) => n.treeViewID === dest.treeViewID)?.name ?? null
    }
    return null
  }

  const handleConfirm = async () => {
    if (!workspaceId || total === 0 || !dest) return
    const tags = tagsInput.split(',').map((s) => s.trim()).filter(Boolean)
    const targetTreeViewID = destToTargetTreeViewID(dest)
    const failed: string[] = []
    // 写入成功但 updateSession 移到目标 collection 失败的条数（留在 Zotero 当前选中处）
    let moveFailed = 0
    setSubmitting(true)
    setProgressDone(0)
    try {
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!
        try {
          const result = await window.electronAPI.workspacePapers.linkZotero(
            workspaceId,
            it.entry.key,
            { tags, targetTreeViewID },
          )
          if (result.collectionStatus === 'failed') moveFailed++
        } catch (err) {
          console.error('[Zotero 批量] 单条失败:', it.entry.key, err)
          failed.push(it.selectionKey)
        }
        setProgressDone(i + 1)
      }

      // 批量至少成功一条时把 destination 记下来作为下次默认
      if (failed.length < total) {
        void persistDest(dest, workspaceId)
      }

      const successCount = total - failed.length
      const name = destDisplayName()
      if (failed.length === 0 && moveFailed > 0 && name) {
        // 全部写入成功，但部分未能移到目标 collection → 告警而非纯成功
        toast.warning(t('batchLinkDialog.successAllButMoveFailed', { count: total, moveFailed, name }))
      } else if (failed.length === 0) {
        const key = name ? 'batchLinkDialog.successAllWithTarget' : 'batchLinkDialog.successAll'
        toast.success(t(key, { count: total, name: name ?? '' }))
      } else if (successCount === 0) {
        toast.error(t('batchLinkDialog.allFailed', { count: total }))
      } else {
        toast.warning(
          t('batchLinkDialog.partial', { success: successCount, failed: failed.length }),
        )
      }
      onComplete(failed)
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancel = () => {
    if (submitting) return
    onOpenChange(false)
  }

  const previewTitles = items.slice(0, PREVIEW_LIMIT)
  const overflow = Math.max(0, total - previewTitles.length)

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) onOpenChange(o) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('batchLinkDialog.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="text-sm font-medium">
            {t('batchLinkDialog.summary', { count: total })}
          </div>

          {previewTitles.length > 0 && (
            <ul className="space-y-1 max-h-32 overflow-y-auto bg-muted/30 rounded px-2 py-1.5 scrollbar-thin">
              {previewTitles.map((it) => {
                const cleanTitle = sanitizeText(it.entry.title)
                const display = cleanTitle || it.entry.doi || it.entry.url || it.entry.key
                return (
                  <li
                    key={it.selectionKey}
                    className="text-xs text-muted-foreground line-clamp-1"
                    title={cleanTitle}
                  >
                    · {display}
                  </li>
                )
              })}
              {overflow > 0 && (
                <li className="text-xs text-muted-foreground/70">
                  {t('batchLinkDialog.summaryPreviewMore', { count: overflow })}
                </li>
              )}
            </ul>
          )}

          {gate === 'ready' ? (
            <>
              {/* Destination 块：F39 内联树 */}
              <div>
                <p className="text-xs font-medium mb-1">{t('linkDialog.targetLabel')}</p>
                <ZoteroCollectionTree
                  value={dest}
                  onChange={setDest}
                  nodes={nodes}
                  loading={loading}
                  error={loadError}
                  onReload={() => { void reloadCollections() }}
                  disabled={submitting}
                />
              </div>

              <div>
                <label htmlFor="zotero-batch-link-tags" className="text-xs font-medium mb-1 block">
                  {t('linkDialog.tagsLabel')}
                </label>
                <Input
                  id="zotero-batch-link-tags"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder={t('linkDialog.tagsPlaceholder')}
                  className="text-sm"
                  disabled={submitting}
                />
              </div>
            </>
          ) : (
            <ZoteroNotReadyGuard gate={gate} launching={launching} onLaunch={() => { void handleLaunch() }} />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={submitting}>
            {t('batchLinkDialog.cancel')}
          </Button>
          {gate === 'ready' && (
          <Button onClick={handleConfirm} disabled={submitting || !workspaceId || total === 0 || !dest}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {submitting
              ? t('batchLinkDialog.submitting', { done: progressDone, total })
              : t('batchLinkDialog.submit', { count: total })}
          </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
