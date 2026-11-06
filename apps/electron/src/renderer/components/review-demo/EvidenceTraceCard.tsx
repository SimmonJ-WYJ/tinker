/**
 * 综述引文证据溯源卡片（真实数据版本）
 *
 * 与 demo 版 [[EvidenceCard]] 同视觉，但 props 接收真实 Review HTML 解析出来的
 * §7 reference 元数据 + <cite><q> verbatim quote，回调由外部注入（不绑 demo 数据）。
 *
 * 使用场景：ReviewHtmlRenderer 把综述里 <cite> 角标点击后，在所在 <p> 后通过 Portal
 * 挂载本组件；按钮回调走 useOpenEvidenceInLibrary（真实跳转 + PDF 高亮）。
 */
import * as React from 'react'

import { Link2, X, FileText, Plus, AlertTriangle } from 'lucide-react'

import { sanitizeText } from '@asci/shared'

import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'

export interface EvidenceTraceCardPaper {
  /** 显示名（如 "Izacard et al. 2022" / "arXiv:2208.03299"）；调用方拼好 */
  label: string
  /** 论文标题（用于按钮 tooltip / 无障碍） */
  title?: string
  /** Authors / Year / Venue / DOI 等已拼好的副标题；可空 */
  meta?: string
  /** 段/句的人类可读位置标识（如 "第 4 节第 1 段"）；可空 */
  location?: string
}

export interface EvidenceTraceCardProps {
  paper: EvidenceTraceCardPaper
  /** verbatim 引文（<cite><q>X</q></cite> 的 X） */
  quote: string
  onOpenInLibrary: () => void
  onClose: () => void
  /**
   * 可选：Add note here 回调；不传时按钮 disabled，显示 "Coming soon"。
   * 当前阶段（评论引文流）暂不接 add-note，预留扩展位。
   */
  onAddNote?: () => void
  /** 主按钮 disabled 时的提示（如"未关联 Zotero"），不传则按钮可用 */
  openInLibraryDisabledReason?: string
  /**
   * 源是否已移除（issue #462 方式 A：就地提示）。
   * true 时把"Open full context in Paper"替换为禁用的"源已移除"按钮 —— 该文献在
   * Zotero 中无可打开 PDF（条目已删 / 论文未入库 / 无 PDF 附件），点击前即提示无法跳转。
   */
  sourceRemoved?: boolean
}

export function EvidenceTraceCard({
  paper,
  quote,
  onOpenInLibrary,
  onClose,
  onAddNote,
  openInLibraryDisabledReason,
  sourceRemoved = false,
}: EvidenceTraceCardProps): React.ReactElement {
  const { t } = useT('library')
  const isOpenDisabled = Boolean(openInLibraryDisabledReason)

  return (
    <div
      className="my-4 rounded-lg border border-info/30 bg-card overflow-hidden"
      data-asci-evidence-trace-card
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/40">
        <div className="flex items-center gap-2">
          <Link2 className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">
            {t('reviewDemo.evidence.header')}
          </span>
          <span className="text-sm text-muted-foreground">{t('reviewDemo.evidence.refLabel')}</span>
        </div>
        <Button
          type="button"
          variant="subtle"
          size="icon-2xs"
          onClick={onClose}
          className="size-auto [&_svg]:size-3.5"
          aria-label={t('reviewDemo.evidence.closeTrace')}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="p-4 space-y-3">
        <div className="text-sm text-muted-foreground">
          {t('reviewDemo.evidence.sourcePrefix')} ·{' '}
          <span className="text-foreground font-medium" title={sanitizeText(paper.title)}>
            {paper.label}
          </span>
          {paper.meta ? <> · {paper.meta}</> : null}
          {paper.location ? <> · {paper.location}</> : null}
        </div>
        <blockquote className="border-l-2 border-border pl-3 py-1 text-sm text-foreground/80 leading-relaxed">
          {quote}
        </blockquote>
        <div className="flex items-center gap-2 flex-wrap">
          {sourceRemoved ? (
            <Button
              size="sm"
              variant="outline"
              disabled
              title={t('reviewDemo.evidence.sourceRemovedHint')}
              className="border-warning/40 text-warning hover:text-warning"
            >
              <AlertTriangle className="!size-3 mr-1" />
              {t('reviewDemo.evidence.sourceRemoved')}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onOpenInLibrary}
              disabled={isOpenDisabled}
              title={openInLibraryDisabledReason}
            >
              <FileText className="!size-3 mr-1" />
              {t('reviewDemo.evidence.openContext')}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={onAddNote}
            disabled={!onAddNote}
            title={onAddNote ? undefined : 'Coming soon'}
          >
            <Plus className="!size-3 mr-1" />
            {t('reviewDemo.evidence.addNote')}
          </Button>
        </div>
      </div>
    </div>
  )
}
