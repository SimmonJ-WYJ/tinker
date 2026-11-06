/**
 * 归一化论文来源 → 人类可读标签（i18n）
 *
 * 把 NormalizedPaperSource 枚举映射到 `conversation` ns 下的来源标签 key。
 * 检索结果筛选面板（SessionPapersFilterPanel）与论文详情卡（PaperDetailRenderer）
 * 共用此映射，确保两处展示一致（如 'crossref' → 'Crossref'）。
 */
import type { NormalizedPaperSource } from '@asci/shared'
import type { useT } from '@/hooks/useT'

/** 渲染归一化来源标签；t 必须来自 `conversation` ns */
export function renderSourceLabel(
  s: NormalizedPaperSource,
  t: ReturnType<typeof useT>['t'],
): string {
  switch (s) {
    case 'arxiv': return t('sessionPapers.filter.sourceArxiv')
    case 'pubmed': return t('sessionPapers.filter.sourcePubmed')
    case 'openalex': return t('sessionPapers.filter.sourceOpenalex')
    case 'semanticscholar': return t('sessionPapers.filter.sourceSemanticscholar')
    case 'crossref': return t('sessionPapers.filter.sourceCrossref')
    case 'dblp': return t('sessionPapers.filter.sourceDblp')
    case 'iacr': return t('sessionPapers.filter.sourceIacr')
    case 'biorxiv': return t('sessionPapers.filter.sourceBiorxiv')
    case 'europepmc': return t('sessionPapers.filter.sourceEuropepmc')
    case 'core': return t('sessionPapers.filter.sourceCore')
    case 'ieee': return t('sessionPapers.filter.sourceIeee')
    case 'web': return t('sessionPapers.filter.sourceWeb')
    case 'journal': return t('sessionPapers.filter.sourceJournal')
    case 'other': return t('sessionPapers.filter.sourceOther')
  }
}
