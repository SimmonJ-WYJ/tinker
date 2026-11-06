/**
 * FlowRow — 对话流执行记录行的统一行头布局
 *
 * 所有执行记录行（执行步骤组 / 思考 / 提示词 / 工具调用）共用同一套横向布局，保证
 * 左侧图标与文字左边缘对齐、右侧展开箭头列对齐：
 *
 *   [单图标(固定槽)]  [内容 flex-1 左对齐截断]  [行尾槽：箭头 / 等宽占位]
 *
 * - 左侧只放一个图标（状态 or 类型，二选一，由调用方决定并自带配色）。
 * - 内容区 flex-1，但整行按内容宽度收缩，避免箭头在宽屏上漂到最右。
 * - 可展开行：行尾显示箭头（展开 rotate-90 朝下，收起朝右），整行点击切换。
 * - 不可展开行：行尾留等宽空占位（保持右列对齐），整行不可点击、无 hover。
 *
 * 颜色（dimmed / 失败红等）由调用方在传入的 icon / children 上决定，本组件只管布局。
 */
import * as React from 'react'
import { ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface FlowRowProps {
  /** 单个前置图标（调用方自带尺寸/配色，约定 size-3.5）；传 null/undefined 时整个 icon 槽不渲染 */
  icon?: React.ReactNode
  /** 行内容：名称 / 文字等，左对齐 */
  children: React.ReactNode
  /** 是否可展开（决定行尾显示箭头还是占位、整行是否可点击） */
  expandable?: boolean
  /** 当前是否展开（控制箭头朝向） */
  expanded?: boolean
  /** 点击切换展开（仅 expandable 时生效） */
  onToggle?: () => void
  /**
   * 卡片头模式：行铺满父卡片、不自带灰胶囊底（消除「盒中盒」）。
   * 父卡片本身已是成组容器与悬停面，故 flush 头只保留全宽点击 + 轻微 hover 反馈。
   */
  flush?: boolean
  /**
   * 左缘对齐模式（仅非 flush 胶囊生效）：用 -ml-2 抵消胶囊自身的 px-2 左内边距，
   * 让胶囊里的文字与同级正文左缘对齐（胶囊底色顺势探入 8px 外槽，落在消息容器 padding 内）。
   */
  edgeAlign?: boolean
}

export function FlowRow({
  icon,
  children,
  expandable = false,
  expanded = false,
  onToggle,
  flush = false,
  edgeAlign = false,
}: FlowRowProps): React.ReactElement {
  const inner = (
    <>
      {icon != null && (
        <span className="shrink-0 flex items-center [&_svg]:size-3.5">{icon}</span>
      )}
      <span className="flex min-w-0 flex-1 items-center gap-2 text-left">{children}</span>
      <span className="flex w-3 shrink-0 items-center justify-center">
        {expandable && (
          <ChevronRight
            className={cn(
              '!size-3 text-muted-foreground/55 transition-transform duration-150 group-hover:text-foreground/70',
              expanded && 'rotate-90',
            )}
          />
        )}
      </span>
    </>
  )

  if (expandable) {
    return (
      <Button
        type="button"
        variant="subtle"
        size="inline"
        className={cn(
          'group justify-start gap-2 text-left text-sm font-normal transition-colors hover:[&_span]:text-foreground/85',
          flush
            // 卡片头：铺满卡片、无自带底色，仅轻微 hover 反馈（-my 抵消 py 不撑高卡片）。
            // flex 覆盖 Button 基类的 inline-flex：inline 级会按基线对齐 + 留行内行盒间隙，
            // 导致圆点/文字整体偏上；block 级 flex 才能让内容在卡片内垂直居中。
            ? 'flex w-full rounded-md py-0 hover:bg-muted/20'
            // 独立胶囊：内容宽度浅灰底让可展开块明确成组，箭头贴近文案
            : cn(
                'max-w-full rounded-lg bg-muted-foreground/8 px-2 py-1 hover:bg-muted-foreground/14',
                edgeAlign && '-ml-2', // 抵消 px-2，文字回到内容左缘
              ),
        )}
        onClick={onToggle}
      >
        {inner}
      </Button>
    )
  }

  // 不可展开：纯布局 div，复用与 size="row" 一致的横向规则，但不可点击、无 hover
  return (
    <div className="flex w-full items-center gap-2 px-0 py-0.5 text-sm text-left">{inner}</div>
  )
}
