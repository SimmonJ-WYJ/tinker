/**
 * DebugCopyButton（#710 PR3）
 *
 * 默认复制 **user-safe** 本轮摘要（L0/L1：text + 工具动作摘要；无 thinking 全文 / raw tool I/O / prompt / secret）。
 * 仅有效 dev 模式（useIsDevMode：dev server 或 Debug 开关）额外提供「redacted diagnostic」复制（脱敏后的 input/result，便于排查派发链路）。
 * 生产环境恒无全量 raw dump 路径（spec §8.4/§12.2）。区别于 CopyButton（只复制 text 块）。
 */
import * as React from 'react'
import { BugIcon, CheckIcon, ScrollText } from 'lucide-react'
import { MessageAction } from '@/components/ai-elements/message'
import { useT } from '@/hooks/useT'
import { useIsDevMode } from '@/lib/dev-mode'
import {
  formatTurnUserSafeSummary,
  formatTurnRedactedDiagnostic,
  type TurnDebugBlock,
} from './format-turn-debug-content.ts'
import type { SDKMessage } from '@asci/shared'
import { COPY_FEEDBACK_RESET_MS } from '@asci/shared'

interface DebugCopyButtonProps {
  topLevelEnriched: readonly TurnDebugBlock[]
  turnMessages: readonly SDKMessage[]
}

export function DebugCopyButton({ topLevelEnriched, turnMessages }: DebugCopyButtonProps): React.ReactElement | null {
  const { t } = useT('common')
  const isDevMode = useIsDevMode()
  const [copied, setCopied] = React.useState(false)
  const [diagCopied, setDiagCopied] = React.useState(false)

  const copy = React.useCallback(async (content: string, mark: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(content)
      mark(true)
      setTimeout(() => mark(false), COPY_FEEDBACK_RESET_MS)
    } catch (error) {
      console.error('Debug 复制失败:', error)
    }
  }, [])

  // 两个调试图标均为 dev-only：仅有效 dev 模式（dev server 或 Debug 开关）可见。
  if (!isDevMode) return null

  return (
    <>
      <MessageAction
        tooltip={copied ? t('debugCopied') : t('debugCopy')}
        onClick={() => void copy(formatTurnUserSafeSummary(topLevelEnriched, turnMessages), setCopied)}
      >
        {copied ? <CheckIcon className="size-4" /> : <ScrollText className="size-4" />}
      </MessageAction>
      {/* dev-only：脱敏诊断复制（dev-only 文案无需 i18n，见 docs/i18n.md §3.1）。 */}
      <MessageAction
        tooltip={diagCopied ? 'Diagnostic copied (redacted)' : 'Copy redacted diagnostic (dev)'}
        onClick={() => void copy(formatTurnRedactedDiagnostic(topLevelEnriched, turnMessages), setDiagCopied)}
      >
        {diagCopied ? <CheckIcon className="size-4" /> : <BugIcon className="size-4" />}
      </MessageAction>
    </>
  )
}
