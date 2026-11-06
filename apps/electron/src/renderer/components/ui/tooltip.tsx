/**
 * Tooltip 工具提示组件
 *
 * 基于 Radix UI Tooltip 原语，
 * 用于鼠标悬停时显示额外信息。
 */

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"
import { floatingSurfaceClassNames } from "./floating-surface.ts"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

// Tooltip 属于辅助文字，独立于全局正文最小字阶。
export function tooltipContentClassNames(className?: string): string {
  return cn(
    floatingSurfaceClassNames({
      // eslint-disable-next-line asci/min-font-size -- 用户确认的 12px 辅助提示字阶
      className: "z-[100] overflow-hidden px-2 py-1 text-[12px] leading-4 font-normal tracking-normal shadow-sm",
    }),
    "animate-in fade-in-0 zoom-in-95",
    "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
    "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
    className
  )
}

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={tooltipContentClassNames(className)}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
