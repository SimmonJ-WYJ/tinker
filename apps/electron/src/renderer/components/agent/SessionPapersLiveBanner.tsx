/**
 * SessionPapersLiveBanner — 检索流式进度条
 *
 * retrieve 进行期间（live 进度文件存在且本轮 canonical 未落地）显示在
 * Toolbar 下方：阶段文案（检索中 / 去重补全中）+ 每源状态 chip + 未去重计数。
 * 数据来自 SessionPapersLive 快照，由 SessionPapersPanel 事件驱动刷新。
 */

import * as React from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SessionPapersLive, SessionPapersLiveSource } from '@asci/shared'
import { useT } from '@/hooks/useT'

interface SessionPapersLiveBannerProps {
  live: SessionPapersLive
}

function SourceChip({ name, source }: { name: string; source: SessionPapersLiveSource }): React.ReactElement {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded bg-muted/50 px-1.5 py-0.5 tabular-nums',
        source.verdict === 'ok' && 'text-success',
        source.verdict === 'failed' && 'text-destructive',
        (source.verdict === 'pending' || source.verdict === 'empty') && 'text-muted-foreground',
      )}
    >
      {name}
      {source.verdict === 'ok' && (
        <>
          <Check className="size-2.5" />
          {source.count}
        </>
      )}
      {source.verdict === 'pending' && <Loader2 className="size-2.5 animate-spin" />}
      {source.verdict === 'empty' && <span>0</span>}
      {source.verdict === 'failed' && <X className="size-2.5" />}
    </span>
  )
}

export function SessionPapersLiveBanner({ live }: SessionPapersLiveBannerProps): React.ReactElement {
  const { t } = useT('conversation')
  const doneCount = Object.values(live.sources).filter((s) => s.verdict !== 'pending').length
  const totalCount = Object.keys(live.sources).length
  // #775：评分窗口全部判完（X==Y>0）→ 该阶段完成，等报告启动。文案转绿 + 勾标，提示进入下一环节。
  const scoreDone =
    live.phase === 'scoring' && (live.scoreTotal ?? 0) > 0 && (live.scored ?? 0) >= (live.scoreTotal ?? 0)
  // #775：processing 阶段仅在 enrich 真发生时带 X/Y（processTotal>0）；去重瞬时则无计数，显示「整理候选」。
  const enrichTotal = live.processTotal ?? 0
  const hasEnrich = live.phase === 'processing' && enrichTotal > 0
  const enrichDone = hasEnrich && (live.processed ?? 0) >= enrichTotal
  // 完成态（变绿 + 勾标）：评分完 或 补摘要完
  const phaseDone = scoreDone || enrichDone

  return (
    <div className="mx-1 mt-2 rounded-md bg-muted/30 px-2 py-1.5 text-sm">
      <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        {phaseDone ? (
          <Check className="size-3 shrink-0 text-success" />
        ) : (
          <Loader2 className="size-3 animate-spin shrink-0" />
        )}
        {live.phase === 'scoring' ? (
          // #775：scorer 分片打分进度「已评分 X/Y」（Y=评分窗口，非召回总数）；X==Y 时转绿表完成
          <span className={cn('truncate', scoreDone && 'text-success')}>
            {scoreDone
              ? t('sessionPapers.live.scoreComplete', { scored: live.scored ?? 0, total: live.scoreTotal ?? 0 })
              : t('sessionPapers.live.scoreProgress', { scored: live.scored ?? 0, total: live.scoreTotal ?? 0 })}
          </span>
        ) : live.phase === 'reporting' ? (
          // #775：报告生成确定性预告（候选数 + 章节数，不做假进度条）
          <span className="truncate">
            {t('sessionPapers.live.reporting', {
              count: live.reportCandidateCount ?? 0,
              sections: live.reportSectionCount ?? 0,
            })}
          </span>
        ) : live.phase === 'processing' ? (
          // #775：enrich 真发生 → 「补全摘要 X/Y」（X=已处理，X==Y 转绿）；去重瞬时无计数 → 「整理候选」
          hasEnrich ? (
            <span className={cn('truncate', enrichDone && 'text-success')}>
              {enrichDone
                ? t('sessionPapers.live.enrichComplete', { enriched: live.processed ?? 0, total: enrichTotal })
                : t('sessionPapers.live.enrichProgress', { enriched: live.processed ?? 0, total: enrichTotal })}
            </span>
          ) : (
            <span className="truncate">{t('sessionPapers.live.organizing')}</span>
          )
        ) : (
          <span className="truncate">
            {t('sessionPapers.live.searching', { done: doneCount, total: totalCount })}
          </span>
        )}
        <span className="flex-1" />
        {live.rawTotal > 0 && (
          <span className="shrink-0 whitespace-nowrap text-muted-foreground/70 tabular-nums">
            {t('sessionPapers.live.rawCountHint', { count: live.rawTotal })}
          </span>
        )}
      </div>
      {live.phase === 'searching' && totalCount > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1 text-sm">
          {Object.entries(live.sources).map(([name, source]) => (
            <SourceChip key={name} name={name} source={source} />
          ))}
        </div>
      )}
    </div>
  )
}
