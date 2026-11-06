/**
 * 图谱图例 + 显示开关
 *
 * 左下角浮动面板，包含：
 *   - 节点配色图例（seed / 一跳引用 / 一跳被引 / 二跳 / 库内）
 *   - 边样式图例（引用 实线 / 被引 虚线）
 *   - 两个开关：节点名字 / 边名字
 */

import { useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { ChevronDown, ChevronUp, Info, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  graphOpenStateAtom,
  graphScalePresetAtom,
  graphShowEdgeLabelsAtom,
  graphShowNodeLabelsAtom,
  softResetGraphStateAtom,
} from '@/atoms/citation-graph-atoms'
import { EDGE_COLOR, IN_LIBRARY_RING, NODE_COLOR } from './graph-colors'
import {
  SCALE_PRESETS,
  type CitationGraphScalePreset,
} from './scale-presets'
import { useT } from '@/hooks/useT'
import { Trans } from '@/components/common/Trans'

interface LegendDotProps {
  color: string
  ring?: string
  label: string
}

function LegendDot({ color, ring, label }: LegendDotProps) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span
        className="inline-block h-3 w-3 rounded-full"
        style={{
          backgroundColor: color,
          boxShadow: ring ? `0 0 0 2px ${ring}` : undefined,
        }}
      />
      <span>{label}</span>
    </div>
  )
}

interface LegendLineProps {
  color: string
  dashed?: boolean
  label: string
}

function LegendLine({ color, dashed, label }: LegendLineProps) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <svg width="20" height="6" className="shrink-0">
        <line
          x1="0"
          y1="3"
          x2="20"
          y2="3"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dashed ? '3,3' : undefined}
        />
      </svg>
      <span>{label}</span>
    </div>
  )
}

