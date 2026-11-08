import { SidebarGlyph } from '../app-shell/SidebarGlyph'
// apps/electron/src/renderer/components/auth/AccountMenu.tsx
/**
 * AccountMenu — 侧边栏底部账户菜单触发器 + 弹出卡片，spec §九
 *
 * 读取 currentUserAtom / sessionMetaAtom。
 * 未登录时返回 null（由 RouteGuard 确保登录态下才挂载此组件，但做防御判断）。
 * DEV bypass 标识仅在开发期显示，树摇后不进产物。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Settings, LogOut, CheckCircle2 } from 'lucide-react'
import { nowMs, toMs } from '@asci/shared'
import { useT } from '@/hooks/useT.ts'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { currentUserAtom, sessionMetaAtom } from '@/atoms/auth-atoms.ts'
import { settingsTabAtom, settingsOpenAtom } from '@/atoms/settings-tab.ts'
import { formatUserDisplay, formatAvatarFallback } from '@/lib/auth/account-menu-helpers.ts'
import { DevOnly } from '@/lib/dev-mode.tsx'
import { languageAtom } from '@/atoms/language-atoms.ts'
import { LogoutConfirmDialog } from './LogoutConfirmDialog.tsx'

/** 相对时间格式化（简单本地化实现） */
function formatRelativeTime(isoString: string, locale: string): string {
  const diff = nowMs() - toMs(isoString)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return locale === 'zh' ? '刚刚' : 'Just now'
  if (minutes < 60) return locale === 'zh' ? `${minutes} 分钟前` : `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return locale === 'zh' ? `${hours} 小时前` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  return locale === 'zh' ? `${days} 天前` : `${days}d ago`
}

export function AccountMenu(): React.ReactElement | null {
  const { t } = useT('auth')
  const user = useAtomValue(currentUserAtom)
  const sessionMeta = useAtomValue(sessionMetaAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const locale = useAtomValue(languageAtom)

  const [logoutOpen, setLogoutOpen] = React.useState(false)
  const [popoverOpen, setPopoverOpen] = React.useState(false)

  if (user === null) return null

  const displayName = formatUserDisplay(user)
  const avatarFallback = formatAvatarFallback(user)
  // 与 Profile 设置一致：定义了头像图（data:image / http URL）则展示图片，否则回退首字母
  const hasAvatarImage =
    user.avatarUrl !== null &&
    (user.avatarUrl.startsWith('data:image') || user.avatarUrl.startsWith('http'))

  const handleAccountSettings = (): void => {
    setPopoverOpen(false)
    setSettingsTab('profile')
    setSettingsOpen(true)
  }

  const handleLogoutClick = (): void => {
    setPopoverOpen(false)
    setLogoutOpen(true)
  }

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={accountMenuTriggerClassName()}
          >
            {/* 头像：定义了头像图则显示图片，否则回退到首字母 */}
            <div className="relative flex-shrink-0">
              <div className="w-6 h-6 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary select-none">
                {hasAvatarImage ? (
                  <img src={user.avatarUrl ?? ''} alt={displayName} className="size-full object-cover" />
                ) : (
                  avatarFallback
                )}
              </div>
              {/* DEV 标识点（仅开发期） */}
              <DevOnly>
                {sessionMeta?.isDevBypass === true && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 px-0.5 rounded-md bg-warning text-badge font-normal text-warning-foreground flex items-center leading-none">
                    {t('menu.devChip')}
                  </span>
                )}
              </DevOnly>
            </div>
            {/* 用户名 */}
            <span className="flex-1 text-sm truncate text-left">{displayName}</span>
            <span className="sidebar-account-chevron"><SidebarGlyph name="chevron" /></span>
          </button>
        </PopoverTrigger>

        <PopoverContent
          side="top"
          align="start"
          sideOffset={6}
          className="w-[var(--radix-popover-trigger-width)] p-0 overflow-hidden"
        >
          {/* DEV bypass banner（仅开发期） */}
          <DevOnly>
            {sessionMeta?.isDevBypass === true && (
              <div className="bg-warning/10 border-b border-warning/20 px-3 py-2">
                <p className="text-sm text-warning leading-snug">
                  {t('menu.devBypass')}
                </p>
              </div>
            )}
          </DevOnly>

          {/* 用户信息卡片 */}
          <div className="px-4 pt-4 pb-3 space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary select-none flex-shrink-0">
                {hasAvatarImage ? (
                  <img src={user.avatarUrl ?? ''} alt={displayName} className="size-full object-cover" />
                ) : (
                  avatarFallback
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium truncate">{displayName}</span>
                  <DevOnly>
                    {sessionMeta?.isDevBypass === true && (
                      <Badge tone="warning" variant="soft" className="px-1 py-0">
                        {t('menu.devChip')}
                      </Badge>
                    )}
                  </DevOnly>
                </div>
                <div className="flex items-center gap-1 text-xs text-foreground/50">
                  <span className="truncate">{user.email}</span>
                  {user.emailVerified ? (
                    <CheckCircle2 size={11} className="flex-shrink-0 text-primary" />
                  ) : null}
                </div>
                {(user.institution !== null || user.field !== null) && (
                  <p className="text-xs text-foreground/40 truncate">
                    {[user.institution, user.field].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            </div>

            {/* 上次登录 */}
            <p className="text-sm text-foreground/40 pt-1">
              {t('menu.lastLogin', { time: formatRelativeTime(user.lastLoginAt, locale) })}
            </p>
          </div>

          {/* 分割线 */}
          <div className="h-px bg-border/40 mx-3" />

          {/* 菜单项 */}
          <div className="p-1.5 space-y-0.5">
            <button
              type="button"
              onClick={handleAccountSettings}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-foreground/70 hover:bg-foreground/[0.04] hover:text-foreground transition-colors"
            >
              <Settings size={14} className="flex-shrink-0" />
              {t('menu.accountSettings')}
            </button>
            <button
              type="button"
              onClick={handleLogoutClick}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-foreground/70 hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              <LogOut size={14} className="flex-shrink-0" />
              {t('menu.logout')}
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <LogoutConfirmDialog open={logoutOpen} onOpenChange={setLogoutOpen} />
    </>
  )
}

export function accountMenuTriggerClassName(): string {
  return 'sidebar-account-trigger w-full flex items-center titlebar-no-drag'
}
