/**
 * Write 工具结果渲染器 — 内容视图
 */

import * as React from 'react'
import { ExternalLink, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FilePathChip, resolveFilePath } from '@/components/ai-elements/file-path-chip'
import { isHtmlArtifact } from './artifact-source-policy'
import { useT } from '@/hooks/useT'
import { CollapsibleResult } from './collapsible-result'

interface WriteResultRendererProps {
  result: string
  isError: boolean
  input: Record<string, unknown>
  /** 会话 cwd，用于把相对 file_path 解析为可打开的绝对路径 */
  basePath?: string
}

export function WriteResultRenderer({ result, isError, input, basePath }: WriteResultRendererProps): React.ReactElement {
  const { t } = useT('conversation')
  const filePath = typeof input.file_path === 'string' ? input.file_path : ''
  const content = typeof input.content === 'string' ? input.content : ''

  // 文件已不在磁盘上（如 Agent 写临时脚本跑完即删，#704 同源）：
  // 文件操作行（芯片 + 打开 + 在文件夹中显示）指向已不存在的文件，点开必失败 ——
  // 故隐藏操作行，只保留内联源码（CollapsibleResult），让用户仍能回看写了什么。
  // hook 必须无条件调用，放在所有 early return 之前。
  const fileGone = useFileGone(filePath, basePath)

  if (isError) {
    return (
      <pre className="rounded-md p-3 text-sm text-destructive/80 bg-destructive/5 whitespace-pre-wrap break-all overflow-x-auto">
        {result}
      </pre>
    )
  }

  const fileActions = filePath && !fileGone ? (
    <FileActionRow filePath={filePath} basePath={basePath} label={t('agent.toolResult.wroteFileLabel')} />
  ) : null

  // 任意 .html / .htm 产物：源码可经芯片打开、右栏 HtmlRenderer 兜底渲染，
  // 对话流里再灌几百行 HTML 源码纯属噪声 —— 只保留文件操作行（芯片 + 打开 + 在文件夹中显示）。
  // 文件已删时 isHtmlArtifact 分支也无操作行可留，落到下方源码兜底。
  if ((!content || isHtmlArtifact(filePath)) && !fileGone) {
    return (
      <div className="text-sm text-muted-foreground">
        {fileActions}
      </div>
    )
  }

  // 折叠态（触发折叠卡 + 「Show all」）时源码套在带边框的卡里，需 pl-4 让文字离开边框；
  // 非折叠态直接平铺，左 padding 归零与工具卡内容左缘对齐。
  // collapsed 由 CollapsibleResult 透出（其权威折叠判定），避免在此重算 content.length>threshold。
  const renderPreview = (text: string, { collapsed }: { collapsed: boolean }): React.ReactNode => (
    <pre className={cn(
      'scrollbar-thin max-h-[24rem] overflow-auto whitespace-pre-wrap break-words bg-transparent pr-4 py-3 text-sm leading-[1.75] text-foreground/80',
      collapsed ? 'pl-4' : 'pl-0',
    )}>
      {text}
    </pre>
  )

  return (
    <div className="space-y-2">
      {fileActions}
      <CollapsibleResult
        content={content}
        threshold={1400}
        previewLines={10}
        renderContent={renderPreview}
      />
    </div>
  )
}

/**
 * 检测 Write 产物文件是否已不在磁盘上（如 Agent 临时脚本跑完即删）。
 * 复用 previewReadText 的 notFound 信号；传 maxBytes=0 让主进程走 stat-only 探测，
 * 不读文件内容（避免每张 Write 卡片整文件 readFile 的浪费）。filePath 为空时返回 false。
 */
function useFileGone(filePath: string, basePath?: string): boolean {
  const [gone, setGone] = React.useState(false)
  const fullPath = React.useMemo(
    () => (filePath ? resolveFilePath(filePath, basePath) : ''),
    [filePath, basePath],
  )
  React.useEffect(() => {
    if (!fullPath || !window.electronAPI?.previewReadText) return
    let cancelled = false
    window.electronAPI
      .previewReadText(fullPath, 0)
      .then((res) => { if (!cancelled) setGone(Boolean(res.notFound)) })
      .catch(() => { /* 读失败按存在处理，不误隐藏 */ })
    return () => { cancelled = true }
  }, [fullPath])
  return gone
}

/** Write/Edit 工具结果共享的文件操作行：芯片 + 打开 + 在文件夹中显示 */
export function FileActionRow({ filePath, basePath, label }: { filePath: string; basePath?: string; label: string }): React.ReactElement {
  const { t } = useT('conversation')
  const fullPath = React.useMemo(() => resolveFilePath(filePath, basePath), [filePath, basePath])

  const handleOpen = React.useCallback(() => {
    window.electronAPI.openFile(fullPath).catch((error: unknown) => {
      console.error('[FileActionRow] 打开文件失败:', error)
    })
  }, [fullPath])

  const handleReveal = React.useCallback(() => {
    window.electronAPI.showInFolder(fullPath).catch((error: unknown) => {
      console.error('[FileActionRow] 在文件夹中显示失败:', error)
    })
  }, [fullPath])

  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground flex-wrap">
      <span>{label}</span>
      <FilePathChip filePath={filePath} basePath={basePath} />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleOpen}
          >
            <ExternalLink className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{t('agent.toolResult.openWithSystem')}</p>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleReveal}
          >
            <FolderOpen className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{t('agent.toolResult.revealInFolder')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
