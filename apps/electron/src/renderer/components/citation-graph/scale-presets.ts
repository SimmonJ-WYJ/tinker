/**
 * 引用图谱展开规模预设
 *
 * 三档（小 / 中 / 大）控制 5 个展开参数。节点总数上限（MAX_NODES）在 service 层为 300，
 * 大档理论上限 ~220 节点，留给 seed + hop1 + 截断缓冲。
 *
 * 调整时保持：refs > cited_by（refs 是论文引用他人，通常更重要）、
 *   hop2 per-node 数 × hop2TopN 控制二跳规模。
 */

export type CitationGraphScalePreset = 'small' | 'medium' | 'large'

export interface ScaleParams {
  refsLimit: number
  citedByLimit: number
  hop2TopN: number
  hop2RefsPerNode: number
  hop2CitedByPerNode: number
}

export const SCALE_PRESETS: Record<CitationGraphScalePreset, ScaleParams> = {
  small: {
    refsLimit: 15,
    citedByLimit: 10,
    hop2TopN: 4,
    hop2RefsPerNode: 2,
    hop2CitedByPerNode: 1,
  },
  medium: {
    refsLimit: 40,
    citedByLimit: 25,
    hop2TopN: 8,
    hop2RefsPerNode: 5,
    hop2CitedByPerNode: 3,
  },
  large: {
    refsLimit: 70,
    citedByLimit: 50,
    hop2TopN: 12,
    hop2RefsPerNode: 8,
    hop2CitedByPerNode: 5,
  },
}

export const SCALE_PRESET_LABELS: Record<CitationGraphScalePreset, string> = {
  small: '小',
  medium: '中',
  large: '大',
}

/** 一行式描述，给 tooltip / 文案复用 */
export function describeScale(preset: CitationGraphScalePreset): string {
  const p = SCALE_PRESETS[preset]
  const hop2Cap = p.hop2TopN * (p.hop2RefsPerNode + p.hop2CitedByPerNode)
  return `1 层：${p.refsLimit} 引用 + ${p.citedByLimit} 被引；2 层：top ${p.hop2TopN} × (${p.hop2RefsPerNode}+${p.hop2CitedByPerNode}) ≤ ${hop2Cap} 节点`
}
