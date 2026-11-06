/**
 * ArtifactCard — Agent 产物卡片（Codex 风）
 *
 * 在「引用了 cwd 根产物文件」的 assistant 消息末尾渲染（见 MessageResponse）：
 *   类型图标 + 有意义的标题（读文档首个 # / frontmatter title，回退文件名）+ 类型标签
 *   + 右侧「打开」主操作（下拉选打开方式：应用内右栏 / 系统程序 / Finder）。
 * 让交付物成为一等内容，取代「请在下条消息 @ 这个文件」式文字指令。
 */
import * as React from 'react'
import { FileImage, FileType, ChevronDown, PanelRight, ExternalLink, FolderOpen } from 'lucide-react'
import { CodeFileIcon, WebIcon, TextFileIcon } from './result-card-icons'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useOpenInRightPanel } from '@/hooks/useOpenInRightPanel'
import { extOf, deliverableTypeKey, extractTitleFromMarkdown, type DeliverableTypeKey } from '@/lib/deliverable-path'

/** 可读取文本以提取标题的类型（其余类型直接用文件名） */
const TEXT_TYPES: ReadonlySet<DeliverableTypeKey> = new Set(['markdown', 'website', 'data'])

/** 卡片图标统一签名：lucide 与自定义 SVG 组件都接受 className */
type CardIcon = React.ComponentType<{ className?: string }>

const TYPE_ICON: Record<DeliverableTypeKey, CardIcon> = {
  website: WebIcon, // HTML → 地球
  markdown: TextFileIcon, // 文本
  pdf: FileType,
  document: TextFileIcon, // 文本
  image: FileImage,
  data: CodeFileIcon, // 代码类别（json/xml）
  file: TextFileIcon, // 文本兜底
}

interface ArtifactCardProps {
  /** 产物文件的绝对路径 */
  path: string
  /** 展示标题；用于交付物表格等已经有明确文件名的场景，避免异步读正文标题造成跳动 */
  displayTitle?: string
  /** 交付物说明；来自 Markdown 表格的「说明」列 */
  description?: string
  className?: string
}

export function ArtifactCard({ path, displayTitle, description, className }: ArtifactCardProps): React.ReactElement {
  const { t } = useT('conversation')
  const openInRightPanel = useOpenInRightPanel()

  const filename = React.useMemo(() => path.split('/').pop() ?? path, [path])
  const ext = React.useMemo(() => extOf(filename), [filename])
  const typeKey = React.useMemo(() => deliverableTypeKey(ext), [ext])
  const Icon = TYPE_ICON[typeKey]

  // 标题：文本类产物读内容取首个 # / frontmatter title，回退文件名；非文本类直接用文件名
  const [docTitle, setDocTitle] = React.useState<string | null>(null)
  React.useEffect(() => {
    let cancelled = false
    if (displayTitle) {
      setDocTitle(null)
      return
    }
    if (!TEXT_TYPES.has(typeKey)) {
      setDocTitle(null)
      return
    }
    window.electronAPI
      .previewReadText(path, 64 * 1024)
      .then((res) => {
        if (cancelled) return
        setDocTitle(extractTitleFromMarkdown(res.content))
      })
      .catch(() => { if (!cancelled) setDocTitle(null) })
    return () => { cancelled = true }
  }, [path, typeKey, displayTitle])

  const title = displayTitle || docTitle || filename

  const openInApp = (): void => {
    openInRightPanel({ kind: 'file', path, ext, size: 0 })
  }
  const openWithSystem = (): void => {
    window.electronAPI.openFile(path).catch((e: unknown) => console.error('[ArtifactCard] 系统打开失败:', e))
  }
  const revealInFolder = (): void => {
    window.electronAPI.showInFolder(path).catch((e: unknown) => console.error('[ArtifactCard] Finder 显示失败:', e))
  }

  return (
    <div
      className={cn(
        'not-prose mt-3 flex items-center gap-2.5 rounded-xl border border-border/60 bg-card/70 px-3 py-2.5 shadow-none',
        className,
      )}
    >
      <div className="flex size-9 flex-shrink-0 items-center justify-center rounded-lg bg-muted-foreground/10 text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={openInApp}
          title={title}
          className="block max-w-full truncate text-left text-sm font-medium text-foreground/90 hover:underline"
        >
          {title}
        </button>
        {description && (
          <div className="mt-0.5 line-clamp-2 text-sm leading-snug text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 flex-shrink-0 gap-1 rounded-lg px-3 text-sm"
          >
            {t('artifactCard.open')}
            <ChevronDown className="!size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          <DropdownMenuItem onSelect={openInApp} className="gap-2 text-sm cursor-pointer">
            <PanelRight className="!size-3.5 text-muted-foreground" />
            {t('artifactCard.openInApp')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={openWithSystem} className="gap-2 text-sm cursor-pointer">
            <ExternalLink className="!size-3.5 text-muted-foreground" />
            {t('artifactCard.openWithSystem')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={revealInFolder} className="gap-2 text-sm cursor-pointer">
            <FolderOpen className="!size-3.5 text-muted-foreground" />
            {t('artifactCard.revealInFolder')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
