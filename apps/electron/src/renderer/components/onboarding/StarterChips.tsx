/**
 * StarterChips — 默认页吉祥物下方常驻起手式 chip
 *
 * 任何空会话都显示；点击 chip 触发 onSelect(prompt)，由父组件填入对话输入框
 */
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'

interface StarterChipDescriptor {
  icon: string  // emoji
  /** i18n 完整 key（label / prompt） */
  labelKey:
    | 'starterChips.searchProtein.label'
    | 'starterChips.analyzePdf.label'
    | 'starterChips.importZotero.label'
    | 'starterChips.generateReview.label'
  promptKey:
    | 'starterChips.searchProtein.prompt'
    | 'starterChips.analyzePdf.prompt'
    | 'starterChips.importZotero.prompt'
    | 'starterChips.generateReview.prompt'
}

const STARTER_CHIPS: ReadonlyArray<StarterChipDescriptor> = [
  { icon: '🔎', labelKey: 'starterChips.searchProtein.label', promptKey: 'starterChips.searchProtein.prompt' },
  { icon: '📄', labelKey: 'starterChips.analyzePdf.label', promptKey: 'starterChips.analyzePdf.prompt' },
  { icon: '📚', labelKey: 'starterChips.importZotero.label', promptKey: 'starterChips.importZotero.prompt' },
  { icon: '✍', labelKey: 'starterChips.generateReview.label', promptKey: 'starterChips.generateReview.prompt' },
]

export interface StarterChipsProps {
  onSelect: (prompt: string) => void
}

export function StarterChips({ onSelect }: StarterChipsProps): React.ReactElement {
  const { t } = useT('onboarding')
  return (
    <div className="mt-4 flex flex-wrap gap-2 justify-center max-w-[480px]">
      {STARTER_CHIPS.map((chip) => (
        <Button
          key={chip.labelKey}
          type="button"
          variant="outline"
          onClick={() => onSelect(t(chip.promptKey))}
          className="h-auto gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-normal text-foreground/80 hover:border-foreground/30 hover:bg-foreground/5 hover:text-foreground/80"
        >
          <span>{chip.icon}</span>
          <span>{t(chip.labelKey)}</span>
        </Button>
      ))}
    </div>
  )
}
