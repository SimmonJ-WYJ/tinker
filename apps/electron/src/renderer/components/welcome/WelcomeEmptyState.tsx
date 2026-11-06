/**
 * WelcomeEmptyState — 会话空状态引导
 *
 * - 时段问候语
 * - 固定欢迎正文
 * - 轮播 Tips（每 6 秒切换一条，简约淡入淡出，无彩色装饰）
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { useDisplayUserName } from '@/atoms/user-profile'
import { getShuffledTips, getPlatform, type Tip } from '@/lib/tips'
import mascotImage from '@/assets/illustration/mascot.png'
import { StarterChips } from '@/components/onboarding/StarterChips'
import { pendingStarterPromptAtom } from '@/atoms/starter-prompt-atoms'
import { useT } from '@/hooks/useT'
import { dayjs } from '@asci/shared'

/** Tip 轮播间隔（毫秒） */
const TIP_ROTATION_INTERVAL_MS = 6000

/** 根据小时返回时段问候 i18n key */
function greetingKey(hour: number): 'greetingNight' | 'greetingMorning' | 'greetingAfternoon' | 'greetingEvening' {
  if (hour < 6) return 'greetingNight'
  if (hour < 12) return 'greetingMorning'
  if (hour < 18) return 'greetingAfternoon'
  return 'greetingEvening'
}

export function WelcomeEmptyState(): React.ReactElement {
  const { t } = useT('onboarding')
  const displayName = useDisplayUserName()
  const setPendingStarterPrompt = useSetAtom(pendingStarterPromptAtom)

  // 当前会话内稳定的 tip 序列（挂载时 shuffle 一次）
  const tips = React.useMemo<Tip[]>(() => getShuffledTips(getPlatform()), [])
  const [tipIndex, setTipIndex] = React.useState(0)

  React.useEffect(() => {
    if (tips.length <= 1) return
    const timer = setInterval(() => {
      setTipIndex((i) => (i + 1) % tips.length)
    }, TIP_ROTATION_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [tips.length])

  const hour = dayjs().hour()
  const greeting = t(`welcome.${greetingKey(hour)}`)
  const currentTip = tips[tipIndex]

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 pt-[10vh] animate-in fade-in duration-500">
      <img
        src={mascotImage}
        alt={t('welcome.mascotAlt')}
        className="size-[140px] object-contain select-none pointer-events-none"
        draggable={false}
      />

      <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
        {t('welcome.salutation', { name: displayName, greeting })}
      </h1>

      <p className="text-[14px] text-muted-foreground/80 text-center max-w-[520px] leading-relaxed">
        {t('welcome.tagline')}
      </p>

      <div data-spotlight-target="starter-chips">
        <StarterChips onSelect={(prompt) => setPendingStarterPrompt(prompt)} />
      </div>

      {currentTip && (
        <div className="mt-4 h-[20px] flex items-center justify-center px-4 max-w-[560px]">
          <span
            key={currentTip.id}
            className="text-sm text-muted-foreground/60 text-center truncate animate-in fade-in duration-700"
          >
            {t(`tips.${currentTip.textKey}` as 'tips.tipAgentFile')}
          </span>
        </div>
      )}
    </div>
  )
}
