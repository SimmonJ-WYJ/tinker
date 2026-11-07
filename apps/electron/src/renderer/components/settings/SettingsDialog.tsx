import { RESEARCH_UI_ENABLED } from '@/lib/product-surface'
/**
 * SettingsDialog - 设置浮窗
 *
 * 以 Dialog 浮窗形式展示设置面板，不覆盖主内容区。
 * 使用低级 Dialog 原语实现轻遮罩 + 无默认关闭按钮（关闭按钮由 SettingsPanel 内部提供）。
 *
 * Last-tab 恢复：打开时若 settingsTabAtom === null（未被外部 setter 显式设过），
 * 从 settingsLastTabAtom 恢复；关闭时把 settingsTabAtom 重置为 null，保证下次打开
 * 重新走恢复路径。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { settingsOpenAtom, settingsTabAtom, coerceSettingsTab } from '@/atoms/settings-tab'
import { settingsLastTabAtom } from '@/atoms/settings-last-tab'
import { spotlightActiveAtom } from '@/atoms/onboarding-spotlight-atoms'
import { SettingsPanel } from './SettingsPanel'
import { useT } from '@/hooks/useT'

export function SettingsDialog(): React.ReactElement {
  const { t } = useT('settings')
  const [open, setOpen] = useAtom(settingsOpenAtom)
  const [tab, setTab] = useAtom(settingsTabAtom)
  const lastTab = useAtomValue(settingsLastTabAtom)
  const spotlightActive = useAtomValue(spotlightActiveAtom)

  /**
   * open 变化时联动 tab：
   * - 打开时（open === true）若外部 setter 没有显式设过 tab（仍为 null），从 lastTab 恢复
   * - 关闭时（open === false）重置 tab 为 null，下次打开重新走恢复
   *
   * 用 useEffect 而非 onOpenChange，是因为外部直接 setSettingsOpen(true) 时
   * Radix 不会触发 onOpenChange，必须靠副作用感知 open 变化。
   * 故意只依赖 open；tab / lastTab 变化不应重新触发恢复。
   */
  React.useEffect(() => {
    if (open) {
      // 收敛旧 localStorage 残留的已删 tab（如 0.2 的 'agent'/'config'），避免渲染空白
      if (tab === null) {
        const previousTab = coerceSettingsTab(lastTab)
        setTab(!RESEARCH_UI_ENABLED && previousTab === 'zotero' ? 'mcp' : previousTab)
      }
    } else {
      setTab(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Spotlight 引导期间，点击 spotlight 蒙版/气泡（脱离 Dialog Content 的 fixed 元素）
  // 会被 Radix Dialog 判定为"点击外部"误关弹窗。在引导中禁用此行为。
  const block = (e: { preventDefault: () => void }): void => {
    if (spotlightActive) e.preventDefault()
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        {/* 轻遮罩 */}
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[100] bg-black/20 titlebar-no-drag transition-opacity duration-100 data-[state=open]:opacity-100 data-[state=closed]:opacity-0"
        />
        <DialogPrimitive.Content
          onPointerDownOutside={block}
          onInteractOutside={block}
          onEscapeKeyDown={block}
          aria-describedby={undefined}
          className="fixed left-[50%] top-[50%] z-[100] translate-x-[-50%] translate-y-[-50%] w-[85vw] max-w-[992px] h-[85vh] max-h-[752px] bg-dialog text-dialog-foreground shadow-2xl rounded-xl overflow-hidden transition-all duration-100 data-[state=open]:opacity-100 data-[state=open]:scale-100 data-[state=closed]:opacity-0 data-[state=closed]:scale-[0.98]"
        >
          <DialogPrimitive.Title className="sr-only">{t('dialog.title')}</DialogPrimitive.Title>
          <SettingsPanel onClose={() => setOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
