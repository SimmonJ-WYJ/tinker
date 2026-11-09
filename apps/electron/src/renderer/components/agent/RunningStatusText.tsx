import * as React from 'react'
import { cn } from '@/lib/utils'
import './running-status-text.css'

interface Props extends Omit<React.ComponentPropsWithoutRef<'span'>, 'children'> {
  active: boolean
  children: string
}

/** 保留单份原生文本，只按宿主真实运行状态启停视觉高光。 */
export function RunningStatusText({ active, className, children, ...props }: Props): React.ReactElement {
  return <span {...props} className={cn('agent-status-text', className)} data-active={active ? 'true' : undefined}>{children}</span>
}
