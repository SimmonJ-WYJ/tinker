/**
 * FilePathChip — 文件路径可点击芯片
 *
 * 在 Agent 消息中检测到文件路径时，渲染为可点击的芯片。
 * 支持绝对路径和相对路径（相对于 basePath 解析）。
 * 点击后在右栏新建/聚焦文件预览 tab，全程留在应用内（不再弹出系统程序 / 新窗口）。
 * 「用系统程序打开 / 在 Finder 中显示」是 FileActionRow 上的独立显式按钮，与此 chip 区分。
 */

import * as React from 'react'
import { FileText, FileImage, FileVideo, FileCode } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOpenInRightPanel } from '@/hooks/useOpenInRightPanel'
import {
  INLINE_CHIP_STYLE,
  INLINE_CHIP_TEXT_STYLE,
  INLINE_ICON_LABEL_CLASS,
  INLINE_LABEL_INTERACTIVE_CLASS,
} from './inline-label-style.ts'

/** 图片扩展名 */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'])
/** 视频扩展名 */
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov'])
/** 代码/结构化文本扩展名 */
const CODE_EXTS = new Set(['json', 'xml', 'html', 'htm', 'md', 'markdown'])
/** 文档扩展名 */
const DOC_EXTS = new Set(['pdf', 'docx'])

/** 所有可预览的扩展名集合（用于相对路径检测） */
const ALL_PREVIEWABLE_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS, ...CODE_EXTS, ...DOC_EXTS])

/** 从路径提取文件名 */
function getFileName(filePath: string): string {
  const parts = filePath.split('/')
  return parts[parts.length - 1] || filePath
}

/** 从文件名提取扩展名（小写，不含点） */
function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot === -1) return ''
  return filename.slice(dot + 1).toLowerCase()
}

/** 根据扩展名获取文件图标 */
function getFileIcon(ext: string): React.ReactElement {
  const iconClass = '!size-[13px] shrink-0'
  if (IMAGE_EXTS.has(ext)) return <FileImage className={iconClass} />
  if (VIDEO_EXTS.has(ext)) return <FileVideo className={iconClass} />
  if (CODE_EXTS.has(ext)) return <FileCode className={iconClass} />
  return <FileText className={iconClass} />
}

/**
 * 解析完整路径：绝对路径直接使用，相对路径拼接 basePath。
 * 暴露为独立函数便于工具结果渲染器等场景复用同一拼接规则。
 */
export function resolveFilePath(filePath: string, basePath?: string): string {
  const trimmed = filePath.trim()
  if (trimmed.startsWith('/') || /^[A-Z]:\\/.test(trimmed)) {
    return trimmed
  }
  if (basePath) {
    return basePath.endsWith('/') ? `${basePath}${trimmed}` : `${basePath}/${trimmed}`
  }
  return trimmed
}

interface FilePathChipProps {
  /** 文件路径（绝对或相对） */
  filePath: string
  /** 基础目录路径，用于解析相对路径 */
  basePath?: string
  className?: string
}

/** 文件路径芯片 — 可点击，触发文件预览 */
export function FilePathChip({ filePath, basePath, className }: FilePathChipProps): React.ReactElement {
  const filename = getFileName(filePath)
  const ext = getExtension(filename)

  const fullPath = React.useMemo(() => resolveFilePath(filePath, basePath), [filePath, basePath])
  const openInRightPanel = useOpenInRightPanel()

  const handleClick = React.useCallback(() => {
    // 在右栏内渲染（file-preview tab）。size 由预览 renderer 自行读取文件得到，
    // 此处仅用于「无 renderer 时」的 too-large/unsupported 占位判断，传 0 不影响可渲染类型。
    openInRightPanel({ kind: 'file', path: fullPath, ext, size: 0 })
  }, [openInRightPanel, fullPath, ext])

  return (
    <button
      type="button"
      onClick={handleClick}
      title={fullPath}
      style={INLINE_CHIP_STYLE}
      className={cn(
        INLINE_ICON_LABEL_CLASS,
        INLINE_LABEL_INTERACTIVE_CLASS,
        'appearance-none justify-start border-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        className
      )}
    >
      {getFileIcon(ext)}
      <span className="asci-inline-chip-text truncate max-w-[240px]" style={INLINE_CHIP_TEXT_STYLE}>
        {filename}
      </span>
    </button>
  )
}

/**
 * 检测文本是否为绝对文件路径
 *
 * 匹配规则：
 * - macOS/Linux: 以 / 开头，至少两级路径
 * - Windows: 以 C:\ 等盘符开头
 */
export function isAbsoluteFilePath(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 2) return false

  // macOS/Linux 绝对路径：以 / 开头，至少两级
  if (trimmed.startsWith('/') && /^\/[^\n]+\/[^\n]+$/.test(trimmed)) {
    // 排除常见的非路径模式（如 /regex/ 模式）
    if (trimmed.endsWith('/') && !trimmed.includes('.')) return false
    return true
  }

  // Windows 绝对路径
  if (/^[A-Z]:\\/.test(trimmed)) return true

  return false
}

/**
 * 检测文本是否为相对文件路径（需要 basePath 才有意义）
 *
 * 匹配规则：
 * - 含有可预览的文件扩展名
 * - 看起来像文件名或相对路径（不含空格、不含特殊字符）
 * - 排除常见的非路径 inline code（如命令、变量名等）
 */
export function isRelativeFilePath(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 3) return false

  // 提取扩展名
  const ext = getExtension(trimmed)
  if (!ext || !ALL_PREVIEWABLE_EXTS.has(ext)) return false

  // 必须看起来像文件路径：支持 Unicode 文件名，但排除空白和常见 shell / HTML 特殊字符。
  if (!/^[^\s`"'<>|?*]+$/u.test(trimmed)) return false

  // 排除以点开头的隐藏文件（如 .gitignore），但保留含子路径的目录相对路径（如 .context/file.md）
  if (trimmed.startsWith('.') && !trimmed.startsWith('./') && !trimmed.includes('/')) return false

  return true
}
