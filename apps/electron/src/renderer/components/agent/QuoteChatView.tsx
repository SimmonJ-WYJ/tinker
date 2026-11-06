// apps/electron/src/renderer/components/agent/QuoteChatView.tsx
/**
 * 引用对话视图：显示用户选中的文本，并提供一个输入框让用户针对引用内容提问
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { MessageSquare, Send } from 'lucide-react'
import { sidebarQuoteAtom } from '@/atoms/text-selection-atoms.ts'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'

export function QuoteChatView(): React.ReactElement {
  const quote = useAtomValue(sidebarQuoteAtom)
  const [question, setQuestion] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const { t } = useT('conversation')

  // 当引用变化时，清空问题输入
  React.useEffect(() => {
    setQuestion('')
  }, [quote])

  const handleSubmit = async (): Promise<void> => {
    if (!question.trim() || !quote || isSubmitting) return

    setIsSubmitting(true)
    try {
      // TODO: 集成 Agent 交互逻辑
      // 将 quote.text 和 question 发送给 Agent
      console.log('Quote:', quote.text)
      console.log('Question:', question)

      // 临时模拟提交延迟
      await new Promise(resolve => setTimeout(resolve, 500))

      // 提交成功后清空输入
      setQuestion('')
    } catch (error) {
      console.error('Failed to submit question:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Cmd/Ctrl + Enter 提交
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  if (!quote) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground p-6">
        <MessageSquare className="size-8 opacity-50" />
        <p>{t('rightPanel.quoteChat.noQuote')}</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto">
      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium text-muted-foreground">
          {t('rightPanel.quoteChat.selectedText')}
        </div>
        <div className="rounded-lg bg-muted/50 p-3 text-sm border border-border/50">
          <blockquote className="whitespace-pre-wrap break-words">
            {quote.text}
          </blockquote>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium text-muted-foreground">
          {t('rightPanel.quoteChat.askAbout')}
        </div>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('rightPanel.quoteChat.placeholder')}
          disabled={isSubmitting}
          className="min-h-[120px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {t('rightPanel.quoteChat.shortcut')}
          </div>
          <Button
            onClick={handleSubmit}
            disabled={!question.trim() || isSubmitting}
            size="sm"
            className="gap-1.5"
          >
            <Send className="size-3.5" />
            {isSubmitting ? t('rightPanel.quoteChat.sending') : t('rightPanel.quoteChat.send')}
          </Button>
        </div>
      </div>
    </div>
  )
}
