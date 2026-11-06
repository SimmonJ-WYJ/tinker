/**
 * AskUserBanner — Agent AskUserQuestion 交互式问答横幅（F51 重构）。
 *
 * 仅把外框 / 标题 / counter / footer hint 委托给 <ChoiceCardShell />，
 * 多选 / 自定义文本 / 多题 Tab / ↑↓+Enter 键盘逻辑全部留在 banner 内。
 * Esc / 右上角 ✕（由 Shell 提供 onDismiss）= 终止 Agent，行为与旧 banner 一致。
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { Check, ChevronLeft } from 'lucide-react'
import { allPendingAskUserRequestsAtom, agentStreamingStatesAtom, finalizeStreamingActivities } from '@/atoms/agent-atoms'
import { useT } from '@/hooks/useT'
import { ChoiceCardShell } from './choice/ChoiceCardShell.tsx'
import { choiceTokens } from './choice/choice-tokens.ts'
import { useActiveBannerSlot } from './choice/useActiveBannerSlot.ts'
import type { AskUserQuestion } from '@asci/shared'

interface QuestionAnswer {
  selected: string[]
  customText: string
  showCustom: boolean
}

const EMPTY_ANSWER: QuestionAnswer = { selected: [], customText: '', showCustom: false }

/** AskUserBanner 属性接口 */
interface AskUserBannerProps {
  sessionId: string
}

