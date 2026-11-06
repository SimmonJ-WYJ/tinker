/**
 * EvidenceSet 详情右侧抽屉容器
 *
 * 单一开关由 openEvidenceSetIdAtom 驱动；Sheet 实例只在视图根挂一次。
 *
 * 数据：openId 变化时调 `evidenceSets:getDetail` IPC 拉真实持久化数据
 * （EvidenceSetDetail：set + note + refs + memberPapers …）。
 *
 * 排版：note 段落与论文按 index 顺序"位置匹配"（addPaper noteAddendum 顺序
 * 追加 → paragraphs[i] 配 memberPapers[i]），合并到一张卡片内：
 *   ┌── 卡片 ──────────────┐
 *   │ 说明 (主)   ✎ 🗑     │
 *   │ ───── divider ─────  │
 *   │ 论文标题 (轻)         │
 *   │ meta · 当前论文徽章   │
 *   └─────────────────────┘
 * 缺 note 的论文：只渲染下半段。
 * 多余段落（paragraphs > papers）：放最后作为 note-only 卡片。
 *
 * 编辑：hover 卡片右上角出现 ✎ + 🗑。✎ → 段落 inline textarea；🗑 → 删除段落
 * （论文留在集合里）。两条操作都走 notes:updateBody + 本地乐观更新。
 */
import * as React from 'react'
import { useAtom } from 'jotai'
import { Loader2 } from 'lucide-react'
import { useT } from '@/hooks/useT'
import type { EvidenceSetDetail } from '@asci/shared'
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetTitle } from '@/components/ui/sheet'
import { openEvidenceSetIdAtom } from '@/atoms/open-evidence-set-atom'
import { SetHeader } from './evidence-set-detail/SetHeader'
import { EvidenceSetMembers } from './evidence-set-detail/EvidenceSetMembers'

export function EvidenceSetDetailSheet(): React.ReactElement {
  const { t } = useT('library')
  const [openId, setOpenId] = useAtom(openEvidenceSetIdAtom)
  const [detail, setDetail] = React.useState<EvidenceSetDetail | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(false)

  React.useEffect(() => {
    if (!openId) {
      setDetail(null)
      setError(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(false)
    // 切 openId 时先清掉旧 detail，避免新 detail 到达前用户在旧内容上做编辑——
    // 配合 PairedCardsList 的 editingIndex 重置形成双重保险。
    setDetail(null)
    window.electronAPI.evidenceSets
      .getDetail({ id: openId })
      .then((result) => {
        if (cancelled) return
        if (!result) {
          setError(true)
          setDetail(null)
        } else {
          setDetail(result)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('[EvidenceSetDetailSheet] getDetail failed:', err)
        setError(true)
        setDetail(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [openId])

  const handleOpenChange = (open: boolean): void => {
    if (!open) setOpenId(null)
  }

  return (
    <Sheet open={openId !== null} onOpenChange={handleOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="sr-only">{t('evidenceSetDetail.title')}</SheetTitle>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t('evidenceSetDetail.loading')}
            </div>
          ) : error ? (
            <p className="text-sm text-muted-foreground">
              {t('evidenceSetDetail.empty.setNotFound')}
            </p>
          ) : detail ? (
            <SetHeader detail={detail} onUpdateDetail={setDetail} />
          ) : null}
        </SheetHeader>

        {detail && (
          <SheetBody className="p-6">
            <EvidenceSetMembers detail={detail} onUpdateDetail={setDetail} />
          </SheetBody>
        )}
      </SheetContent>
    </Sheet>
  )
}

