/**
 * SettingsInput - 设置文本输入控件
 *
 * 封装 ShadcnUI Input，集成标签和描述。
 * 支持错误状态提示。
 */

import * as React from 'react'
import { Input } from '@/components/ui/input'
import { LABEL_CLASS, DESCRIPTION_CLASS } from './SettingsUIConstants'
import { cn } from '@/lib/utils'

interface SettingsInputProps {
  /** 标签文本 */
  label: string
  className?: string
  /** 描述文本（可选） */
  description?: string
  descriptionAfterInput?: boolean
  /** 输入值 */
  value: string
  /** 变更回调 */
  onChange: (value: string) => void
  /** 失焦回调（可选，用于延迟保存场景） */
  onBlur?: () => void
  /** 占位符 */
  placeholder?: string
  /** 是否必填 */
  required?: boolean
  /** 是否禁用 */
  disabled?: boolean
  /** 错误信息（可选，destructive 红） */
  error?: string
  /**
   * 提示信息（可选，amber 警示色）
   * 用于"必填未填"等引导性提示 —— 区别于 error 的"已出错"语义
   */
  warning?: string
  /** 输入类型 */
  type?: string
}

export function SettingsInput({
  label,
  className,
  description,
  descriptionAfterInput = false,
  value,
  onChange,
  onBlur,
  placeholder,
  required,
  disabled,
  error,
  warning,
  type = 'text',
}: SettingsInputProps): React.ReactElement {
  const id = React.useId()
  return (
    <div className={cn('px-4 py-3 space-y-2', className)}>
      <div>
        <label htmlFor={id} className={LABEL_CLASS}>
          {label}
          {required && <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>}
        </label>
        {description && !descriptionAfterInput && (
          <div id={`${id}-description`} className={cn(DESCRIPTION_CLASS, 'mt-0.5')}>{description}</div>
        )}
      </div>
      <Input
        id={id}
        aria-describedby={description ? `${id}-description` : undefined}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className={cn(error && 'border-destructive')}
      />
      {description && descriptionAfterInput && (
        <p id={`${id}-description`} className={cn(DESCRIPTION_CLASS, 'break-all')}>{description}</p>
      )}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : warning ? (
        <p className="text-xs text-warning">{warning}</p>
      ) : null}
    </div>
  )
}
