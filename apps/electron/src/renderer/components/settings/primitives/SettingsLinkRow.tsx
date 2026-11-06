/**
 * SettingsLinkRow - 跨 section 跳转行
 *
 * 用于一个 section 内放置"去到另一个 settings tab"的入口（如 Agent 内置 MCP 行
 * 提示去 Zotero 设置开关 OCR/ASR）。点击：
 *   1. 切到目标 tab（顺带写 settingsLastTabAtom）
 *   2. 不关闭设置弹窗
 *
 * 视觉：SettingsRow 风格 + 右侧 chevron-right；整行 hover 高亮、可点。
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { settingsTabAtom } from '@/atoms/settings-tab'
import type { SettingsTab } from '@/atoms/settings-tab'
import { settingsLastTabAtom } from '@/atoms/settings-last-tab'
import { LABEL_CLASS, DESCRIPTION_CLASS, ROW_CLASS } from './SettingsUIConstants'

export interface SettingsLinkRowProps {
  /** 标签左侧图标（可选） */
  icon?: React.ReactNode
  /** 标签文案 */
  label: string
  /** 描述文案（可选） */
  description?: string
  /** 点击跳转到的设置 tab */
  targetTab: SettingsTab
  /** chevron 之前的右侧内容（如状态徽章），点击不冒泡到外层导航 */
  children?: React.ReactNode
  /** 额外 className */
  className?: string
}

export function SettingsLinkRow({
  icon,
  label,
  description,
  targetTab,
  children,
  className,
}: SettingsLinkRowProps): React.ReactElement {
  const setTab = useSetAtom(settingsTabAtom)
  const setLastTab = useSetAtom(settingsLastTabAtom)

  const handleClick = (): void => {
    setTab(targetTab)
    setLastTab(targetTab)
  }

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={handleClick}
      className={cn(
        ROW_CLASS,
        'h-auto w-full justify-between rounded-none text-left font-normal hover:bg-muted/50',
        className,
      )}
    >
      {icon && <div className="flex-shrink-0 mr-3">{icon}</div>}
      <div className="flex-1 min-w-0 mr-4">
        <div className={LABEL_CLASS}>{label}</div>
        {description && (
          <div className={cn(DESCRIPTION_CLASS, 'mt-0.5')}>{description}</div>
        )}
      </div>
      {children && (
        <div
          className="flex-shrink-0 mr-2"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      )}
      <div className="flex-shrink-0 text-muted-foreground">
        <ChevronRight size={16} />
      </div>
    </Button>
  )
}
