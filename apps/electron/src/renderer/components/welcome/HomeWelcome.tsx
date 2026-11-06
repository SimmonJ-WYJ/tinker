import { Box, FileText, Search, ShieldCheck } from 'lucide-react'
/** 确认稿首屏：复用正式品牌和现有编辑器，建议只回填文本。 */
import * as React from 'react'
import { AsciIcon } from '@/components/auth/AsciIcon'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'

export function HomeWelcome(): React.ReactElement {
  const { t } = useT('onboarding')
  return (
    <div className="home-welcome">
      <AsciIcon className="home-welcome__logo" />
      <h1>{t('home.title')}</h1>
    </div>
  )
}

interface HomeSuggestionsProps { mode?: 'coding' | 'search'; onSelect: (prompt: string) => void }
const suggestions = [
  { key: 'explore', prompt: 'explorePrompt', Icon: Search },
  { key: 'build', prompt: 'buildPrompt', Icon: Box },
  { key: 'write', prompt: 'writePrompt', Icon: FileText },
] as const

export function HomeSuggestions({ onSelect, mode = 'coding' }: HomeSuggestionsProps): React.ReactElement {
  const { t } = useT('onboarding')
  if (mode === 'search') return <></>
  return (
    <div role="group" aria-label={t('home.draftHint')} className="home-suggestions" data-spotlight-target="starter-chips">
      {suggestions.map(({ key, prompt, Icon }) => (
        <Button key={key} variant="outline" className="home-suggestion" onClick={() => onSelect(t(`home.${prompt}`))}>
          <Icon aria-hidden="true" strokeWidth={1.5} />
          {t(`home.${key}`)}
        </Button>
      ))}
    </div>
  )
}

export function HomeLocalNote(): React.ReactElement {
  const { t } = useT('onboarding')
  return <p className="home-local-note"><ShieldCheck aria-hidden="true" strokeWidth={1.5} />{t('home.privacy')}</p>
}
