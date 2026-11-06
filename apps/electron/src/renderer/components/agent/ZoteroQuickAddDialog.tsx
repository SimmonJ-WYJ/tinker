/**
 * ZoteroQuickAddDialog — 通用"加入 Zotero"弹窗（F39 改进版）
 *
 * 包装 ZoteroCollectionTree，给非工作区路径（citation graph NodeInspector /
 * PaperDetailRenderer 没有 workspace 上下文时）也提供"选 destination + 加入"体验。
 *
 * onConfirm 收到 { dest, tags } 后由调用方自行触发实际 API
 * （workspacePapers.linkZotero / citationGraph.addToZotero），dialog 只负责选项收集。
 * Dialog 提交成功后会自己写回 settings（per-workspace + global）；调用方无需处理。
 */

import * as React from 'react'
import { MAX_AUTHORS_COMPACT, sanitizeText } from '@asci/shared'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/hooks/useT'
import { ZoteroCollectionTree } from './ZoteroCollectionTree'
import { useZoteroReadyGate, ZoteroNotReadyGuard } from './zotero-ready-gate'
import { persistDest } from './ZoteroLinkDialog'
import { captureFeedback } from '@/lib/telemetry'
import {
  type DestSelection,
  type FlatNode,
  destToTargetTreeViewID,
  flattenCollectionTargets,
  resolveDefaultDest,
} from '@/lib/zotero-destination'

export interface ZoteroQuickAddPayload {
  /** 目标 treeViewID：null=zoteroCurrent, 'L1'=我的文献库根, 'C<整数>'=collection */
  targetTreeViewID: string | null
  tags: string[]
}

interface ZoteroQuickAddDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 论文标题，供弹窗顶部预览（可选） */
  title?: string
  /** 作者列表，供弹窗顶部预览（可选） */
  authors?: string[]
  /** 当前 workspace id；为 null 时只用全局默认（citation-graph orphan 场景） */
  workspaceId?: string | null
  /**
   * 用户点确认时回调；调用方自行执行 API 调用并处理 toast。
   * 返回值用于决定是否关闭弹窗（resolved → 关；rejected → 保留弹窗让用户重试）。
   */
  onConfirm: (payload: ZoteroQuickAddPayload) => Promise<void>
}

export function ZoteroQuickAddDialog({
  open,
  onOpenChange,
  title,
  authors,
  workspaceId,
  onConfirm,
}: ZoteroQuickAddDialogProps): React.ReactElement {
  const { t } = useT('library')
  // null = 用户尚未选择 destination；Confirm 禁用直到选定（打开时由 resolveDefaultDest 预填）
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
      console.warn('[Zotero 快速加入] 加载 collection 失败:', err)
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
        console.warn('[Zotero 快速加入] 读取默认 destination 失败:', err)
        // 保持 null —— 读取失败时不臆造默认，Confirm 维持禁用直到用户主动选
      }
    })()
  }, [open, workspaceId])

  const handleConfirm = async (): Promise<void> => {
    if (!dest) return
    const tags = tagsInput.split(',').map((s) => s.trim()).filter(Boolean)
    setSubmitting(true)
    try {
      await onConfirm({ targetTreeViewID: destToTargetTreeViewID(dest), tags })
      void persistDest(dest, workspaceId ?? null)
      // 自进化隐式反馈（#427）：保存论文到 Zotero = 对检索产出的正向信号
      captureFeedback('save', 'paper')
      onOpenChange(false)
    } catch (err) {
      // toast 由调用方负责；这里保留弹窗
      console.error('[Zotero 快速加入] 失败:', err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) onOpenChange(o) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('linkDialog.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {gate === 'ready' ? (
            <>
              {title && <div className="text-sm font-medium line-clamp-2">{sanitizeText(title)}</div>}
              {authors && authors.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  {authors.slice(0, MAX_AUTHORS_COMPACT).join(', ')}{authors.length > MAX_AUTHORS_COMPACT ? ' et al.' : ''}
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
                <label htmlFor="zotero-quick-add-tags" className="text-xs font-medium mb-1 block">
                  {t('linkDialog.tagsLabel')}
                </label>
                <Input
                  id="zotero-quick-add-tags"
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('linkDialog.cancel')}
          </Button>
          {gate === 'ready' && (
            <Button onClick={() => { void handleConfirm() }} disabled={submitting || !dest}>
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {submitting ? t('linkDialog.submitting') : t('linkDialog.submit')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
