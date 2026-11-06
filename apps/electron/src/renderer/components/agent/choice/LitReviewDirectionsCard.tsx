/**
 * LitReviewDirectionsCard — lit-review Turn 1 方向选择 ChoiceCard（spec §5.4）
 *
 * 触发：main 进程 lit-review SDK MCP server tool handler 发起
 *   `litreview_present_directions_request` event → useGlobalAgentListeners 入队 →
 *   Conversation 区按 sessionId 取该请求并渲染本组件。
 *
 * 用户路径：
 *   - 选 1/2/3 → tool result `{ choice: '1'|'2'|'3' }` → Agent 进入 Turn 2（单方向）
 *   - comprehensive → tool result `{ choice: 'comprehensive' }` → Agent 进入 Turn 2，对整个 EvidenceSet 做全景综述（不收敛到单方向）
 *   - reroll → tool result `{ choice: 'reroll' }` → Agent prompt 自识别重新生成 3 方向
 *   - custom → 弹 textarea 让用户输入 → tool result `{ choice: 'custom', customDirection }`
 *   - cancel (Esc) → tool result `{ choice: 'cancel' }` → Agent 收口或被中止
 *
 * 不在本组件范围：
 *   - 用户在 ChoiceCard 弹起期间继续 chat 输入（按 ExitPlanMode 同模式，主进程 block 等待）
 *   - 自定义方向 textarea 的多行编辑 / 模板（先用 prompt() 占位，后续美化）
 */

import * as React from 'react'
import type { LitReviewPresentDirectionsRequest, LitReviewPresentDirectionsResponse } from '@asci/shared'
import { useT } from '@/hooks/useT'
import { Button } from '@/components/ui/button'
import { ChoiceCard, type ChoiceOption } from './ChoiceCard.tsx'

interface LitReviewDirectionsCardProps {
  request: LitReviewPresentDirectionsRequest
  /** 用户做出选择后调用 — 内部 ipc invoke `litreview:present-directions-respond` */
  onRespond: (response: LitReviewPresentDirectionsResponse) => void | Promise<void>
}

export function LitReviewDirectionsCard({ request, onRespond }: LitReviewDirectionsCardProps): React.ReactElement {
  const { t } = useT('conversation')
  const [customMode, setCustomMode] = React.useState(false)
  const [customText, setCustomText] = React.useState('')

  // 把 3 个方向 + reroll / custom 渲染为 ChoiceCard options
  const options: ChoiceOption[] = React.useMemo(() => {
    const dirOptions: ChoiceOption[] = request.directions.map((d) => ({
      id: d.key,
      label: `${d.key}. ${d.title}`,
      description: [
        d.thesis,
        `  · ${d.outlinePreview.join('  ·  ')}`,
        `  · ${d.paperCount} papers (${d.paperWithFulltextCount} with full text)`,
      ].join('\n'),
    }))
    return [
      ...dirOptions,
      {
        id: 'comprehensive',
        label: request.comprehensiveLabel ?? t('agent.litReviewDirections.comprehensiveLabel'),
        // 优先用 Agent 按回复语言传入的说明，与方向 1/2/3 文案语言保持一致；缺省回退到 UI 语言 i18n
        description: request.comprehensiveDescription ?? t('agent.litReviewDirections.comprehensiveDescription'),
      },
      { id: 'reroll', label: request.rerollLabel ?? t('agent.litReviewDirections.rerollLabel') },
      { id: 'custom', label: request.customLabel ?? t('agent.litReviewDirections.customLabel') },
    ]
  }, [request, t])

  const handleSelect = (optionId: string): void => {
    if (optionId === '1' || optionId === '2' || optionId === '3') {
      void onRespond({ requestId: request.requestId, choice: optionId })
      return
    }
    if (optionId === 'comprehensive') {
      void onRespond({ requestId: request.requestId, choice: 'comprehensive' })
      return
    }
    if (optionId === 'reroll') {
      void onRespond({ requestId: request.requestId, choice: 'reroll' })
      return
    }
    if (optionId === 'custom') {
      setCustomMode(true)
      return
    }
  }

  const handleSubmitCustom = (): void => {
    const trimmed = customText.trim()
    if (trimmed.length === 0) return
    void onRespond({ requestId: request.requestId, choice: 'custom', customDirection: trimmed })
  }

  if (customMode) {
    return (
      <div className="rounded-md border border-border/40 bg-card p-3 shadow-sm">
        <div className="text-sm font-medium text-foreground mb-2">{t('agent.litReviewDirections.customTitle')}</div>
        <textarea
          autoFocus
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          placeholder={t('agent.litReviewDirections.customPlaceholder')}
          className="w-full min-h-[100px] resize-y rounded-md border border-border/40 bg-background px-3 py-2 text-sm focus:outline-none"
        />
        <div className="flex justify-end gap-2 mt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => { setCustomMode(false); setCustomText('') }}
            className="h-auto px-3 py-1.5 text-sm text-foreground/70 hover:bg-muted"
          >
            {t('agent.litReviewDirections.cancel')}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleSubmitCustom}
            disabled={customText.trim().length === 0}
            className="h-auto px-3 py-1.5 text-sm shadow-none disabled:cursor-not-allowed"
          >
            {t('agent.litReviewDirections.submitCustom')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <ChoiceCard
      title={t('agent.litReviewDirections.title')}
      subtitle={t('agent.litReviewDirections.subtitle')}
      options={options}
      onSelect={handleSelect}
      onDismiss={() => void onRespond({ requestId: request.requestId, choice: 'cancel' })}
    />
  )
}
