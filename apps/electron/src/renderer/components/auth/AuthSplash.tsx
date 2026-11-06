// apps/electron/src/renderer/components/auth/AuthSplash.tsx
/**
 * AuthSplash — auth status 为 checking/uninitialized 时显示的启动遮罩
 * spec §九
 */

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { useT } from '@/hooks/useT.ts'
import { TitlebarDragRegion } from '@/components/app-shell/TitlebarDragRegion.tsx'
import { TinkerLogo } from './TinkerLogo.tsx'

export function AuthSplash(): React.ReactElement {
  const { t } = useT('auth')
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <TitlebarDragRegion />
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
          <TinkerLogo appearance="inverse" className="w-7 h-7" />
        </div>
        <Loader2 className="w-5 h-5 animate-spin text-foreground/50" />
        <p className="text-sm text-foreground/60">{t('splash.checking')}</p>
      </div>
    </div>
  )
}
