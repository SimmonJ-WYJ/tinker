// apps/electron/src/renderer/components/auth/UpgradeNotice.tsx
/**
 * UpgradeNotice — 老用户升级 banner（spec §八）
 *
 * 当检测到未归属的本地数据时，在 LoginPage 顶部展示，
 * 提示用户将本地数据关联到即将登录的账户。
 */

import * as React from 'react'
import { Info } from 'lucide-react'
import { useT } from '@/hooks/useT.ts'
import { Checkbox } from '@/components/ui/checkbox.tsx'
import type { LocalDataSnapshot } from '@asci/shared'

interface UpgradeNoticeProps {
  snapshot: LocalDataSnapshot
  attributeChecked: boolean
  onAttributeChange: (checked: boolean) => void
}

export function UpgradeNotice({
  snapshot,
  attributeChecked,
  onAttributeChange,
}: UpgradeNoticeProps): React.ReactElement {
  const { t } = useT('auth')
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 mb-6 text-sm">
      <div className="flex items-start gap-2 mb-3">
        <Info className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
        <div className="font-medium">{t('upgrade.title')}</div>
      </div>
      <div className="ml-6 mb-3 text-xs text-foreground/70 font-mono">
        {'~/.asci/'}
        <br />
        {'├─ '}
        {t('upgrade.papers', { count: snapshot.counts.papers })}
        <br />
        {'├─ '}
        {t('upgrade.notes', { count: snapshot.counts.notes })}
        <br />
        {'└─ '}
        {t('upgrade.evidenceSets', { count: snapshot.counts.evidenceSets })}
      </div>
      <label className="flex items-start gap-2 cursor-pointer">
        <Checkbox
          checked={attributeChecked}
          onCheckedChange={(v) => onAttributeChange(v === true)}
        />
        <div>
          <div className="text-sm">{t('upgrade.attributeLabel')}</div>
          <div className="text-sm text-foreground/50">{t('upgrade.attributeHint')}</div>
        </div>
      </label>
    </div>
  )
}
