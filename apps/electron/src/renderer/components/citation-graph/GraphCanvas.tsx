/**
 * 引用图谱主画布
 *
 * 使用 react-force-graph-2d 做力导向渲染，节点用 nodeCanvasObject 自定义绘制：
 *   - 颜色按 kind（seed 黑 / reference 蓝 / cited_by 橙 / hop2 灰）
 *   - 半径按被引次数对数缩放
 *   - 库内节点加绿色外描边
 *   - seed / 选中 / 悬停节点带 label
 * 边用 linkColor + linkLineDash 区分方向（cited_by 虚线）。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import { forceCollide, type ForceLink, type ForceManyBody } from 'd3-force'
import { useAtomValue, useSetAtom } from 'jotai'
import { Locate, Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { sanitizeText } from '@asci/shared'
import type { CitationGraphEdge, CitationGraphNode } from '@asci/shared'
import {
  graphDataAtom,
  graphSelectedNodeIdAtom,
  graphShowEdgeLabelsAtom,
  graphShowNodeLabelsAtom,
  graphZoteroAddedKeysAtom,
} from '@/atoms/citation-graph-atoms'
import { EDGE_COLOR, IN_LIBRARY_RING, NODE_COLOR, radiusForNode } from './graph-colors'
import { GraphLegend } from './GraphLegend'
import { useT } from '@/hooks/useT'

/** 传给 force-graph 的节点对象（force-graph 会在运行时写入 x/y/vx/vy/fx/fy） */
type FGNode = CitationGraphNode & { x?: number; y?: number; fx?: number; fy?: number }

/** 传给 force-graph 的边对象 */
type FGLink = Omit<CitationGraphEdge, 'source' | 'target'> & {
  source: string | FGNode
  target: string | FGNode
}

