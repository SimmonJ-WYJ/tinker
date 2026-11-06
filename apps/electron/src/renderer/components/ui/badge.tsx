import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// 标签族唯一入口：tone（语义色）× variant（形态）双轴。
// soft 底色统一 /10；solid 用实色底+反白字；outline 用描边+语义字色。
// 详见 docs/design.md §8.4 与 docs/specs/tag-badge-semantic-spec.md。
const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2.5 py-0.5 text-badge font-normal transition-colors focus:outline-none",
  {
    variants: {
      tone: {
        neutral: "",
        primary: "",
        info: "",
        success: "",
        warning: "",
        destructive: "",
      },
      variant: {
        soft: "",
        solid: "",
        outline: "border",
      },
    },
    compoundVariants: [
      { tone: "neutral", variant: "soft", class: "bg-muted text-muted-foreground" },
      { tone: "primary", variant: "soft", class: "bg-primary/10 text-primary" },
      { tone: "info", variant: "soft", class: "bg-info/10 text-info" },
      { tone: "success", variant: "soft", class: "bg-success/10 text-success" },
      { tone: "warning", variant: "soft", class: "bg-warning/10 text-warning" },
      { tone: "destructive", variant: "soft", class: "bg-destructive/10 text-destructive" },
      { tone: "neutral", variant: "solid", class: "bg-muted text-foreground" },
      { tone: "primary", variant: "solid", class: "bg-primary text-primary-foreground" },
      { tone: "info", variant: "solid", class: "bg-info text-info-foreground" },
      { tone: "success", variant: "solid", class: "bg-success text-success-foreground" },
      { tone: "warning", variant: "solid", class: "bg-warning text-warning-foreground" },
      { tone: "destructive", variant: "solid", class: "bg-destructive text-destructive-foreground" },
      { tone: "neutral", variant: "outline", class: "border-border text-muted-foreground" },
      { tone: "primary", variant: "outline", class: "border-primary text-primary" },
      { tone: "info", variant: "outline", class: "border-info text-info" },
      { tone: "success", variant: "outline", class: "border-success text-success" },
      { tone: "warning", variant: "outline", class: "border-warning text-warning" },
      { tone: "destructive", variant: "outline", class: "border-destructive text-destructive" },
    ],
    defaultVariants: {
      tone: "neutral",
      variant: "soft",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, tone, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ tone, variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
