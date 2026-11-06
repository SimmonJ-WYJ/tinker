/**
 * Edit 工具结果渲染器 — Diff 视图
 *
 * 显示 old_string → new_string 的差异，
 * 删除行红色背景，新增行绿色背景
 */

import * as React from 'react'
import { isHtmlArtifact } from './artifact-source-policy'
import { useT } from '@/hooks/useT'
import { cn } from '@/lib/utils'
import { FileActionRow } from './write-result'

interface EditResultRendererProps {
  result: string
  isError: boolean
  input: Record<string, unknown>
  /** 会话 cwd，用于把相对 file_path 解析为可打开的绝对路径 */
  basePath?: string
}

export function EditResultRenderer({ result, isError, input, basePath }: EditResultRendererProps): React.ReactElement {
  const { t } = useT('conversation')
  const oldStr = typeof input.old_string === 'string' ? input.old_string : ''
  const newStr = typeof input.new_string === 'string' ? input.new_string : ''
  const filePath = typeof input.file_path === 'string' ? input.file_path : ''

  if (isError) {
    return (
      <pre className="rounded-md p-3 text-sm text-destructive/80 bg-destructive/5 whitespace-pre-wrap break-all overflow-x-auto">
        {result}
      </pre>
    )
  }

  const fileActions = filePath ? (
    <FileActionRow filePath={filePath} basePath={basePath} label={t('agent.toolResult.editedFileLabel')} />
  ) : null

  // 任意 .html / .htm 产物：右栏 HtmlRenderer 兜底预览，对话流里不灌 diff 源码，
  // 仅保留文件操作行 —— 与 WriteResultRenderer 一致。
  // 无 diff 数据时显示成功消息
  if ((!oldStr && !newStr) || isHtmlArtifact(filePath)) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        {fileActions}
        <div>{result || t('agent.toolResult.editSuccess')}</div>
      </div>
    )
  }

  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')

  return (
    <div className="space-y-2">
      {fileActions}
      <div className="rounded-md text-sm leading-relaxed overflow-x-auto bg-code-container-bg">
        {/* 删除行 */}
        {oldLines.length > 0 && oldStr && (
          <div>
            {oldLines.map((line, i) => (
              <div
                key={`del-${i}`}
                className="flex bg-diff-del-bg"
              >
                <span className="shrink-0 w-10 text-right pr-3 select-none text-diff-del-fg text-sm">
                  -
                </span>
                <span className={cn('flex-1 whitespace-pre-wrap break-all text-diff-del-text')}>
                  {line || '​'}
                </span>
              </div>
            ))}
          </div>
        )}
        {/* 新增行 */}
        {newLines.length > 0 && newStr && (
          <div>
            {newLines.map((line, i) => (
              <div
                key={`add-${i}`}
                className="flex bg-diff-add-bg"
              >
                <span className="shrink-0 w-10 text-right pr-3 select-none text-diff-add-fg text-sm">
                  +
                </span>
                <span className={cn('flex-1 whitespace-pre-wrap break-all text-diff-add-text')}>
                  {line || '​'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
