// apps/electron/src/renderer/components/auth/DeleteAccountDialog.tsx
/**
 * DeleteAccountDialog — 删除账户二次确认对话框（DO-3，issue #428）
 *
 * GDPR 被遗忘权：清服务端身份 + 行为遥测，本地研究库保留在本设备。
 * 不可逆操作 → 影响说明 bullet + 显式勾选 acknowledge 才放开删除按钮。
 * 成功后 atom 更新由 GlobalListeners 的 account-deleted 事件驱动；失败 toast 报错。
 */

import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
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
import { Checkbox } from '@/components/ui/checkbox.tsx'

export interface DeleteAccountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteAccountDialog({ open, onOpenChange }: DeleteAccountDialogProps): React.ReactElement {
  const { t } = useT('auth')
  const [acknowledged, setAcknowledged] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  // 每次打开重置勾选态，避免上次的确认残留
  React.useEffect(() => {
    if (open) setAcknowledged(false)
  }, [open])

  const handleDelete = async (): Promise<void> => {
    setDeleting(true)
    try {
      const r = await window.electronAPI.auth.deleteAccount()
      if (!r.ok) {
        toast.error(t('profile.deleteConfirm.error'))
        return
      }
      // 成功：atom 由 GlobalListeners 的 account-deleted 处理；关闭对话框
      onOpenChange(false)
    } finally {
      setDeleting(false)
    }
  }

  const impactItems = [
    t('profile.deleteConfirm.impactServerData'),
    t('profile.deleteConfirm.impactLocalKept'),
    t('profile.deleteConfirm.impactLogout'),
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle size={18} />
            {t('profile.deleteConfirm.title')}
          </DialogTitle>
          <DialogDescription>{t('profile.deleteConfirm.description')}</DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 rounded-md bg-destructive/5 p-3 text-sm text-foreground/80">
          {impactItems.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="text-destructive">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <label className="flex items-start gap-2 text-sm text-foreground/80 cursor-pointer">
          <Checkbox
            checked={acknowledged}
            onCheckedChange={(checked) => setAcknowledged(checked === true)}
            className="mt-0.5"
            disabled={deleting}
          />
          <span>{t('profile.deleteConfirm.acknowledge')}</span>
        </label>

        <DialogFooter className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            {t('profile.deleteConfirm.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleDelete()}
            disabled={!acknowledged || deleting}
          >
            {deleting ? t('profile.deleteConfirm.deleting') : t('profile.deleteConfirm.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
