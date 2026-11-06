/**
 * ExitPlanModeBanner — Agent ExitPlanMode 计划审批横幅（F51 重构）。
 *
 * 用 <ChoiceCard /> 渲染 4 个选项：approve_auto / approve_edit / deny / feedback。
 * 选中 feedback 后通过 bodyExtra 槽位展开内嵌文本框；其他选项直接 IPC 应答。
 * 计划所需权限列表（allowedPrompts）作为 body 内容渲染，保留旧行为。
 * Esc / 右上角 ✕ 关闭 = 终止 Agent，与旧 banner 行为一致。
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { Check, ShieldCheck, X, MessageSquare, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge.tsx'
import {
  allPendingExitPlanRequestsAtom,
  agentStreamingStatesAtom,
  finalizeStreamingActivities,
} from '@/atoms/agent-atoms'
import { useT } from '@/hooks/useT'
import { ChoiceCard } from './choice/ChoiceCard.tsx'
import { useActiveBannerSlot } from './choice/useActiveBannerSlot.ts'
import type { ExitPlanModeAction, ExitPlanAllowedPrompt } from '@asci/shared'

/** ExitPlanModeBanner 属性 */
interface ExitPlanModeBannerProps {
  sessionId: string
}

export function ExitPlanModeBanner({ sessionId }: ExitPlanModeBannerProps): React.ReactElement | null {
  const { t } = useT('conversation')
  const slot = useActiveBannerSlot(sessionId)
  const [allRequests, setAllRequests] = useAtom(allPendingExitPlanRequestsAtom)
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  const [submitting, setSubmitting] = React.useState(false)
  const [showFeedback, setShowFeedback] = React.useState(false)
  const [feedbackText, setFeedbackText] = React.useState('')

  const requests = allRequests.get(sessionId) ?? []
  const request = requests[0] ?? null
  const total = requests.length

  // 每次切换到新请求时重置 feedback 输入态
  React.useEffect(() => {
    setShowFeedback(false)
    setFeedbackText('')
  }, [request?.requestId])

  // 仅当 slot 仲裁返回 exitPlan 且有待处理请求时挂载
  if (slot !== 'exitPlan' || request == null) return null

  /** 响应 ExitPlanMode 请求（IPC + 队列出队） */
  const respond = async (action: ExitPlanModeAction, feedback?: string): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    try {
      await window.electronAPI.respondExitPlanMode({
        requestId: request.requestId,
        action,
        feedback,
      })
      // 移除已响应的请求（FIFO 出队）
      setAllRequests((prev) => {
        const map = new Map(prev)
        const current = map.get(sessionId) ?? []
        const newValue = current.filter((r) => r.requestId !== request.requestId)
        if (newValue.length === 0) map.delete(sessionId)
        else map.set(sessionId, newValue)
        return map
      })
    } catch (error) {
      console.error('[ExitPlanModeBanner] 响应失败:', error)
    } finally {
      setSubmitting(false)
    }
  }

  /** 关闭计划审批 & 终止 Agent（Esc / ✕） */
  const handleDismiss = (): void => {
    setStreamingStates((prev) => {
      const current = prev.get(sessionId)
      if (!current || !current.running) return prev
      const map = new Map(prev)
      map.set(sessionId, {
        ...current,
        running: false,
        ...finalizeStreamingActivities(current.toolActivities, current.teammates),
      })
      return map
    })
    setAllRequests((prev) => {
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })
    window.electronAPI.stopAgent(sessionId).catch(console.error)
  }

  /** 提交 feedback */
  const submitFeedback = (): void => {
    const trimmed = feedbackText.trim()
    if (trimmed === '') return
    void respond('feedback', trimmed)
  }

  /** ChoiceCard 选项点选回调 */
  const handleSelect = (id: string): void => {
    if (id === 'feedback') {
      setShowFeedback(true)
      return
    }
    void respond(id as ExitPlanModeAction)
  }

  // body：渲染计划所需权限列表（旧 AllowedPromptsList 行为保留）
  const body = request.allowedPrompts.length > 0
    ? <AllowedPromptsList prompts={request.allowedPrompts} label={t('exitPlan.allowedPromptsLabel')} />
    : null

  // bodyExtra：feedback 选中后展开的内嵌输入框
  const bodyExtra = showFeedback ? (
    <div className="px-3 pb-2 pt-1">
      <div className="flex gap-2">
        <input
          type="text"
          className="flex-1 px-3 py-2 rounded-lg text-xs bg-muted/40 focus:bg-muted/60 focus:outline-none placeholder:text-muted-foreground/40 transition-colors"
          placeholder={t('exitPlan.feedbackPlaceholder')}
          value={feedbackText}
          onChange={(e) => setFeedbackText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              e.stopPropagation()
              submitFeedback()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setShowFeedback(false)
              setFeedbackText('')
            }
          }}
          autoFocus
          disabled={submitting}
        />
        <Button
          variant="default"
          size="sm"
          onClick={submitFeedback}
          disabled={submitting || feedbackText.trim() === ''}
          className="h-8 px-3 text-xs shrink-0"
        >
          <Send className="size-3 mr-1" />
          {t('exitPlan.feedbackSend')}
        </Button>
      </div>
    </div>
  ) : null

  return (
    <ChoiceCard
      key={request.requestId}
      title={t('exitPlan.title')}
      subtitle={t('exitPlan.subtitle')}
      counter={total > 1 ? { current: 1, total } : undefined}
      footerHints={[
        { key: '↑↓', label: t('choiceCard.keyboardHint.navigate') },
        { key: '1-4', label: t('choiceCard.keyboardHint.select') },
        { key: 'esc', label: t('choiceCard.keyboardHint.dismissTerminate') },
      ]}
      onDismiss={handleDismiss}
      body={body}
      defaultFocusedId="approve_auto"
      options={[
        {
          id: 'approve_auto',
          label: t('exitPlan.options.approveAuto.label'),
          description: t('exitPlan.options.approveAuto.description'),
          icon: <Check className="size-3.5" />,
          disabled: submitting,
        },
        {
          id: 'approve_edit',
          label: t('exitPlan.options.approveEdit.label'),
          description: t('exitPlan.options.approveEdit.description'),
          icon: <ShieldCheck className="size-3.5" />,
          disabled: submitting,
        },
        {
          id: 'deny',
          label: t('exitPlan.options.deny.label'),
          description: t('exitPlan.options.deny.description'),
          icon: <X className="size-3.5" />,
          disabled: submitting,
        },
        {
          id: 'feedback',
          label: t('exitPlan.options.feedback.label'),
          description: t('exitPlan.options.feedback.description'),
          icon: <MessageSquare className="size-3.5" />,
          disabled: submitting,
        },
      ]}
      bodyExtra={bodyExtra}
      onSelect={handleSelect}
    />
  )
}

/** allowedPrompts 列表（保留旧 banner 的可视样式） */
function AllowedPromptsList({
  prompts,
  label,
}: {
  prompts: ExitPlanAllowedPrompt[]
  label: string
}): React.ReactElement {
  return (
    <div className="px-3 pb-2">
      <p className="text-sm text-muted-foreground mb-1">{label}</p>
      <div className="flex flex-wrap gap-1">
        {prompts.map((p, idx) => (
          <Badge key={idx} tone="primary" variant="soft" className="text-primary/80">
            {p.prompt}
          </Badge>
        ))}
      </div>
    </div>
  )
}
