/**
 * 会话文件视图 —— 右栏 session-files tab 的内容。
 *
 * 从原 SidePanel 抽出的「上半部分」：
 * - 顶部标题栏 Upload / Finder 按钮
 * - FileBrowser 列表
 * - 拖拽覆盖层
 *
 * 调用约定：
 * - sessionPath 必须非空（若 null，调用方应不渲染本组件）
 * - workspaceSlug 来自当前工作区 atom；若为 null（极少出现的过渡态），上传/拖拽
 *   handler 安全 no-op，UI 不报错但操作不会发生效果
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { ExternalLink, FileUp, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FileBrowser } from '@/components/file-browser'
import {
  workspaceFilesVersionAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
} from '@/atoms/agent-atoms'
import { fileToBase64 } from '@/lib/file-utils'
import { useT } from '@/hooks/useT'
import { sessionPapersToolbarIconButtonClassNames } from './session-papers-toolbar-primitives.ts'

interface SessionFilesViewProps {
  sessionId: string
  /** 非空。若 sessionPath 为 null，调用方应不渲染本组件（由 Task 7 TabContent 处理空态） */
  sessionPath: string
}

export function SessionFilesView({
  sessionId,
  sessionPath,
}: SessionFilesViewProps): React.ReactElement {
  const { t } = useT('conversation')
  const setFilesVersion = useSetAtom(workspaceFilesVersionAtom)

  // 派生当前工作区 slug（用于保存文件到会话目录）
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const workspaceSlug = workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null

  const [isUploading, setIsUploading] = React.useState(false)
  const [isDragOver, setIsDragOver] = React.useState(false)

  const handleFilesUploaded = React.useCallback(() => {
    setFilesVersion((prev) => prev + 1)
  }, [setFilesVersion])

  // ===== 上传 / 拖拽 =====

  const uploadFiles = React.useCallback(async (files: globalThis.File[]): Promise<void> => {
    if (files.length === 0 || !workspaceSlug) return
    setIsUploading(true)
    try {
      const fileEntries: Array<{ filename: string; data: string }> = []
      for (const file of files) {
        const base64 = await fileToBase64(file)
        fileEntries.push({ filename: file.name, data: base64 })
      }
      await window.electronAPI.saveFilesToAgentSession({
        workspaceSlug,
        sessionId,
        files: fileEntries,
      })
      handleFilesUploaded()
      toast.success(t('sidePanel.addedFile', { count: files.length }))
    } catch (error) {
      console.error('[SessionFilesView] 文件上传失败:', error)
      toast.error(t('sidePanel.uploadFailed'))
    } finally {
      setIsUploading(false)
    }
  }, [workspaceSlug, sessionId, handleFilesUploaded, t])

  const handleSelectFiles = React.useCallback(async () => {
    if (!workspaceSlug) return
    try {
      const result = await window.electronAPI.openFileDialog()
      if (result.files.length === 0) return
      setIsUploading(true)
      await window.electronAPI.saveFilesToAgentSession({
        workspaceSlug,
        sessionId,
        files: result.files.map((f) => ({ filename: f.filename, data: f.data })),
      })
      handleFilesUploaded()
      toast.success(t('sidePanel.addedFile', { count: result.files.length }))
    } catch (error) {
      console.error('[SessionFilesView] 选择文件失败:', error)
      toast.error(t('sidePanel.uploadFailed'))
    } finally {
      setIsUploading(false)
    }
  }, [workspaceSlug, sessionId, handleFilesUploaded, t])

  const handleDrop = React.useCallback(async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    if (!workspaceSlug) return
    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length === 0) return

    // 通过真实路径过滤掉文件夹（会话目录不支持附加目录，静默忽略）
    const pathMap = new Map<string, globalThis.File>()
    const paths: string[] = []
    for (const f of droppedFiles) {
      try {
        const p = window.electronAPI.getPathForFile(f)
        if (p) {
          paths.push(p)
          pathMap.set(p, f)
        }
      } catch { /* 无路径时忽略 */ }
    }

    if (paths.length === 0) {
      await uploadFiles(droppedFiles)
      return
    }

    try {
      const { files: filePaths } = await window.electronAPI.checkPathsType(paths)
      const regularFiles = filePaths.map((p) => pathMap.get(p)!).filter(Boolean)
      if (regularFiles.length > 0) {
        await uploadFiles(regularFiles)
      }
    } catch (error) {
      console.error('[SessionFilesView] 路径检测失败，回退:', error)
      await uploadFiles(droppedFiles)
    }
  }, [workspaceSlug, uploadFiles])

  return (
    <section
      className="relative flex-1 min-h-0 flex flex-col"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setIsDragOver(true)
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setIsDragOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setIsDragOver(false)
      }}
      onDrop={handleDrop}
    >
      {/* 顶部显示会话根目录标记；排版与 Papers toolbar 保持一致。 */}
      <div
        className="py-1.5 space-y-1.5 flex-shrink-0 titlebar-drag-region"
        data-session-files-actions
      >
        <div className="pl-[18px] pr-2.5 flex items-center gap-1 min-h-8" data-session-files-action-row>
          <span className="text-sm font-medium text-muted-foreground truncate flex-1">/</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('sidePanel.uploadTooltip')}
                className={sessionPapersToolbarIconButtonClassNames({ className: 'titlebar-no-drag' })}
                disabled={isUploading}
                onClick={handleSelectFiles}
              >
                {isUploading ? (
                  <Loader2 className="size-2 animate-spin" />
                ) : (
                  <FileUp className="!size-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t('sidePanel.uploadTooltip')}</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('sidePanel.openInFinder')}
                className={sessionPapersToolbarIconButtonClassNames({ className: 'titlebar-no-drag' })}
                onClick={() => window.electronAPI.openFile(sessionPath).catch(console.error)}
              >
                <ExternalLink className="!size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t('sidePanel.openInFinder')}</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="border-b border-border/60" data-session-files-divider />
      </div>

      {/* 文件列表（独立滚动，flex-col 让空态可撑高居中） */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col scrollbar-thin">
        <FileBrowser
          rootPath={sessionPath}
          hideToolbar
          embedded
          visibleHiddenEntries={['.context']}
          // 会话工作区根的 ASCI 身份 CLAUDE.md 是基础设施文件（拦截 ambient CLAUDE.md +
          // 声明宿主身份，config-paths.ts 幂等写入），不应在会话文件区暴露给用户。
          hiddenRootEntries={['CLAUDE.md']}
        />
      </div>

      {/* 拖拽覆盖层 */}
      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/8 backdrop-blur-[1px] border-2 border-dashed border-primary/60 rounded-xl pointer-events-none">
          <span className="text-xs font-medium text-primary">{t('sidePanel.dragOverlay')}</span>
        </div>
      )}
    </section>
  )
}
