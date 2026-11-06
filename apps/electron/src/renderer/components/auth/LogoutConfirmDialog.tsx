// apps/electron/src/renderer/components/auth/LogoutConfirmDialog.tsx
/**
 * LogoutConfirmDialog — 退出登录确认对话框
 *
 * Atom 更新由 GlobalListeners 的 STATE_CHANGED logout 事件驱动，
 * 此组件只负责调用 logout IPC + 关闭自身。
 */

import * as React from 'react'
import { useT } from '@/hooks/useT.ts'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog.tsx'
import { Button } from '@/components/ui/button.tsx'

export interface LogoutConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LogoutConfirmDialog({ open, onOpenChange }: LogoutConfirmDialogProps): React.ReactElement {
  const { t } = useT('auth')
  const [loggingOut, setLoggingOut] = React.useState(false)

  const handleLogout = async (): Promise<void> => {
    setLoggingOut(true)
    await window.electronAPI.auth.logout()
    // atom 更新由 GlobalListeners 处理；关闭对话框
    onOpenChange(false)
    setLoggingOut(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('menu.logoutConfirm.title')}</DialogTitle>
          <DialogDescription>{t('menu.logoutConfirm.description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex gap-2 justify-end">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loggingOut}
          >
            {t('menu.logoutConfirm.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
          >
            {loggingOut ? t('common.loading') : t('menu.logoutConfirm.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
