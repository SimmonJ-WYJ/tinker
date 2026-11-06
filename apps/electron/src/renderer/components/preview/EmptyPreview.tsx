/**
 * 预览空态 / 不支持态 / 降级态
 */
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { FileQuestion, FileX, ExternalLink, FolderSearch } from 'lucide-react'
import { useT } from '@/hooks/useT'

interface EmptyPreviewProps {
  variant: 'unsupported' | 'too-large' | 'unreadable' | 'empty' | 'not-found'
  filePath?: string
  message?: string
}

export function EmptyPreview({ variant, filePath, message }: EmptyPreviewProps): React.ReactElement {
  const { t } = useT('preview')

  const variantCopy: Record<EmptyPreviewProps['variant'], { title: string; hint?: string }> = React.useMemo(() => ({
    unsupported: { title: t('empty.unsupported.title'), hint: t('empty.unsupported.hint') },
    'too-large': { title: t('empty.tooLarge.title') },
    unreadable: { title: t('empty.unreadable.title') },
    empty: { title: t('empty.empty.title'), hint: t('empty.empty.hint') },
    'not-found': { title: t('empty.notFound.title'), hint: t('empty.notFound.hint') },
  }), [t])

  const copy = variantCopy[variant]
  // 文件已不存在时用 FileX 图标；其余沿用 FileQuestion
  const Icon = variant === 'not-found' ? FileX : FileQuestion

  const handleOpenExternal = (): void => {
    if (filePath) window.electronAPI.previewFile(filePath).catch(console.error)
  }

  const handleShowInFolder = (): void => {
    if (filePath) window.electronAPI.showAttachedInFolder(filePath).catch(console.error)
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 p-6 text-center">
      <Icon className="size-8 text-muted-foreground/40" />
      <div className="text-xs text-foreground">{copy.title}</div>
      {message && <div className="text-sm text-muted-foreground max-w-[240px]">{message}</div>}
      {copy.hint && <div className="text-sm text-muted-foreground/70 max-w-[240px]">{copy.hint}</div>}
      {filePath && variant !== 'empty' && variant !== 'not-found' && (
        <div className="flex gap-2 mt-2">
          <Button size="sm" variant="outline" onClick={handleOpenExternal}>
            <ExternalLink className="size-3 mr-1" />
            {t('empty.openExternal')}
          </Button>
          <Button size="sm" variant="outline" onClick={handleShowInFolder}>
            <FolderSearch className="size-3 mr-1" />
            {t('empty.revealInFinder')}
          </Button>
        </div>
      )}
    </div>
  )
}