export function AskUserBanner({ sessionId }: AskUserBannerProps): React.ReactElement | null {
  const { t } = useT('conversation')
  const slot = useActiveBannerSlot(sessionId)
  const [allRequests, setAllRequests] = useAtom(allPendingAskUserRequestsAtom)
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  const requests = allRequests.get(sessionId) ?? []
  const [answers, setAnswers] = React.useState<Map<number, QuestionAnswer>>(new Map())
  const [submitting, setSubmitting] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState(0)
  const [focusedOptIdx, setFocusedOptIdx] = React.useState(-1)

  const request = requests[0] ?? null
  const total = requests.length
  const questions = request?.questions ?? []
  const isLastTab = activeTab >= questions.length - 1

  // ===== Refs：确保 keydown handler 始终读取最新值，消除闭包过期问题 =====
  const activeTabRef = React.useRef(activeTab)
  activeTabRef.current = activeTab
  const questionsRef = React.useRef(questions)
  questionsRef.current = questions
  const focusedOptIdxRef = React.useRef(focusedOptIdx)
  focusedOptIdxRef.current = focusedOptIdx
  const submitRef = React.useRef<(() => void) | null>(null)
  const autoAdvanceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearAutoAdvanceTimer = React.useCallback((): void => {
    if (autoAdvanceTimerRef.current != null) {
      clearTimeout(autoAdvanceTimerRef.current)
      autoAdvanceTimerRef.current = null
    }
  }, [])

  // 组件卸载时清理未触发的跳转定时器
  React.useEffect(() => clearAutoAdvanceTimer, [clearAutoAdvanceTimer])

  React.useEffect(() => {
    clearAutoAdvanceTimer()
    setActiveTab(0)
    setFocusedOptIdx(-1)
    const firstOpt = questions[0]?.options[0]
    setAnswers(firstOpt
      ? new Map([[0, { ...EMPTY_ANSWER, selected: [firstOpt.label] }]])
      : new Map())
  }, [request?.requestId])

  // 切换 Tab 时重置焦点并默认选中第一个选项
  React.useEffect(() => {
    setFocusedOptIdx(-1)
    setAnswers((prev) => {
      if (prev.has(activeTab)) return prev
      const firstOpt = questions[activeTab]?.options[0]
      if (!firstOpt) return prev
      const map = new Map(prev)
      map.set(activeTab, { ...EMPTY_ANSWER, selected: [firstOpt.label] })
      return map
    })
  }, [activeTab])

  // 键盘导航：只在 requestId 变化时重建 handler，内部通过 ref 读取最新值
  // 注：Esc 由 ChoiceCardShell 自己处理，此处只管 ↑↓ / Enter
  React.useEffect(() => {
    if (!request || questions.length === 0) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      const curTab = activeTabRef.current
      const qs = questionsRef.current
      const curFocusIdx = focusedOptIdxRef.current
      const q = qs[curTab]
      if (!q) return
      const itemCount = q.options.length + 1
      const lastTab = curTab >= qs.length - 1

      // 自由文本输入框内：仅 Enter 生效（输入法组合中跳过）
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault()
          if (lastTab) submitRef.current?.()
          else setActiveTab((prev) => prev + 1)
        }
        return
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const nextIdx = curFocusIdx === -1
          ? (e.key === 'ArrowDown' ? 0 : itemCount - 1)
          : e.key === 'ArrowDown'
            ? (curFocusIdx + 1) % itemCount
            : (curFocusIdx - 1 + itemCount) % itemCount
        setFocusedOptIdx(nextIdx)
        // 移动焦点同时选中
        if (nextIdx < q.options.length) {
          const opt = q.options[nextIdx]
          if (opt) toggleOptionByState(curTab, q, opt.label)
        } else {
          toggleCustomByState(curTab)
        }
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        if (lastTab) submitRef.current?.()
        else setActiveTab((prev) => prev + 1)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [request?.requestId])

  /** 关闭问题 & 终止 Agent（Esc / Shell 顶部 ✕） */
  const handleDismiss = (): void => {
    // 立即标记 streaming 停止，避免 UI 残留
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
    // 清除当前 session 所有待处理的 AskUser 请求
    setAllRequests((prev) => {
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })
    // 终止 Agent
    window.electronAPI.stopAgent(sessionId).catch(console.error)
  }

  // slot 仲裁：当前 session 应展示 askUser slot 且有 pending 请求时才挂载
  if (slot !== 'askUser' || request == null) return null

  const getAnswer = (idx: number): QuestionAnswer => answers.get(idx) ?? EMPTY_ANSWER

  function toggleOptionByState(qIdx: number, q: AskUserQuestion, label: string): void {
    setAnswers((prev) => {
      const map = new Map(prev)
      const cur = map.get(qIdx) ?? EMPTY_ANSWER
      const selected = q.multiSelect
        ? (cur.selected.includes(label) ? cur.selected.filter((s) => s !== label) : [...cur.selected, label])
        : [label]
      map.set(qIdx, { ...cur, selected, showCustom: false, customText: '' })
      return map
    })
  }

  function toggleCustomByState(qIdx: number): void {
    setAnswers((prev) => {
      const map = new Map(prev)
      const cur = map.get(qIdx) ?? EMPTY_ANSWER
      map.set(qIdx, { ...cur, showCustom: !cur.showCustom, selected: cur.showCustom ? cur.selected : [] })
      return map
    })
  }

  const handleSubmit = async (): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    try {
      const answersRecord: Record<string, string> = {}
      for (let i = 0; i < questions.length; i++) {
        const answer = getAnswer(i)
        if (answer.showCustom && answer.customText.trim()) {
          answersRecord[String(i)] = answer.customText.trim()
        } else if (answer.selected.length > 0) {
          answersRecord[String(i)] = answer.selected.join(', ')
        }
      }
      await window.electronAPI.respondAskUser({ requestId: request.requestId, answers: answersRecord })
      setAllRequests((prev) => {
        const map = new Map(prev)
        const current = map.get(sessionId) ?? []
        const newValue = current.filter((r) => r.requestId !== request.requestId)
        if (newValue.length === 0) map.delete(sessionId)
        else map.set(sessionId, newValue)
        return map
      })
    } catch (error) {
      console.error('[AskUserBanner] 响应失败:', error)
    } finally {
      setSubmitting(false)
    }
  }

  submitRef.current = handleSubmit

  const hasValidAnswers = questions.some((_, idx) => {
    const a = getAnswer(idx)
    return a.selected.length > 0 || (a.showCustom && a.customText.trim().length > 0)
  })

  const currentQuestion = questions[activeTab]
  if (!currentQuestion) return null

  const goNextTab = (): void => {
    if (!isLastTab) setActiveTab((prev) => prev + 1)
  }

  const tabSelectionType = (q: AskUserQuestion): string =>
    q.multiSelect ? t('askUser.multiSelect') : t('askUser.singleSelect')

  const goPrevTab = (): void => {
    if (activeTab > 0) setActiveTab((prev) => prev - 1)
  }

  const fallbackHeader = t('askUser.questionFallback', { index: activeTab + 1 })
  const stepTitle = currentQuestion.header || fallbackHeader
  const confirmLabel = isLastTab ? t('askUser.confirm') : t('askUser.next')
  const confirmDisabled = submitting || (isLastTab && !hasValidAnswers)
  const handleConfirm = isLastTab ? () => void handleSubmit() : goNextTab

  return (
    <ChoiceCardShell
      title={stepTitle}
      subtitle={tabSelectionType(currentQuestion)}
      counter={questions.length > 1 ? { current: activeTab + 1, total: questions.length } : undefined}
      footerHints={[
        { key: '↑↓', label: t('choiceCard.keyboardHint.navigate') },
        { key: 'esc', label: t('choiceCard.keyboardHint.dismissTerminate') },
      ]}
      confirmLabel={confirmLabel}
      onConfirm={handleConfirm}
      confirmDisabled={confirmDisabled}
      onDismiss={handleDismiss}
    >
      <div className="space-y-2">
        {/* 上一步按钮（步骤 2+ 才显示） */}
        {activeTab > 0 && (
          <button
            type="button"
            onClick={goPrevTab}
            className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="size-3" />
            <span>{t('askUser.previous')}</span>
          </button>
        )}

        {/* 当前问题内容 */}
        <QuestionCard
          question={currentQuestion}
          answer={getAnswer(activeTab)}
          focusedIndex={focusedOptIdx}
          customLabel={t('askUser.customOption')}
          customPlaceholder={t('askUser.customPlaceholder')}
          onToggleOption={(label) => {
            toggleOptionByState(activeTab, currentQuestion, label)
            if (!currentQuestion.multiSelect && !isLastTab) {
              clearAutoAdvanceTimer()
              autoAdvanceTimerRef.current = setTimeout(() => {
                autoAdvanceTimerRef.current = null
                setActiveTab((prev) => prev + 1)
              }, 150)
            }
          }}
          onToggleCustom={() => toggleCustomByState(activeTab)}
          onCustomTextChange={(text) => setAnswers((prev) => {
            const map = new Map(prev)
            const cur = map.get(activeTab) ?? EMPTY_ANSWER
            map.set(activeTab, { ...cur, customText: text })
            return map
          })}
          onSubmit={isLastTab ? () => void handleSubmit() : goNextTab}
        />
      </div>
    </ChoiceCardShell>
  )
}

