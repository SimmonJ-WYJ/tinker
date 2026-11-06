/**
 * ResearchGap —— 研究空白·小版（0.4 Epic 1）的对照表数据模型
 *
 * 在用户圈定的一组文献上，把每篇按可比维度排成对照表（行=论文、列=维度）；
 * 没人填的属性组合 = 研究空白（ResearchGap），跨论文相反结论 = 结论冲突（ConflictNote）。
 *
 * 严格限定"在所选文献内"，不主张"全世界没人做过"。详见
 * docs/specs/0.4.0/research-gap-spec.md §5.2。
 *
 * 注：cell 溯源用现成 Anchor（双层定位：结构化 locationData + 兜底 snapshotText）。
 * 本期最终落库形态实现 AI 核心时再定（验收只验"可存可读回"）；当前类型供 UI 外壳与
 * mock 数据使用。
 */
import type { Anchor } from './anchor.ts'

/** 圈定的文献集来源：一个证据集，或一批论文 id */
export interface PaperSelectionRef {
  kind: 'evidence-set' | 'papers'
  /** kind='evidence-set' 时有值 */
  evidenceSetId?: string
  /** kind='papers' 时有值 */
  paperIds?: string[]
}

/** 列（可比维度）的来源：AI 提议 vs 用户编辑 */
export type GapColumnOrigin = 'ai' | 'user'

/** 对照表的一列（一个可比维度） */
export interface GapColumn {
  id: string
  name: string
  /** 'ai' = AI 提议（虚线 chip）；'user' = 用户新增/改过 */
  origin: GapColumnOrigin
}

/** 一个填上的格子的溯源信息（= 一条证据条目） */
export interface GapCellSource {
  /** 出处展示标签，如 "Wang 2023 · §4.1" */
  label: string
  /** 双层定位锚点：点格 → 预览原文快照 + 跳精读锚点 */
  anchor: Anchor
}

/** 对照表的一个格子 */
export interface GapCell {
  /** 取值；null = 该篇未涉及该维度（斜纹空格，**不等于**研究空白） */
  value: string | null
  /** 填了的格子带溯源；空格无 */
  source?: GapCellSource
}

/** 对照表的一行（一篇论文） */
export interface GapRow {
  paperId: string
  /** 行头展示标签，如 "Wang 2023" */
  paperLabel: string
  /** key = GapColumn.id */
  cells: Record<string, GapCell>
}

/**
 * 组合空白：AI 在填好的表上标出"这组论文里没出现的取值组合"。
 * 带依据 + 支撑论文，严格限定所选文献内。
 */
export interface ResearchGap {
  id: string
  title: string
  rationale: string
  /** 联动高亮：相关论文行 */
  supportingPaperIds: string[]
  /** 联动高亮：相关维度列 */
  involvedColumnIds: string[]
}

/** 结论冲突：跨论文在相近设置下结论相反处 */
export interface ConflictNote {
  id: string
  title: string
  rationale: string
  /** 冲突涉及的论文行（联动高亮 + 红框格） */
  paperIds: string[]
  /** 冲突涉及的维度列（联动高亮 + 红框格） */
  involvedColumnIds: string[]
}

/** 一张完整的研究空白对照表 */
export interface ResearchGapTable {
  id: string
  /**
   * 本次分析的简短标题（AI 生成，反映这批论文的对比主题，如 "大模型蛋白结构预测:AF 系对比"）。
   * 用作右栏 Tab 标题与对话内结果卡片标题 —— 每次分析各自独立，便于多次发起不同论文的研究空白。
   * 取不到时 UI 回退到 "研究空白 · N 篇"。
   */
  title: string
  /** 圈定的文献集 */
  sourceSelection: PaperSelectionRef
  /** 范围披露文案，如 "基于你选的 18 篇文献" */
  scopeLabel: string
  columns: GapColumn[]
  rows: GapRow[]
  /** AI 标注的组合空白 */
  gaps: ResearchGap[]
  /** AI 标注的结论冲突 */
  conflicts: ConflictNote[]
}
