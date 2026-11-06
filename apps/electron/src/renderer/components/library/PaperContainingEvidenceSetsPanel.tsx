/**
 * Referenced In 区 —— 展示"包含当前 paper 的 evidence set 列表"
 *
 * 数据流：
 * - useAtomValue(evidenceSetsContainingCurrentPaperAtom) 拿 loadable wrapper
 *   { state: 'loading' | 'hasData' | 'hasError', data?, error? }
 * - 选 paper 变化时 async atom 自动重 fetch（依赖 librarySelectedItemKeyAtom）
 * - Add to evidence set 成功后由调用方写 refreshPaperContainingSetsAtom 触发重拉
 *
 * 交互：
 * - 点击一行 → setOpenEvidenceSetId(set.id) → ItemDetailPanel 里挂的
 *   EvidenceSetDetailSheet 抽屉滑出
 *
 * 空态/错误态在区内局部展示，不让父面板闪烁。
 */
import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Layers, AlertTriangle, RotateCcw } from 'lucide-react'
// 注：Layers 仍用在 empty 状态的占位插画
import type { EvidenceSetSummary } from '@asci/shared'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
import {
  evidenceSetsContainingCurrentPaperAtom,
  refreshPaperContainingSetsAtom,
} from '@/atoms/session-evidence-atoms'
import { openEvidenceSetIdAtom } from '@/atoms/open-evidence-set-atom'
import { EvidenceSetCard } from './evidence-set-detail/EvidenceSetCard'

/**
 * Referenced In 行的显示标题：
 * - set.name 存在 → 直接用
 * - 否则（临时集合，name=null）→ 取 notePreview 前 20 字 + "…"；
 *   适用 "Add note" 按钮自动建的 persisted=false set
 * - notePreview 也为空 → fallback i18n "(untitled set)"
 *
 * 与 AddToEvidenceSetDialog 的 summaryLabel（取 40 字）思路一致，长度更紧凑，
 * 适配 Referenced In 行单行展示。
 */
const UNTITLED_PREVIEW_CHARS = 20

/**
 * 取 note.body 的第一段非空行作为副行预览。
 * note.body 经 addPaper 多次追加会变成 "第一段\n\n追加段...\n\n更多" 格式；
 * 列表副行只放一行，整体塞下去会被 CSS 折行成空格分隔，看起来像一句话。
 */
function firstParagraph(text: string): string {
  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim()
    if (trimmed.length > 0) return trimmed
  }
  return ''
}
function deriveDisplayName(
  s: EvidenceSetSummary,
  fallback: string,
): { label: string; derivedFromNote: boolean } {
  if (s.name) return { label: s.name, derivedFromNote: false }
  const preview = s.notePreview.trim()
  if (preview) {
    const label =
      preview.length > UNTITLED_PREVIEW_CHARS
        ? preview.slice(0, UNTITLED_PREVIEW_CHARS) + '…'
        : preview
    return { label, derivedFromNote: true }
  }
  return { label: fallback, derivedFromNote: false }
}

export function PaperContainingEvidenceSetsPanel(): React.ReactElement | null {
  const { t } = useT('library')
  const result = useAtomValue(evidenceSetsContainingCurrentPaperAtom)
  const setOpenEvidenceSetId = useSetAtom(openEvidenceSetIdAtom)
  const refresh = useSetAtom(refreshPaperContainingSetsAtom)

  // 点击 → 在当前 paper 详情页右侧滑出 EvidenceSetDetailSheet（覆盖层）查看集合详情。
  // 不再跳到 Evidence Sets（notes）视图，避免中断"看这篇 paper"的上下文。
  const openSheet = (setId: EvidenceSetSummary['id']): void => {
    setOpenEvidenceSetId(setId)
  }

  // loading：骨架占位（仅本区局部，不冒泡）
  if (result.state === 'loading') {
    return (
      <section className="space-y-2">
        <SectionHeader t={t} count={null} />
        <div className="space-y-1.5">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </section>
    )
  }

  if (result.state === 'hasError') {
    return (
      <section className="space-y-2">
        <SectionHeader t={t} count={null} />
        <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
          <AlertTriangle className="size-6 text-warning" strokeWidth={1.5} aria-hidden />
          <div className="text-xs text-foreground">
            {t('detail.evidence.referencedIn.errored')}
          </div>
          <div className="text-sm text-muted-foreground/60">
            {t('detail.evidence.referencedIn.errorHint')}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => refresh()}
            className="mt-2 gap-1.5"
          >
            <RotateCcw className="size-3" aria-hidden />
            {t('detail.evidence.referencedIn.retry')}
          </Button>
        </div>
      </section>
    )
  }

  const sets = result.data

  if (sets.length === 0) {
    return (
      <section className="space-y-2">
        <SectionHeader t={t} count={0} />
        <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
          <Layers className="size-6 text-muted-foreground/40" strokeWidth={1.5} aria-hidden />
          <div className="text-xs text-muted-foreground">
            {t('detail.evidence.referencedIn.empty')}
          </div>
          <div className="text-sm text-muted-foreground/60">
            {t('detail.evidence.referencedIn.emptyHint', {
              action: t('detail.evidence.actions.addToEvidenceSet'),
            })}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-2">
      <SectionHeader t={t} count={sets.length} />
      <ul className="space-y-1.5 list-none p-0">
        {sets.map((s) => {
          const { label, derivedFromNote } = deriveDisplayName(
            s,
            t('detail.evidence.referencedIn.unnamed'),
          )
          // 副行 = note.body 第一段预览；以下情况都不显示：
          // 1. 标题已从 notePreview 派生（避免上下完全重复）
          // 2. previewText 为空
          // 3. previewText 与大字标题相同（命名集合时 noteBody 默认兜底 = name → 222/222 两行重复）
          //
          // 只取第一段：noteAddendum 追加时 body 变成 "原文\n\n追加文"，全部塞一行会被
          // 折行成"原文 追加文"看起来像一句话；完整内容到 EvidenceSetDetailSheet 里看。
          // 副行 preview：派生 label 时 / 与 label 重复 / 空 时不传 → EvidenceSetCard 自动收紧布局
          const rawPreview = firstParagraph(s.notePreview)
          const preview =
            !derivedFromNote && rawPreview.length > 0 && rawPreview !== label.trim()
              ? rawPreview
              : undefined
          return (
            <li key={s.id}>
              <EvidenceSetCard
                label={label}
                paperCount={s.paperCount}
                preview={preview}
                onClick={() => openSheet(s.id)}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ===== 小组件 =====

function SectionHeader({
  t,
  count,
}: {
  t: ReturnType<typeof useT>['t']
  count: number | null
}): React.ReactElement {
  return (
    <div className="flex items-center gap-1.5">
      <h3 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
        {t('detail.evidence.referencedIn.title')}
      </h3>
      {count !== null && (
        <span className="text-sm text-muted-foreground/70 tabular-nums">{count}</span>
      )}
    </div>
  )
}

function SkeletonRow(): React.ReactElement {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 flex items-center gap-2">
      <div className="size-3.5 rounded-sm bg-muted-foreground/15" />
      <div className="flex-1 space-y-1">
        <div className="h-3 w-1/2 rounded bg-muted-foreground/15" />
        <div className="h-2.5 w-3/4 rounded bg-muted-foreground/10" />
      </div>
    </div>
  )
}
