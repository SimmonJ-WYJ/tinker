/**
 * ZoteroLinkDialog — 加入 Zotero 文献库弹窗
 *
 * 写入位置由用户在 ZoteroCollectionTree 里选定（F39 改进版）：
 *   - "Use Zotero current selection"：沿用 Zotero UI 选中
 *   - "My Library"：强制移到「我的文献库」根（无历史选择时的默认，避免静默跟随 Zotero UI）
 *   - 具体 collection：PATCH 到该 collection
 *
 * 默认值解析顺序：byWorkspace[workspaceId] > global > myLibrary。
 * 提交成功后同时写回 byWorkspace（有 workspace）+ global，作为下次默认。
 *
 * 状态门控由 useZoteroReadyGate 统一处理（见 zotero-ready-gate.tsx）：未运行/未安装时
 * 渲染引导块而非选位置 picker，避免 listCollections 失败。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAtomValue } from 'jotai'
import { currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { useT } from '@/hooks/useT'
import type { WorkspacePaperEntry } from '@asci/shared'
import { MAX_AUTHORS_COMPACT, sanitizeText } from '@asci/shared'
import { ZoteroCollectionTree } from './ZoteroCollectionTree'
import { useZoteroReadyGate, ZoteroNotReadyGuard } from './zotero-ready-gate'
import {
  type DestSelection,
  type FlatNode,
  destToTargetTreeViewID,
  flattenCollectionTargets,
  resolveDefaultDest,
  serializeDest,
  ZOTERO_TREE_MY_LIBRARY,
} from '@/lib/zotero-destination'

interface ZoteroLinkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: WorkspacePaperEntry | null
}

export function ZoteroLinkDialog({ open, onOpenChange, entry }: ZoteroLinkDialogProps): React.ReactElement {
  const { t } = useT('library')
  const workspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  // null = 用户尚未选择 destination；Confirm 禁用直到选定。打开时由 resolveDefaultDest 预填
  // （含 remembered 选择 / My Library 默认），故"任意选择即视为已定义"。
  const [dest, setDest] = React.useState<DestSelection | null>(null)
  const [tagsInput, setTagsInput] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
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
      console.warn('[Zotero] 加载 collection 失败:', err)
      setLoadError(err instanceof Error ? err.message : String(err))
      setNodes([])
    } finally {
      setLoading(false)
    }
  }, [])

  // 状态门控：就绪时（含启动连上后）自动拉 collection
  const { gate, launching, handleLaunch } = useZoteroReadyGate(open, reloadCollections)

  // 弹窗打开时：重置表单 + 解析默认 destination（collection 拉取交给 ready gate）
  React.useEffect(() => {
    if (!open) return
    setTagsInput('')
    setSubmitting(false)
    void (async () => {
      try {
        const s = await window.electronAPI.getSettings()
        setDest(resolveDefaultDest(
          s.zoteroLastCollectionKeyByWorkspace,
          s.zoteroLastCollectionKey,
          workspaceId ?? null,
        ))
      } catch (err) {
        console.warn('[Zotero] 读取上次 destination 失败:', err)
        setDest({ kind: 'target', treeViewID: ZOTERO_TREE_MY_LIBRARY })
      }
    })()
  }, [open, workspaceId])

  /** 取当前 destination 的显示名（用于 toast） */
  const destDisplayName = (): string | null => {
    if (dest?.kind === 'target') {
      return nodes.find((n) => n.treeViewID === dest.treeViewID)?.name ?? null
    }
    return null
  }

  const handleConfirm = async (): Promise<void> => {
    if (!entry || !workspaceId || !dest) return
    const tags = tagsInput.split(',').map((s) => s.trim()).filter(Boolean)
    setSubmitting(true)
    try {
      const result = await window.electronAPI.workspacePapers.linkZotero(
        workspaceId,
        entry.key,
        { tags, targetTreeViewID: destToTargetTreeViewID(dest) },
      )
      // 把选择写回 settings：byWorkspace（按项目）+ global（兜底）
      void persistDest(dest, workspaceId)

      const name = destDisplayName()
      // 目标 collection 移动失败：item 已建但仍在 Zotero 当前选中处，改报告警而非成功
      if (result.collectionStatus === 'failed' && name) {
        toast.warning(t('linkDialog.movedFailed', { name }))
      } else {
        const pdfAttached = result.pdfStatus === 'attached'
        const successKey = name
          ? pdfAttached ? 'linkDialog.successWithTargetAndPdf' : 'linkDialog.successWithTarget'
          : pdfAttached ? 'linkDialog.successPlainWithPdf' : 'linkDialog.successPlain'
        toast.success(t(successKey, { name: name ?? '' }))
      }
      onOpenChange(false)
    } catch (err) {
      console.error('[加入 Zotero] 失败:', err)
      toast.error(err instanceof Error ? err.message : t('linkDialog.fail'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('linkDialog.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {gate === 'ready' ? (
            <>
              <div className="text-sm font-medium line-clamp-2">{sanitizeText(entry?.title)}</div>
              {entry?.authors && Array.isArray(entry.authors) && entry.authors.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  {entry.authors.slice(0, MAX_AUTHORS_COMPACT).join(', ')}
                  {entry.authors.length > MAX_AUTHORS_COMPACT ? ' et al.' : ''}
                </div>
              )}

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
                <label htmlFor="zotero-link-tags" className="text-xs font-medium mb-1 block">
                  {t('linkDialog.tagsLabel')}
                </label>
                <Input
                  id="zotero-link-tags"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder={t('linkDialog.tagsPlaceholder')}
                  className="text-sm"
                />
              </div>
            </>
          ) : (
            <ZoteroNotReadyGuard gate={gate} launching={launching} onLaunch={() => { void handleLaunch() }} />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>{t('linkDialog.cancel')}</Button>
          {gate === 'ready' && (
            <Button onClick={() => { void handleConfirm() }} disabled={submitting || !entry || !workspaceId || !dest}>
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {submitting ? t('linkDialog.submitting') : t('linkDialog.submit')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 把当前 destination 同时写回 byWorkspace + global。
 * workspaceId 为 null 时只写 global（citation graph orphan 调用方亦可复用）。
 */
export async function persistDest(dest: DestSelection, workspaceId: string | null): Promise<void> {
  const serialized = serializeDest(dest)
  try {
    const current = await window.electronAPI.getSettings()
    const updates: { zoteroLastCollectionKey: string; zoteroLastCollectionKeyByWorkspace?: Record<string, string> } = {
      zoteroLastCollectionKey: serialized,
    }
    if (workspaceId) {
      updates.zoteroLastCollectionKeyByWorkspace = {
        ...(current.zoteroLastCollectionKeyByWorkspace ?? {}),
        [workspaceId]: serialized,
      }
    }
    await window.electronAPI.updateSettings(updates)
  } catch (err) {
    console.warn('[Zotero] 写入 destination 设置失败:', err)
  }
}
