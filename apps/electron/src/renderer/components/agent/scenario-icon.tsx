/**
 * scenario-icon — scenario speaker 名 → lucide icon 的轻量映射
 *
 * 设计：仅给"语义明确"的 scenario 名加图标（如 search/searcher → 放大镜，score/scorer → 仪表盘，lit-review → 书本）；
 * 其他 scenario 走纯文字以保持简约风。命中规则用 RegExp，方便扩展。
 */
import * as React from 'react'
import { BookOpen, Gauge, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ScenarioIconProps {
  className?: string
}

/** 返回该 scenario 对应的 React icon 节点；无匹配返回 null（调用方据此决定是否渲染 icon 槽） */
export function getScenarioIcon(
  name: string,
  props?: ScenarioIconProps,
): React.ReactElement | null {
  const baseClass = 'size-3.5 shrink-0'
  if (/search/i.test(name)) {
    return <Search className={cn(baseClass, props?.className)} />
  }
  if (/scor/i.test(name)) {
    return <Gauge className={cn(baseClass, props?.className)} />
  }
  if (/(lit|review)/i.test(name)) {
    return <BookOpen className={cn(baseClass, props?.className)} />
  }
  return null
}
