import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "bg-muted text-foreground hover:bg-muted/70",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // 文本/展开折叠类轻按钮：无背景，muted→foreground hover
        subtle: "text-muted-foreground hover:text-foreground hover:bg-transparent",
        // 列表/菜单行配色（选中态由调用方的条件 className 承载）
        list: "text-foreground hover:bg-accent hover:text-accent-foreground",
        // 胶囊/chip 未选中态基底（选中态由调用方条件 className 承载）
        chip: "bg-muted text-foreground/70 hover:bg-muted/80",
        // 图片上的悬浮覆盖按钮（黑底覆盖非调色板色，无需 eslint-disable）
        overlay: "bg-black/50 text-white backdrop-blur-sm hover:bg-black/70",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-9 px-3 text-xs",
        lg: "h-10 px-8",
        icon: "h-9 w-9",
        "icon-sm": "h-7 w-7",
        // 20px 方形图标按钮
        "icon-xs": "size-5",
        // 16px 最小图标/反白按钮
        "icon-2xs": "size-4",
        // 全宽左对齐列表/菜单行（覆盖 justify-center → start，去固定高度）
        row: "h-auto w-full justify-start gap-2 px-3 py-2 text-left text-sm font-normal",
        // 胶囊行内 chip
        chip: "h-auto rounded-md px-2 py-0.5 text-badge font-normal",
        // 零盒模型行内文本按钮
        inline: "h-auto p-0 text-sm font-normal",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
