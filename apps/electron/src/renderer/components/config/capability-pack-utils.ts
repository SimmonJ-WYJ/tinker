/**
 * 能力包卡片纯工具
 */
import type { CapabilityPackListItem } from '@asci/shared'

/**
 * 解析能力包面向用户的一句话摘要：summaryI18n[当前语言] → summaryI18n[另一语言] → 空串。
 *
 * 安全边界 #710：缺 summaryI18n 时**不回退** scenarioAgent.description（路由 prompt 全文，已不下发 renderer）；
 * 返回空串，由组件回退到中性占位文案（capabilityPacks.noSummary）。
 */
export function resolvePackSummary(pack: CapabilityPackListItem, lang: 'zh' | 'en'): string {
  const s = pack.summaryI18n
  if (s) {
    const other = lang === 'zh' ? 'en' : 'zh'
    const picked = s[lang] ?? s[other]
    if (picked && picked.trim()) return picked
  }
  return ''
}
