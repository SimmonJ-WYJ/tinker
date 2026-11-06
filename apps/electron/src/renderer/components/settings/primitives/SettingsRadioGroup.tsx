/**
 * SettingsRadioGroup - 设置项单选组
 *
 * 用于设置面板中"多个互斥选项"场景（如代理模式：系统/手动）。每个选项一行：
 * - 左侧 radio circle（自绘，不用 input[type=radio] 避免浏览器默认样式失控）
 * - 中部 label + 可选图标 + 可选描述
 * - children 区域：仅在该选项被选中时展示，用于挂载该选项的配置控件（如输入框、检测按钮）
 *
 * 选中行 bg-accent/10 高亮；hover 行 hover:bg-muted/50；行之间自带 border-b 分隔线。
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export interface SettingsRadioGroupOption<T extends string> {
  value: T
  label: string
  description?: string
  /** 标签左侧图标（可选） */
  icon?: React.ReactNode
  /** 选中时在描述下方展示的额外内容（如配置项、提示） */
  children?: React.ReactNode
}

export interface SettingsRadioGroupProps<T extends string> {
  value: T
  onValueChange: (value: T) => void
  options: SettingsRadioGroupOption<T>[]
  /** 整组额外 className */
  className?: string
}

export function SettingsRadioGroup<T extends string>({
  value,
  onValueChange,
  options,
  className,
}: SettingsRadioGroupProps<T>): React.ReactElement {
  return (
    <div className={cn('flex flex-col', className)}>
      {options.map((option, idx) => {
        const selected = option.value === value
        const showDivider = idx < options.length - 1
        return (
          <React.Fragment key={option.value}>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onValueChange(option.value)}
              className={cn(
                'group h-auto w-full flex-col items-stretch justify-start rounded-none px-4 py-3 text-left font-normal',
                selected ? 'bg-accent/10 hover:bg-accent/10' : 'hover:bg-muted/50',
              )}
            >
              <div className="flex items-start gap-3">
                <RadioCircle selected={selected} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground flex items-center gap-2">
                    {option.icon}
                    <span>{option.label}</span>
                  </div>
                  {option.description && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {option.description}
                    </p>
                  )}
                  {/* 子内容里的图标尺寸由各自控件自管：抵消外层 Button 基类的 [&_svg]:size-4 强制 */}
                  {selected && option.children && (
                    <div className="mt-3 [&_svg]:!size-3" onClick={(e) => e.stopPropagation()}>
                      {option.children}
                    </div>
                  )}
                </div>
              </div>
            </Button>
            {showDivider && <div className="border-b border-border/50" />}
          </React.Fragment>
        )
      })}
    </div>
  )
}

/** 自绘 radio 圆点：选中时填充主色环 + 内圆 */
function RadioCircle({ selected }: { selected: boolean }): React.ReactElement {
  return (
    <div
      className={cn(
        'flex-shrink-0 mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors',
        selected ? 'border-foreground' : 'border-muted-foreground/40 group-hover:border-muted-foreground/70',
      )}
    >
      {selected && <div className="w-2 h-2 rounded-full bg-foreground" />}
    </div>
  )
}
