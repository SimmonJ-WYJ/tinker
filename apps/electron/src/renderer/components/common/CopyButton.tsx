/**
 * CopyButton - 复制消息内容按钮
 *
 * 使用 MessageAction + Copy/Check 图标切换。
 */

import { useState, useCallback } from 'react'
import { COPY_FEEDBACK_RESET_MS } from '@asci/shared'
import { CopyIcon, CheckIcon } from 'lucide-react'
import { MessageAction } from '@/components/ai-elements/message'
import { useT } from '@/hooks/useT'
import { captureFeedback } from '@/lib/telemetry'

interface CopyButtonProps {
  /** 要复制的内容 */
  content: string
}

export function CopyButton({ content }: CopyButtonProps): React.ReactElement {
  const { t } = useT('common')
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), COPY_FEEDBACK_RESET_MS)
      // 自进化隐式反馈（#427）：只采动作与对象类型，不采复制内容
      captureFeedback('copy', 'message')
    } catch (error) {
      console.error('复制失败:', error)
    }
  }, [content])

  return (
    <MessageAction
      tooltip={copied ? t('copied') : t('copy')}
      onClick={handleCopy}
    >
      {copied ? (
        <CheckIcon className="size-4" />
      ) : (
        <CopyIcon className="size-4" />
      )}
    </MessageAction>
  )
}
