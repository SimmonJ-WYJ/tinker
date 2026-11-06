/**
 * useDisplaySessionTitle — Agent 会话标题显示解析
 *
 * 主进程为新会话写入哨兵标题 '新 Agent 会话'（与历史 JSONL 兼容）；
 * UI 渲染时把哨兵替换为当前语言的 i18n 文案，用户改过的标题原样保留。
 */

import { useT } from '@/hooks/useT'

/** 与主进程 agent-orchestrator/agent-session-manager 一致 */
export const DEFAULT_AGENT_SESSION_TITLE = '新 Agent 会话'

/** 解析单个 title：哨兵 → i18n；其他原样 */
export function useDisplaySessionTitle(): (title: string) => string {
  const { t } = useT('conversation')
  return (title: string): string => {
    if (!title || title === DEFAULT_AGENT_SESSION_TITLE) return t('session.defaultTitle')
    return title
  }
}
