// apps/electron/src/renderer/components/auth/ConflictWarning.tsx
/**
 * ConflictWarning — 登录后检测到本地数据归属冲突时弹出的对话框，spec §八 8.5
 *
 * 当 localData.attributedTo !== null && 登录用户的 uid !== attributedTo 时，
 * 由 LoginPage 在登录成功后弹出此对话框。
 *
 * 3 个选项：
 *   1. 继续登录（数据留在磁盘，可能无法关联此账户）
 *   2. 导出数据并清空（0.3 stub，后续 PR 实现）
 *   3. 取消（调用 logout）
 */

import * as React from 'react'
import { toast } from 'sonner'
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

type ConflictChoice = 'continue' | 'export-and-clear' | 'cancel'

export interface ConflictWarningProps {
  /** 已归属的原始 uid */
  attributedTo: string
  onContinueLoggedIn: () => void
  onExportAndClear: () => void
  onCancel: () => void
}

export function ConflictWarning({
  attributedTo,
  onContinueLoggedIn,
  onExportAndClear,
  onCancel,
}: ConflictWarningProps): React.ReactElement {
  const { t } = useT('auth')
  const [selected, setSelected] = React.useState<ConflictChoice>('continue')
  const [confirming, setConfirming] = React.useState(false)

  const handleConfirm = async (): Promise<void> => {
    setConfirming(true)
    if (selected === 'continue') {
      onContinueLoggedIn()
    } else if (selected === 'export-and-clear') {
      // 0.3 stub：导出后续 PR 实现
      await window.electronAPI.auth.scanLocalData()
      toast.info(t('conflict.exportNotImplemented'))
      onExportAndClear()
    } else {
      await window.electronAPI.auth.logout()
      onCancel()
    }
    setConfirming(false)
  }

  return (
    <Dialog open>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('conflict.title')}</DialogTitle>
          <DialogDescription>
            {t('conflict.description', { uid: attributedTo })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {(
            [
              { value: 'continue', label: t('conflict.options.continueLoggedIn') },
              { value: 'export-and-clear', label: t('conflict.options.exportAndClear') },
              { value: 'cancel', label: t('conflict.options.cancel') },
            ] satisfies Array<{ value: ConflictChoice; label: string }>
          ).map(({ value, label }) => (
            <label
              key={value}
              className="flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:bg-muted/40 transition-colors"
            >
              <input
                type="radio"
                name="conflict-choice"
                value={value}
                checked={selected === value}
                onChange={() => setSelected(value)}
                className="mt-0.5 accent-primary"
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>

        <DialogFooter>
          <Button
            onClick={() => void handleConfirm()}
            disabled={confirming}
          >
            {confirming ? t('common.loading') : t('conflict.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