export function GraphCanvas() {
  const { t } = useT('library')
  const { t: tConv } = useT('conversation')
  const data = useAtomValue(graphDataAtom)
  const selectedId = useAtomValue(graphSelectedNodeIdAtom)
  const setSelectedId = useSetAtom(graphSelectedNodeIdAtom)
  const zoteroAdded = useAtomValue(graphZoteroAddedKeysAtom)
  const showNodeLabels = useAtomValue(graphShowNodeLabelsAtom)
  const showEdgeLabels = useAtomValue(graphShowEdgeLabelsAtom)

  const fgRef = useRef<ForceGraphMethods<FGNode, FGLink> | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 800, height: 560 })
  const [hoverId, setHoverId] = useState<string | null>(null)

  // 响应容器尺寸
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      setSize({ width: Math.max(320, rect.width), height: Math.max(320, rect.height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 把 Map 转为 array 供 force-graph 消费
  const graphData = useMemo(() => {
    const nodes: FGNode[] = Array.from(data.nodes.values()).map((n) => ({ ...n }))
    const links: FGLink[] = data.edges.map((e) => ({ ...e }))
    return { nodes, links }
  }, [data.nodes, data.edges])

  // 首次拿到 seed 时固定它到画布中心
  useEffect(() => {
    const seed = graphData.nodes.find((n) => n.kind === 'seed')
    if (!seed) return
    seed.fx = 0
    seed.fy = 0
  }, [graphData.nodes])

  // 配置 d3 力参数：加链接距离、排斥力与碰撞，避免节点挤成一团
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return

    const linkForce = fg.d3Force('link') as ForceLink<FGNode, FGLink> | null
    if (linkForce) {
      linkForce.distance((link) => {
        const l = link as FGLink
        if (l.hop === 2) return 30
        return l.kind === 'cited_by' ? 180 : 120
      })
      linkForce.strength(0.4)
    }

    const chargeForce = fg.d3Force('charge') as ForceManyBody<FGNode> | null
    if (chargeForce) {
      chargeForce.strength(-140).distanceMax(500)
    }

    // 节点碰撞：避免重叠
    fg.d3Force(
      'collide',
      forceCollide<FGNode>((node) => radiusForNode(node.kind, node.citedByCount) + 4),
    )

    fg.d3ReheatSimulation()
  }, [])

  // 每次数据变化后轻推模拟，让新节点找到位置
  useEffect(() => {
    fgRef.current?.d3ReheatSimulation()
  }, [graphData.nodes.length, graphData.links.length])

  // 构建完成后自动 fit 一次
  useEffect(() => {
    if (data.done && graphData.nodes.length > 1) {
      const t = setTimeout(() => {
        fgRef.current?.zoomToFit(500, 60)
      }, 600)
      return () => clearTimeout(t)
    }
  }, [data.done, graphData.nodes.length])

  const handleFit = () => {
    fgRef.current?.zoomToFit(400, 60)
  }

  const handleRecenter = () => {
    const seed = graphData.nodes.find((n) => n.kind === 'seed')
    if (!seed) {
      fgRef.current?.centerAt(0, 0, 400)
      return
    }
    fgRef.current?.centerAt(seed.x ?? 0, seed.y ?? 0, 400)
    fgRef.current?.zoom(1.2, 400)
  }

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-muted/10">
      {/* 图例 + 显示开关（左下） */}
      <GraphLegend />

      {/* 浮动操作按钮（右上） */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={handleFit}
          className="h-auto gap-1.5 bg-background/90 backdrop-blur px-2.5 py-1.5 shadow-md hover:bg-background [&_svg]:size-3.5"
          title={t('graph.fitView')}
        >
          <Maximize2 className="h-3.5 w-3.5" />
          {t('graph.fitViewLabel')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRecenter}
          className="h-auto gap-1.5 bg-background/90 backdrop-blur px-2.5 py-1.5 shadow-md hover:bg-background [&_svg]:size-3.5"
          title={t('graph.centerSeed')}
        >
          <Locate className="h-3.5 w-3.5" />
          {t('graph.centerSeedLabel')}
        </Button>
      </div>
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        width={size.width}
        height={size.height}
        backgroundColor="transparent"
        nodeId="id"
        nodeRelSize={4}
        nodeLabel={(n) => sanitizeText((n as FGNode).title)}
        linkColor={(link) => EDGE_COLOR[(link as FGLink).kind]}
        linkWidth={(link) => ((link as FGLink).hop === 1 ? 1.2 : 0.6)}
        linkLineDash={(link) => ((link as FGLink).kind === 'cited_by' ? [4, 4] : [])}
        linkDirectionalParticles={0}
        cooldownTicks={80}
        d3AlphaDecay={0.03}
        d3VelocityDecay={0.35}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const n = node as FGNode
          const r = radiusForNode(n.kind, n.citedByCount)
          const isSelected = selectedId === n.id
          const isHover = hoverId === n.id
          const emphasize = isSelected || isHover || n.kind === 'seed'
          const radius = emphasize ? r + 1.5 : r

          // 库内绿色外描边
          const inLibrary = n.inLibrary || zoteroAdded.has(n.id)
          if (inLibrary) {
            ctx.beginPath()
            ctx.arc(n.x ?? 0, n.y ?? 0, radius + 2, 0, 2 * Math.PI)
            ctx.strokeStyle = IN_LIBRARY_RING
            ctx.lineWidth = 2
            ctx.stroke()
          }

          // 节点本体
          ctx.beginPath()
          ctx.arc(n.x ?? 0, n.y ?? 0, radius, 0, 2 * Math.PI)
          ctx.fillStyle = NODE_COLOR[n.kind]
          ctx.fill()

          // 选中加白色内描边
          if (isSelected) {
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = 1.5
            ctx.stroke()
          }

          // Label：开关控制；开时所有节点都显示（截短防拥挤），关时仅强调节点显示
          const shouldShowLabel = showNodeLabels || emphasize
          if (shouldShowLabel && n.title) {
            // 根据节点角色选择截断长度（hop2 更短，避免覆盖其他节点）
            const maxLen = n.kind === 'seed' ? 50 : n.kind === 'hop2' ? 18 : 30
            const cleanTitle = sanitizeText(n.title)
            const label = cleanTitle.length > maxLen ? `${cleanTitle.slice(0, maxLen)}…` : cleanTitle
            // emphasize 节点字号大一点
            const baseFontSize = emphasize ? 11 : 9
            const fontSize = baseFontSize / globalScale
            ctx.font = `${fontSize}px Inter, sans-serif`
            const textWidth = ctx.measureText(label).width
            const padX = 3 / globalScale
            const padY = 1.5 / globalScale
            const bgX = (n.x ?? 0) - textWidth / 2 - padX
            const bgY = (n.y ?? 0) + radius + 2
            ctx.fillStyle = emphasize ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.82)'
            ctx.fillRect(bgX, bgY, textWidth + padX * 2, fontSize + padY * 2)
            ctx.fillStyle = '#1f1f24'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'top'
            ctx.fillText(label, n.x ?? 0, bgY + padY)
          }
        }}
        linkCanvasObjectMode={() => (showEdgeLabels ? 'after' : undefined)}
        linkCanvasObject={(link, ctx, globalScale) => {
          if (!showEdgeLabels) return
          const l = link as FGLink
          const src = l.source as FGNode
          const tgt = l.target as FGNode
          if (typeof src !== 'object' || typeof tgt !== 'object') return
          const mx = ((src.x ?? 0) + (tgt.x ?? 0)) / 2
          const my = ((src.y ?? 0) + (tgt.y ?? 0)) / 2
          const label = l.kind === 'references' ? tConv('agent.citationGraph.edgeReferences') : tConv('agent.citationGraph.edgeCitedBy')
          const fontSize = 9 / globalScale
          ctx.font = `${fontSize}px Inter, sans-serif`
          const textWidth = ctx.measureText(label).width
          const padX = 2 / globalScale
          const padY = 1 / globalScale
          ctx.fillStyle = 'rgba(255,255,255,0.9)'
          ctx.fillRect(mx - textWidth / 2 - padX, my - fontSize / 2 - padY, textWidth + padX * 2, fontSize + padY * 2)
          ctx.fillStyle = EDGE_COLOR[l.kind]
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(label, mx, my)
        }}
        onNodeClick={(node) => {
          setSelectedId((node as FGNode).id)
        }}
        onNodeHover={(node) => {
          setHoverId(node ? (node as FGNode).id : null)
          if (containerRef.current) {
            containerRef.current.style.cursor = node ? 'pointer' : 'default'
          }
        }}
      />
    </div>
  )
}
