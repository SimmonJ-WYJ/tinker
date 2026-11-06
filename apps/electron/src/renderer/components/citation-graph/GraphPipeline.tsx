/**
 * 图谱构建阶段进度条
 *
 * 在 Modal 顶部展示 seed / references / cited_by / hop2 四个阶段的状态，
 * 每个阶段用徽章 + 状态图标呈现，失败阶段会展示错误消息悬浮提示。
 */

import { useAtomValue } from 'jotai'
import { AlertCircle, CheckCircle2, CircleDashed, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CitationGraphStage, CitationGraphStageStatus } from '@asci/shared'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { graphScalePresetAtom, graphStagesAtom } from '@/atoms/citation-graph-atoms'
import { SCALE_PRESETS } from './scale-presets'
import { useT } from '@/hooks/useT'

interface StageDef {
  key: CitationGraphStage
  /** i18n key under library.graph.pipeline (label) */
  labelKey: 'seed' | 'references' | 'citedBy' | 'hop2'
  /** describe-key + var builder */
  describeKey: 'seed' | 'references' | 'citedBy' | 'hop2'
  describeVars: (p: (typeof SCALE_PRESETS)[keyof typeof SCALE_PRESETS]) => Record<string, string | number>
}

const STAGES: StageDef[] = [
  {
    key: 'seed',
    labelKey: 'seed',
    describeKey: 'seed',
    describeVars: () => ({}),
  },
  {
    key: 'references',
    labelKey: 'references',
    describeKey: 'references',
    describeVars: (p) => ({ refs: p.refsLimit }),
  },
  {
    key: 'cited_by',
    labelKey: 'citedBy',
    describeKey: 'citedBy',
    describeVars: (p) => ({ citedBy: p.citedByLimit }),
  },
  {
    key: 'hop2',
    labelKey: 'hop2',
    describeKey: 'hop2',
    describeVars: (p) => ({
      topN: p.hop2TopN,
      refsPer: p.hop2RefsPerNode,
      citedByPer: p.hop2CitedByPerNode,
      cap: p.hop2TopN * (p.hop2RefsPerNode + p.hop2CitedByPerNode),
    }),
  },
]

function StatusIcon({ status }: { status: CitationGraphStageStatus }) {
  switch (status) {
    case 'pending':
      return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
    case 'done':
      return <CheckCircle2 className="h-3.5 w-3.5 text-success" />
    case 'skipped':
      return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground/60" />
    case 'error':
      return <AlertCircle className="h-3.5 w-3.5 text-destructive" />
  }
}

export function GraphPipeline() {
  const { t } = useT('library')
  const stages = useAtomValue(graphStagesAtom)
  const scale = useAtomValue(graphScalePresetAtom)
  const presetParams = SCALE_PRESETS[scale]

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
      {STAGES.map((s, idx) => {
        const state = stages[s.key]
        const label = t(`graph.pipeline.${s.labelKey}`)
        return (
          <div key={s.key} className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-badge cursor-help',
                    state.status === 'running' && 'bg-primary/10',
                    state.status === 'done' && 'bg-success/10',
                    state.status === 'error' && 'bg-destructive/10',
                    (state.status === 'pending' || state.status === 'skipped') && 'bg-muted',
                  )}
                >
                  <StatusIcon status={state.status} />
                  <span className="font-medium">{label}</span>
                  {state.message && state.status !== 'error' && (
                    <span className="text-muted-foreground ml-1 truncate max-w-[160px]">
                      {state.message}
                    </span>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[340px]">
                <div className="text-xs leading-relaxed space-y-1.5">
                  <div className="font-semibold">{label}</div>
                  <div>{t(`graph.pipeline.describe.${s.describeKey}`, s.describeVars(presetParams))}</div>
                  {state.status === 'error' && state.message && (
                    <div className="text-destructive pt-1 border-t border-white/10">
                      {t('graph.pipeline.errorPrefix')}{state.message}
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
            {idx < STAGES.length - 1 && (
              <div className="h-px w-3 bg-border" aria-hidden />
            )}
          </div>
        )
      })}
    </div>
  )
}
