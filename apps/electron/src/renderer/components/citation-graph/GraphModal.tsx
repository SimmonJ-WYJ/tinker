/**
 * 引用图谱 Modal（所有三个入口共享）
 *
 * 布局：
 *   ┌──────────────────────────────────────────────┐
 *   │ 顶部：阶段进度条 + Seed 标题 + 关闭            │
 *   ├──────────────────────────────────┬───────────┤
 *   │                                  │           │
 *   │ GraphCanvas（力导向图）          │ NodeInsp. │
 *   │                                  │  (右栏)   │
 *   └──────────────────────────────────┴───────────┘
 *
 * Modal 挂载时由 useCitationGraph 自动触发 build + 订阅事件；关闭时 cancel。
 */

import { useAtomValue, useSetAtom } from 'jotai'
import { AlertTriangle, Loader2, Network } from 'lucide-react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { closeGraphAtom, graphDataAtom, graphOpenStateAtom } from '@/atoms/citation-graph-atoms'
import { GraphCanvas } from './GraphCanvas'
import { GraphPipeline } from './GraphPipeline'
import { NodeInspector } from './NodeInspector'
import { useCitationGraph } from './useCitationGraph'
import { useT } from '@/hooks/useT'

const GRAPH_NODE_LIMIT = 150

export function GraphModal() {
  const { t } = useT('library')
  const openState = useAtomValue(graphOpenStateAtom)
  const data = useAtomValue(graphDataAtom)
  const closeGraph = useSetAtom(closeGraphAtom)

  // 驱动 build + 订阅事件
  useCitationGraph()

  const nodeCount = data.nodes.size
  const seedTitle =
    openState.seedTitleHint ||
    Array.from(data.nodes.values()).find((n) => n.kind === 'seed')?.title ||
    t('graph.fallbackTitle')

  return (
    <DialogPrimitive.Root
      open={openState.open}
      onOpenChange={(open) => {
        if (!open) closeGraph()
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-[50%] top-[50%] z-[100] translate-x-[-50%] translate-y-[-50%]',
            'w-[95vw] h-[90vh] max-w-[1400px] bg-background rounded-lg shadow-xl border',
            'flex flex-col overflow-hidden',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          )}
        >
          {/* 顶部标题栏 */}
          <div className="flex items-center gap-3 px-4 py-3 border-b">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
              <Network className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="truncate text-base">{seedTitle}</DialogTitle>
              <p className="text-xs text-muted-foreground">
                {t('graph.summary', { count: nodeCount, edges: data.edges.length })}
                {data.truncated && t('graph.summaryTruncated')}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => closeGraph()}>
              {t('graph.close')}
            </Button>
          </div>

          {/* 阶段进度条 */}
          <GraphPipeline />

          {/* 错误提示（seed 失败等） */}
          {data.error && nodeCount === 0 && (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="flex flex-col items-center gap-2 text-center max-w-md">
                <AlertTriangle className="h-8 w-8 text-destructive" />
                <p className="text-sm font-medium">{t('graph.loadFailed')}</p>
                <p className="text-xs text-muted-foreground">{data.error}</p>
                <Button variant="outline" size="sm" onClick={() => closeGraph()} className="mt-2">
                  {t('graph.close')}
                </Button>
              </div>
            </div>
          )}

          {/* 加载骨架（seed 未到达） */}
          {!data.error && nodeCount === 0 && (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="flex flex-col items-center gap-2 text-center">
                <Loader2 className="h-8 w-8 text-primary animate-spin" />
                <p className="text-sm font-medium">{t('graph.locating')}</p>
                <p className="text-xs text-muted-foreground">{t('graph.locatingHint')}</p>
              </div>
            </div>
          )}

          {/* 图谱主体 */}
          {nodeCount > 0 && (
            <div className="flex-1 flex min-h-0">
              <div className="flex-1 min-w-0">
                <GraphCanvas />
              </div>
              <div className="w-[320px] border-l shrink-0">
                <NodeInspector />
              </div>
            </div>
          )}

          {/* 一跳均为空但 seed 已加载：友好提示 */}
          {nodeCount === 1 && data.done && !data.error && (
            <div className="px-4 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
              {t('graph.noCitations')}
            </div>
          )}

          {/* 截断提示 */}
          {data.truncated && (
            <div className="px-4 py-2 border-t bg-warning/10 text-xs text-warning">
              {t('graph.truncatedNotice', { limit: GRAPH_NODE_LIMIT })}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  )
}
