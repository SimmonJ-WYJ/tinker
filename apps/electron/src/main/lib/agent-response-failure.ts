/** 已知响应失败的用户文案；未知上游正文不做插值。 */
import { AGENT_RESPONSE_FAILURE } from '@asci/shared'
import { t } from './i18n-main.ts'
export function getResponseFailureMessage(raw: string): string | null {
  if (/\bUpstream HTTP 429\b/.test(raw)) return t('errors.agentOrchestrator.rateLimited')
  if (raw.includes(AGENT_RESPONSE_FAILURE.EMPTY)) return t('errors.agentOrchestrator.emptyResponse')
  if (raw.includes(AGENT_RESPONSE_FAILURE.INCOMPLETE)) return t('errors.agentOrchestrator.incompleteResponse')
  return null
}
