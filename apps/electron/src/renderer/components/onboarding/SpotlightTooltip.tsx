/**
 * SpotlightTooltip — 蒙版镂空区旁的气泡介绍（V2 多阶段）
 *
 * 接收 (step, subStage)，按表查找文案。
 * 进度点对应 3 主步（不显示 substage）。
 * 2b 阶段额外提供"跳过这步"按钮（仅推进当前 substage）。
 */
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
import type { SpotlightStep } from '../../../types/onboarding-spotlight'

type SpotlightStageKeyBase =
  | 'spotlight.configureLlm.step0'
  | 'spotlight.configureLlm.step1'
  | 'spotlight.configureLlm.step2'
  | 'spotlight.connectZotero.step0'
  | 'spotlight.connectZotero.step0Connected'
  | 'spotlight.connectZotero.step1'
  | 'spotlight.newTask.step0'
  | 'spotlight.newTask.step1'

interface StageDescriptor {
  labelKey: `${SpotlightStageKeyBase}.label`
  titleKey: `${SpotlightStageKeyBase}.title`
  bodyKey: `${SpotlightStageKeyBase}.body`
  /** 是否额外显示"跳过这步"按钮（只 connect-zotero substage 1 用） */
  showSkipSubStage?: boolean
}

const stage = (base: SpotlightStageKeyBase, showSkipSubStage?: boolean): StageDescriptor => ({
  labelKey: `${base}.label` as `${SpotlightStageKeyBase}.label`,
  titleKey: `${base}.title` as `${SpotlightStageKeyBase}.title`,
  bodyKey: `${base}.body` as `${SpotlightStageKeyBase}.body`,
  showSkipSubStage,
})

/** 7 套阶段：(step, subStage) → i18n 锚点 */
const STAGE_TABLE: Record<SpotlightStep, ReadonlyArray<StageDescriptor>> = {
  'configure-llm': [
    stage('spotlight.configureLlm.step0'),
    stage('spotlight.configureLlm.step1'),
    stage('spotlight.configureLlm.step2'),
  ],
  'connect-zotero': [
    stage('spotlight.connectZotero.step0'),
    stage('spotlight.connectZotero.step1', true),
  ],
  'new-task': [
    stage('spotlight.newTask.step0'),
    stage('spotlight.newTask.step1'),
  ],
}

const TOOLTIP_WIDTH = 300
const TOOLTIP_GAP = 12

export interface SpotlightTooltipProps {
  step: SpotlightStep
  subStage: number
  rect: DOMRect
  onPrimary: () => void
  onSkipSubStage: () => void
  onSkipAll: () => void
  /** Zotero 是否已连接（启用 + 运行 + 远程开放）。仅影响 connect-zotero/0 文案 */
  zoteroConnected?: boolean
}

export function SpotlightTooltip({
  step,
  subStage,
  rect,
  onPrimary,
  onSkipSubStage,
  onSkipAll,
  zoteroConnected,
}: SpotlightTooltipProps): React.ReactElement {
  const { t } = useT('onboarding')
  const ref = React.useRef<HTMLDivElement>(null)
  const [pos, setPos] = React.useState<{ left: number; top: number; arrowSide: 'left' | 'right' }>(
    { left: 0, top: 0, arrowSide: 'left' },
  )

  React.useLayoutEffect(() => {
    const tooltipHeight = ref.current?.offsetHeight ?? 160
    const margin = 12

    const rightLeft = rect.right + TOOLTIP_GAP
    const fitsRight = rightLeft + TOOLTIP_WIDTH + margin <= window.innerWidth

    const left = fitsRight
      ? rightLeft
      : rect.left - TOOLTIP_GAP - TOOLTIP_WIDTH

    const arrowSide: 'left' | 'right' = fitsRight ? 'left' : 'right'

    let top = rect.top + rect.height / 2 - tooltipHeight / 2
    top = Math.max(margin, Math.min(top, window.innerHeight - tooltipHeight - margin))

    setPos({ left, top, arrowSide })
  }, [rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height, step, subStage])

  // 防止 subStage 越界：优先取 subStage，fallback 到第一条
  const stages = STAGE_TABLE[step]
  const baseStage = stages[subStage] ?? stages[0]!
  // connect-zotero/0 已连接时切到 step0Connected 文案
  const currentStage: StageDescriptor =
    step === 'connect-zotero' && subStage === 0 && zoteroConnected
      ? stage('spotlight.connectZotero.step0Connected')
      : baseStage
  const label = t(currentStage.labelKey)
  const title = t(currentStage.titleKey)
  const body = t(currentStage.bodyKey)
  // 最后一步（new-task 起手式）：主按钮显示"完成"，隐藏"跳过引导"
  const isLastStage = step === 'new-task' && subStage === 1
  return (
    <div
      ref={ref}
      className="fixed z-[111] pointer-events-auto rounded-xl bg-card border border-border shadow-2xl p-4"
      style={{ left: pos.left, top: pos.top, width: TOOLTIP_WIDTH }}
    >
      {/* 箭头 */}
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

      <div className="text-sm font-semibold uppercase tracking-wider text-primary mb-1">
        {label}
      </div>
      <div className="text-sm font-semibold mb-1.5">{title}</div>
      <div className="text-xs text-muted-foreground leading-relaxed mb-3">{body}</div>

      <div className="flex items-center justify-between gap-2">
        {isLastStage ? (
          <span />
        ) : (
          <Button
            type="button"
            variant="ghost"
            className="h-auto p-0 text-xs font-normal text-muted-foreground/70 hover:bg-transparent hover:text-foreground"
            onClick={onSkipAll}
          >
            {t('spotlight.skipAll')}
          </Button>
        )}

        <div className="flex items-center gap-2">
          {currentStage.showSkipSubStage && (
            <Button
              type="button"
              variant="outline"
              className="h-auto border-border bg-card px-3 py-1.5 text-xs text-foreground shadow-none hover:bg-muted hover:text-foreground"
              onClick={onSkipSubStage}
            >
              {t('spotlight.skipSubStage')}
            </Button>
          )}
          <Button
            type="button"
            className="h-auto bg-foreground px-3 py-1.5 text-xs text-background shadow-none hover:bg-foreground/90"
            onClick={onPrimary}
          >
            {isLastStage ? t('spotlight.done') : t('spotlight.next')}
          </Button>
        </div>
      </div>
    </div>
  )
}
