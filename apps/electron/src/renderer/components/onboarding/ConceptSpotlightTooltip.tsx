/**
 * ConceptSpotlightTooltip — 概念引导 tour 气泡。
 *
 * rect=null 时居中显示（末 substage）；有 rect 时锚定到 target 旁边。
 * 文案走 useT('onboarding') 的 conceptSpotlight.<tour>.step<N>.{label,title,body}。
 *
 * 通过静态 STAGE_TABLE 把 (tour, subStage) 映射到 i18next 字面量 key，
 * 完全保留 ParseKeys 静态校验（零 any）。
 */
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
import type { ConceptTourKey } from '../../../types/concept-spotlight'

const TOOLTIP_WIDTH = 320
const TOOLTIP_GAP = 12

interface StageDescriptor {
  labelKey:
    | 'conceptSpotlight.evidenceSet.step0.label'
    | 'conceptSpotlight.evidenceSet.step1.label'
    | 'conceptSpotlight.evidenceSet.step2.label'
    | 'conceptSpotlight.paperNotes.step0.label'
    | 'conceptSpotlight.paperNotes.step1.label'
  titleKey:
    | 'conceptSpotlight.evidenceSet.step0.title'
    | 'conceptSpotlight.evidenceSet.step1.title'
    | 'conceptSpotlight.evidenceSet.step2.title'
    | 'conceptSpotlight.paperNotes.step0.title'
    | 'conceptSpotlight.paperNotes.step1.title'
  bodyKey:
    | 'conceptSpotlight.evidenceSet.step0.body'
    | 'conceptSpotlight.evidenceSet.step1.body'
    | 'conceptSpotlight.evidenceSet.step2.body'
    | 'conceptSpotlight.paperNotes.step0.body'
    | 'conceptSpotlight.paperNotes.step1.body'
}

/** 静态字面量 key 表：保留 i18next ParseKeys 静态校验，零 any */
const STAGE_TABLE: Record<ConceptTourKey, ReadonlyArray<StageDescriptor>> = {
  evidenceSet: [
    {
      labelKey: 'conceptSpotlight.evidenceSet.step0.label',
      titleKey: 'conceptSpotlight.evidenceSet.step0.title',
      bodyKey: 'conceptSpotlight.evidenceSet.step0.body',
    },
    {
      labelKey: 'conceptSpotlight.evidenceSet.step1.label',
      titleKey: 'conceptSpotlight.evidenceSet.step1.title',
      bodyKey: 'conceptSpotlight.evidenceSet.step1.body',
    },
    {
      labelKey: 'conceptSpotlight.evidenceSet.step2.label',
      titleKey: 'conceptSpotlight.evidenceSet.step2.title',
      bodyKey: 'conceptSpotlight.evidenceSet.step2.body',
    },
  ],
  paperNotes: [
    {
      labelKey: 'conceptSpotlight.paperNotes.step0.label',
      titleKey: 'conceptSpotlight.paperNotes.step0.title',
      bodyKey: 'conceptSpotlight.paperNotes.step0.body',
    },
    {
      labelKey: 'conceptSpotlight.paperNotes.step1.label',
      titleKey: 'conceptSpotlight.paperNotes.step1.title',
      bodyKey: 'conceptSpotlight.paperNotes.step1.body',
    },
  ],
}

export interface ConceptSpotlightTooltipProps {
  tour: ConceptTourKey
  subStage: number
  /** null 表示居中显示（末 substage 无 DOM 锚点） */
  rect: DOMRect | null
  isLast: boolean
  onPrimary: () => void
  onSkipAll: () => void
}

export function ConceptSpotlightTooltip({
  tour,
  subStage,
  rect,
  isLast,
  onPrimary,
  onSkipAll,
}: ConceptSpotlightTooltipProps): React.ReactElement {
  const { t } = useT('onboarding')
  const ref = React.useRef<HTMLDivElement>(null)
  const [pos, setPos] = React.useState<{
    left: number
    top: number
    arrowSide: 'left' | 'right' | 'none'
  }>({ left: 0, top: 0, arrowSide: 'left' })

  React.useLayoutEffect(() => {
    const tooltipHeight = ref.current?.offsetHeight ?? 160
    const margin = 12

    if (!rect) {
      // 居中布局
      const left = Math.max(margin, window.innerWidth / 2 - TOOLTIP_WIDTH / 2)
      const top = Math.max(margin, window.innerHeight / 2 - tooltipHeight / 2)
      setPos({ left, top, arrowSide: 'none' })
      return
    }

    const rightLeft = rect.right + TOOLTIP_GAP
    const fitsRight = rightLeft + TOOLTIP_WIDTH + margin <= window.innerWidth

    const left = fitsRight ? rightLeft : rect.left - TOOLTIP_GAP - TOOLTIP_WIDTH
    const arrowSide: 'left' | 'right' = fitsRight ? 'left' : 'right'

    let top = rect.top + rect.height / 2 - tooltipHeight / 2
    top = Math.max(margin, Math.min(top, window.innerHeight - tooltipHeight - margin))

    setPos({ left, top, arrowSide })
  }, [rect, tour, subStage])

  // 防御性：subStage 越界时回落到第一条
  const stages = STAGE_TABLE[tour]
  const stage = stages[subStage] ?? stages[0]!

  return (
    <div
      ref={ref}
      className="fixed z-[111] pointer-events-auto rounded-xl bg-card border border-border shadow-2xl p-4"
      style={{ left: pos.left, top: pos.top, width: TOOLTIP_WIDTH }}
    >
      {pos.arrowSide !== 'none' && (
        <span
          className="absolute top-5 w-0 h-0"
          style={
            pos.arrowSide === 'left'
              ? {
                  left: -8,
                  borderTop: '8px solid transparent',
                  borderBottom: '8px solid transparent',
                  borderRight: '8px solid var(--card)',
                }
              : {
                  right: -8,
                  borderTop: '8px solid transparent',
                  borderBottom: '8px solid transparent',
                  borderLeft: '8px solid var(--card)',
                }
          }
        />
      )}

      <div className="text-sm font-semibold uppercase tracking-wider text-primary mb-1">
        {t(stage.labelKey)}
      </div>
      <div className="text-sm font-semibold mb-1.5">{t(stage.titleKey)}</div>
      <div className="text-xs text-muted-foreground leading-relaxed mb-3">{t(stage.bodyKey)}</div>

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          className="h-auto p-0 text-xs font-normal text-muted-foreground/70 hover:bg-transparent hover:text-foreground"
          onClick={onSkipAll}
        >
          {t('conceptSpotlight.skipAll')}
        </Button>
        <Button
          type="button"
          className="h-auto bg-foreground px-3 py-1.5 text-xs text-background shadow-none hover:bg-foreground/90"
          onClick={onPrimary}
        >
          {isLast ? t('conceptSpotlight.done') : t('conceptSpotlight.next')}
        </Button>
      </div>
    </div>
  )
}