/** 单个问题卡片（竖向选项，复用 choice-tokens 与 PermissionBanner 同源） */
function QuestionCard({
  question,
  answer,
  focusedIndex,
  customLabel,
  customPlaceholder,
  onToggleOption,
  onToggleCustom,
  onCustomTextChange,
  onSubmit,
}: {
  question: AskUserQuestion
  answer: QuestionAnswer
  focusedIndex: number
  customLabel: string
  customPlaceholder: string
  onToggleOption: (label: string) => void
  onToggleCustom: () => void
  onCustomTextChange: (text: string) => void
  onSubmit: () => void
}): React.ReactElement {
  const optionCount = question.options.length

  return (
    <div className="space-y-2">
      {/* 问题文本 */}
      <p className="text-sm text-foreground">{question.question}</p>

      {/* 竖向选项（与 PermissionBanner 共用 choice-tokens） */}
      <ul role="listbox" className="mt-1 py-0.5">
        {question.options.map((option, idx) => {
          const isSelected = answer.selected.includes(option.label)
          const isFocused = focusedIndex === idx
          return (
            <li
              key={option.label}
              role="option"
              aria-selected={isSelected}
              className={[
                choiceTokens.optionRow,
                (isFocused || isSelected) ? choiceTokens.focusRow : '',
              ].filter(Boolean).join(' ')}
              onClick={() => onToggleOption(option.label)}
            >
              <span className={choiceTokens.optionPrefix}>
                <span aria-hidden="true" className="inline-block w-3">{isFocused ? '›' : ' '}</span>
                <span>{idx < 9 ? `${idx + 1}.` : '·'}</span>
              </span>
              <div className="flex-1 min-w-0">
                <div className={choiceTokens.optionLabel}>{option.label}</div>
                {option.description && (
                  <div className={choiceTokens.optionDescription}>{option.description}</div>
                )}
              </div>
              {isSelected && <Check className="size-4 text-primary shrink-0 mt-0.5" />}
            </li>
          )
        })}

        {/* "其他" 自定义项 */}
        <li
          role="option"
          aria-selected={answer.showCustom}
          className={[
            choiceTokens.optionRow,
            (focusedIndex === optionCount || answer.showCustom) ? choiceTokens.focusRow : '',
          ].filter(Boolean).join(' ')}
          onClick={onToggleCustom}
        >
          <span className={choiceTokens.optionPrefix}>
            <span aria-hidden="true" className="inline-block w-3">{focusedIndex === optionCount ? '›' : ' '}</span>
            <span>{optionCount < 9 ? `${optionCount + 1}.` : '·'}</span>
          </span>
          <div className="flex-1 min-w-0">
            <div className={choiceTokens.optionLabel}>{customLabel}</div>
          </div>
          {answer.showCustom && <Check className="size-4 text-primary shrink-0 mt-0.5" />}
        </li>
      </ul>

      {/* 自由文本输入 */}
      {answer.showCustom && (
        <input
          type="text"
          className="w-full px-3 py-2 rounded-lg text-sm bg-muted/40 focus:bg-muted/60 focus:outline-none placeholder:text-muted-foreground/40 transition-colors"
          placeholder={customPlaceholder}
          value={answer.customText}
          onChange={(e) => onCustomTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              e.stopPropagation() // 阻止冒泡到 document handler，避免重复触发 setActiveTab
              onSubmit()
            }
          }}
          autoFocus
        />
      )}
    </div>
  )
}
