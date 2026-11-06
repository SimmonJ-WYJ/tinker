/**
 * Bash 工具结果渲染器 — 终端风格
 *
 * 深色背景、等宽字体、stderr 红色高亮
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { CollapsibleResult } from './collapsible-result'

interface BashResultRendererProps {
  result: string
  isError: boolean
  input: Record<string, unknown>
}

/** 简单检测 stderr 行（常见模式） */
function classifyLine(line: string): 'stderr' | 'normal' {
  const lower = line.toLowerCase()
  if (
    lower.startsWith('error:') ||
    lower.startsWith('error ') ||
    lower.startsWith('fatal:') ||
    lower.startsWith('warning:') ||
    lower.includes('traceback') ||
    lower.includes('exception') ||
    lower.startsWith('stderr:')
  ) {
    return 'stderr'
  }
  return 'normal'
}

export function BashResultRenderer({ result, isError, input }: BashResultRendererProps): React.ReactElement {
  const command = typeof input.command === 'string' ? input.command : undefined

  const renderTerminal = React.useCallback((text: string): React.ReactNode => {
    const lines = text.split('\n')
    return (
      <div className={cn(
        'rounded-md text-sm leading-relaxed overflow-x-auto',
        'bg-code-container-bg text-code-container-fg',
        'p-3',
      )}>
        {/* 命令回显 */}
        {command && (
          <div className="text-code-container-muted mb-2 select-none">
            {/* eslint-disable-next-line asci/no-tailwind-palette -- 终端 prompt $ 符号绿，沿用 shell brand 惯例 */}
            <span className="text-green-400">$</span> {command}
          </div>
        )}
        {/* 输出行 */}
        {lines.map((line, i) => {
          const type = isError ? 'stderr' : classifyLine(line)
          return (
            <div
              key={i}
              className={cn(
                'whitespace-pre-wrap break-all min-h-[1.25em]',
                type === 'stderr' && 'text-destructive',
              )}
            >
              {line || '\u200B'}
            </div>
          )
        })}
      </div>
    )
  }, [command, isError])

  return (
    <CollapsibleResult
      content={result}
      renderContent={renderTerminal}
    />
  )
}
