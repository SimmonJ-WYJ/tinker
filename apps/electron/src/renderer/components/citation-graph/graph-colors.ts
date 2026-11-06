/**
 * 引用图谱视觉常量
 *
 * 节点角色 vs 边方向的颜色映射，参考 ASCI 的视觉语言：
 *   - seed 黑色，画面中心
 *   - reference 蓝色（seed 向后引用）
 *   - cited_by 橙色（seed 被向前引用）
 *   - hop2 灰色（二跳节点）
 *   - 库内节点外描边绿色
 */

import type { CitationEdgeKind, CitationNodeKind } from '@asci/shared'

export const NODE_COLOR: Record<CitationNodeKind, string> = {
  seed: '#1f1f24',
  reference: '#0a84ff',
  cited_by: '#ff6b35',
  hop2: '#8e8e93',
}

export const NODE_LABEL_COLOR: Record<CitationNodeKind, string> = {
  seed: '#ffffff',
  reference: '#ffffff',
  cited_by: '#ffffff',
  hop2: '#ffffff',
}

export const EDGE_COLOR: Record<CitationEdgeKind, string> = {
  references: '#60a5fa',
  cited_by: '#fb923c',
}

/** 库内论文节点的外描边 */
export const IN_LIBRARY_RING = '#22c55e'

/** 节点基础尺寸（半径，像素） */
export const NODE_RADIUS = {
  seed: 10,
  reference: 5,
  cited_by: 5,
  hop2: 3.5,
} as const

/** 悬停 / 选中时节点半径加成 */
export const NODE_RADIUS_BOOST = 1.5

/** 基于 citedByCount 的对数缩放系数 */
export function radiusForNode(
  kind: CitationNodeKind,
  citedByCount: number | null,
): number {
  const base = NODE_RADIUS[kind]
  if (!citedByCount || citedByCount <= 0) return base
  // 1 + log10(count) / 2，粗略让超高被引的节点放大 2~3 倍
  const boost = Math.log10(citedByCount + 1) / 2
  return base + Math.min(base * boost, base * 2)
}
