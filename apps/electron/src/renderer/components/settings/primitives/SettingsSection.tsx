/**
 * SettingsSection - 设置区块容器
 *
 * 提供区块标题、描述和可选的操作按钮插槽。
 * 用于将相关的设置项分组显示。
 */

import * as React from 'react'
import { SettingsSectionHeader } from './SettingsSectionHeader'

interface SettingsSectionProps {
  /** 区块标题 */
  title: React.ReactNode
  /** 区块描述（可选） */
  description?: string
  /** 右侧操作按钮插槽（可选） */
  action?: React.ReactNode
  /** 子内容 */
  children: React.ReactNode
}

export function SettingsSection({
  title,
  description,
  action,
  children,
}: SettingsSectionProps): React.ReactElement {
  return (
    <div className="space-y-3">
      {/* 区块头部 */}
      <SettingsSectionHeader title={title} description={description} action={action} />
      {/* 区块内容 */}
      {children}
    </div>
  )
}
