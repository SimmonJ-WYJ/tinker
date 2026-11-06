/**
 * ScoreBadge — 证据驱动评分 v2 徽章（与 RelevanceBadge / v1 并行展示）
 *
 * 显示等级 S/A/B/C/D + 综合分；hover tooltip 展示七维分解、数据置信度、排序理由。
 * 数据来自 record.extra.score（后端 paper_scoring 产出）。score 为 null 时不渲染。
 */

import * as React from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import type { PaperScore } from '@asci/shared'

interface ScoreBadgeProps {
  score: PaperScore | null
  className?: string
}

/** 按综合分分段配色（不展示 S/A/B/C/D 字母，仅用颜色区分高低；语义色 token） */
function scoreColorClasses(score: number): string {
  if (score >= 80) return 'bg-success/15 text-success'
  if (score >= 65) return 'bg-info/10 text-info'
  if (score >= 50) return 'bg-warning/10 text-warning'
  return 'bg-muted-foreground/10 text-muted-foreground'
}

export function ScoreBadge({ score, className }: ScoreBadgeProps): React.ReactElement | null {
  const { t } = useT('conversation')
  if (!score || typeof score.finalScore !== 'number') return null

  const nullMark = t('sessionPapers.score.nullMark')
  const fmt = (v: number | null | undefined): string =>
    typeof v === 'number' ? String(Math.round(v)) : nullMark

  const s = score.scores ?? ({} as PaperScore['scores'])
  /** 七维分数键 → i18n 维度标签（nullFields 复用同一映射） */
  const dimLabel: Record<keyof PaperScore['scores'], string> = {
    semantic_relevance: t('sessionPapers.score.dimSemantic'),
    method_match: t('sessionPapers.score.dimMethod'),
    venue_quality: t('sessionPapers.score.dimVenue'),
    publication_status: t('sessionPapers.score.dimPubStatus'),
    recency: t('sessionPapers.score.dimRecency'),
    paper_influence: t('sessionPapers.score.dimInfluence'),
    reproducibility: t('sessionPapers.score.dimRepro'),
  }
  const dims: Array<[string, number | null]> = (
    Object.keys(dimLabel) as Array<keyof PaperScore['scores']>
  ).map((k) => [dimLabel[k], s[k] ?? null])

  // 由结构化字段在前端重建排序理由（替代后端写死的中文 reason），随界面语言本地化。
  const reasonBits: string[] = []
  if ((s.semantic_relevance ?? 0) >= 80) reasonBits.push(t('sessionPapers.score.reasonHighSemantic'))
  if ((s.method_match ?? 0) >= 80) reasonBits.push(t('sessionPapers.score.reasonHighMethod'))
  if (score.publicationStatus) reasonBits.push(t(`sessionPapers.score.pubStatus.${score.publicationStatus}`))
  if (score.nullFields?.length) {
    const fields = score.nullFields
      .map((f) => dimLabel[f as keyof PaperScore['scores']] ?? f)
      .join('/')
    reasonBits.push(t('sessionPapers.score.reasonReweighted', { fields }))
  }
  const reasonText = reasonBits.join(t('sessionPapers.score.reasonJoiner'))

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-badge font-normal whitespace-nowrap cursor-default',
            scoreColorClasses(score.finalScore),
            className,
          )}
        >
          <span className="text-current/70">{t('sessionPapers.score.shortLabel')}</span>
          <span>{fmt(score.finalScore)}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[300px] text-xs">
        <p className="font-medium">
          {t('sessionPapers.score.final', { score: fmt(score.finalScore) })} ·{' '}
          {t('sessionPapers.score.dataConfidence', { value: score.dataConfidence ?? 0 })}
        </p>
        <p className="mt-0.5 text-muted-foreground">
          {t('sessionPapers.score.relevance', { score: fmt(score.relevanceScore) })} ·{' '}
          {t('sessionPapers.score.quality', { score: fmt(score.qualityScore ?? null) })}
        </p>
        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
          {dims.map(([label, val]) => (
            <span key={label}>
              {label} {fmt(val)}
            </span>
          ))}
        </div>
        {reasonText ? <p className="mt-1.5 text-muted-foreground/90 leading-snug">{reasonText}</p> : null}
      </TooltipContent>
    </Tooltip>
  )
}