export function GraphLegend() {
  const { t } = useT('library')
  const [showNodeLabels, setShowNodeLabels] = useAtom(graphShowNodeLabelsAtom)
  const [showEdgeLabels, setShowEdgeLabels] = useAtom(graphShowEdgeLabelsAtom)
  const [scale, setScale] = useAtom(graphScalePresetAtom)
  const [openState, setOpenState] = useAtom(graphOpenStateAtom)
  const softReset = useSetAtom(softResetGraphStateAtom)
  const [collapsed, setCollapsed] = useState(false)

  // 切换展开规模 → 就地重建：保留当前 nodes/edges 作为过渡视图，
  // 仅重置 stages；新 build 完成时 useCitationGraph 会按本次收到的节点集合 prune。
  const handleScaleChange = (next: CitationGraphScalePreset) => {
    setScale(next)
    if (!openState.seed) return
    softReset()
    setOpenState({
      ...openState,
      requestId: crypto.randomUUID(),
    })
  }

  // 以相同 seed + 相同规模重建（清缓存后会用这个；保留当前视图过渡）
  const rebuildSameSeed = () => {
    if (!openState.seed) return
    softReset()
    setOpenState({
      ...openState,
      requestId: crypto.randomUUID(),
    })
  }

  // 清当前图谱的缓存 + 重建（绕过缓存，走真实查询）
  const handleClearCurrent = async () => {
    if (!openState.seed) return
    const params = SCALE_PRESETS[scale]
    try {
      const res = await window.electronAPI.citationGraph.clearCache({
        scope: 'one',
        seed: openState.seed,
        ...params,
      })
      toast.success(res.cleared > 0 ? t('graph.legend.cache.clearedCurrent') : t('graph.legend.cache.noCacheCurrent'))
      rebuildSameSeed()
    } catch (error) {
      toast.error(t('graph.legend.cache.clearFailed', { message: error instanceof Error ? error.message : String(error) }))
    }
  }

  // 清全部缓存（不重建）
  const handleClearAll = async () => {
    try {
      const res = await window.electronAPI.citationGraph.clearCache({ scope: 'all' })
      toast.success(t('graph.legend.cache.clearedCount', { count: res.cleared }))
    } catch (error) {
      toast.error(t('graph.legend.cache.clearAllFailed', { message: error instanceof Error ? error.message : String(error) }))
    }
  }

  // 收起态：只显示一个小图标按钮
  if (collapsed) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setCollapsed(false)}
        className="absolute bottom-3 left-3 z-10 h-auto gap-1.5 bg-background/95 backdrop-blur shadow-md px-2.5 py-1.5 hover:bg-background [&_svg]:size-3.5"
        title={t('graph.legendExpand')}
      >
        <Info className="h-3.5 w-3.5" />
        {t('graph.legend.title')}
        <ChevronUp className="!size-3 opacity-60" />
      </Button>
    )
  }

  return (
    <div className="absolute bottom-3 left-3 z-10 bg-background/95 backdrop-blur border rounded-md shadow-md w-[180px]">
      {/* 头部（可点击收起） */}
      <Button
        variant="ghost"
        onClick={() => setCollapsed(true)}
        className="w-full h-auto justify-between px-3 pt-2.5 pb-2 text-xs font-semibold text-foreground hover:bg-muted/30 hover:text-foreground rounded-md rounded-b-none [&_svg]:size-3.5"
        title={t('graph.legendCollapse')}
      >
        <span>{t('graph.legend.title')}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </Button>

      <div className="px-3 pb-3">
        {/* 节点图例 */}
        <div className="space-y-1.5 mb-3 pt-1 border-t">
          <LegendDot color={NODE_COLOR.seed} label={t('graph.legend.node.seed')} />
          <LegendDot color={NODE_COLOR.reference} label={t('graph.legend.node.reference')} />
          <LegendDot color={NODE_COLOR.cited_by} label={t('graph.legend.node.citedBy')} />
          <LegendDot color={NODE_COLOR.hop2} label={t('graph.legend.node.hop2')} />
          <LegendDot color={NODE_COLOR.reference} ring={IN_LIBRARY_RING} label={t('graph.legend.node.inLibrary')} />
        </div>

        {/* 边图例 */}
        <div className="space-y-1.5 mb-3 pt-2 border-t">
          <LegendLine color={EDGE_COLOR.references} label={t('graph.legend.edge.references')} />
          <LegendLine color={EDGE_COLOR.cited_by} dashed label={t('graph.legend.edge.citedBy')} />
        </div>

        {/* 显示开关 */}
        <div className="space-y-2 pt-2 border-t">
          <label className="flex items-center justify-between text-xs cursor-pointer">
            <span>{t('graph.legend.toggle.nodeLabels')}</span>
            <Switch checked={showNodeLabels} onCheckedChange={setShowNodeLabels} />
          </label>
          <label className="flex items-center justify-between text-xs cursor-pointer">
            <span>{t('graph.legend.toggle.edgeLabels')}</span>
            <Switch checked={showEdgeLabels} onCheckedChange={setShowEdgeLabels} />
          </label>
        </div>

        {/* 展开规模（切档直接重建） */}
        <div className="pt-2 border-t">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-xs mb-1.5 text-muted-foreground cursor-help inline-flex items-center gap-1">
                {t('graph.legend.scale.label')}
                <Info className="h-3 w-3 opacity-60" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px]">
              <div className="text-xs leading-relaxed">
                {(() => {
                  const p = SCALE_PRESETS[scale]
                  return t('graph.scalePreset.describe', {
                    refs: p.refsLimit,
                    citedBy: p.citedByLimit,
                    topN: p.hop2TopN,
                    refsPer: p.hop2RefsPerNode,
                    citedByPer: p.hop2CitedByPerNode,
                    cap: p.hop2TopN * (p.hop2RefsPerNode + p.hop2CitedByPerNode),
                  })
                })()}
                <br />
                <span className="opacity-70">{t('graph.legend.scale.tooltipSuffix')}</span>
              </div>
            </TooltipContent>
          </Tooltip>
          <div className="flex rounded-md border overflow-hidden">
            {(Object.keys(SCALE_PRESETS) as CitationGraphScalePreset[]).map((key) => (
              <Button
                key={key}
                variant="ghost"
                onClick={() => handleScaleChange(key)}
                className={cn(
                  'flex-1 h-auto rounded-none py-1 text-xs font-normal',
                  scale === key
                    ? 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
                    : 'bg-background hover:bg-muted',
                )}
              >
                {t(`graph.scalePreset.${key}`)}
              </Button>
            ))}
          </div>
        </div>

        {/* 缓存操作 */}
        <div className="pt-2 border-t">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-xs mb-1.5 text-muted-foreground cursor-help inline-flex items-center gap-1">
                {t('graph.legend.cache.label')}
                <Info className="h-3 w-3 opacity-60" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[280px]">
              <div className="text-xs leading-relaxed">
                <Trans
                  ns="library"
                  i18nKey="graph.legend.cache.tooltip"
                  components={{ code: <code /> }}
                />
              </div>
            </TooltipContent>
          </Tooltip>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              variant="outline"
              onClick={handleClearCurrent}
              disabled={!openState.seed}
              className="h-auto gap-1 rounded bg-background hover:bg-muted text-xs py-1 shadow-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:size-3"
              title={t('graph.clearCacheCurrent')}
            >
              <Trash2 className="h-3 w-3" />
              {t('graph.legend.cache.clearCurrent')}
            </Button>
            <Button
              variant="outline"
              onClick={handleClearAll}
              className="h-auto gap-1 rounded bg-background hover:bg-muted text-xs py-1 shadow-none [&_svg]:size-3"
              title={t('graph.clearCacheAll')}
            >
              <Trash2 className="h-3 w-3" />
              {t('graph.legend.cache.clearAll')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
