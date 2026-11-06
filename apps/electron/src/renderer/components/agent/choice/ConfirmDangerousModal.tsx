/**
 * ConfirmDangerousModal — dangerous 工具触发"总是允许"前的二次确认 modal。
 *
 * trap focus；Y/Enter 确认 → 调原始 onConfirm(toolKey)；N → onCancel；
 * Esc 交给 Radix Dialog 通过 onOpenChange 走，避免双重路径。
 */

import * as React from 'react'
import { useT } from '@/hooks/useT'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ConfirmDangerousModalProps {
  open: boolean
  toolName: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDangerousModal({ open, toolName, onConfirm, onCancel }: ConfirmDangerousModalProps): React.ReactElement | null {
  const { t } = useT('conversation')
  const onConfirmRef = React.useRef(onConfirm)
  const onCancelRef = React.useRef(onCancel)
  onConfirmRef.current = onConfirm
  onCancelRef.current = onCancel

  React.useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'y' || e.key === 'Y' || e.key === 'Enter') {
        e.preventDefault()
        onConfirmRef.current()
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        onCancelRef.current()
      }
      // Esc 让 Radix Dialog 通过 onOpenChange 处理，避免双重路径
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="border-destructive/60">
        <DialogHeader>
          <DialogTitle className="text-destructive">
            {t('choiceCard.dangerous.confirmTitle', { tool: toolName })}
          </DialogTitle>
          <DialogDescription>
            {t('choiceCard.dangerous.confirmBody')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>
            {t('choiceCard.dangerous.confirmNo')}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t('choiceCard.dangerous.confirmYes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
