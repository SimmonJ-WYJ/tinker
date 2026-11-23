/** 原图查看器：适应窗口、按实际像素缩放，沿用宿主保存回调，不改图片或版本数据。 */
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Pencil, Download, X, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
interface ImageLightboxProps {
  src: string | null
  alt?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave?: () => void
  onEdit?: () => void
  returnFocus?: () => void
}
const MIN_SCALE = 0.05
const MAX_SCALE = 8
export function ImageLightbox({ src, alt, open, onOpenChange, onSave, onEdit, returnFocus }: ImageLightboxProps): React.ReactElement | null {
  const { t } = useT('common')
  const { t: tPreview } = useT('preview')
  const [natural, setNatural] = React.useState({ width: 0, height: 0 })
  const [manualScale, setManualScale] = React.useState<number | null>(null)
  const [failed, setFailed] = React.useState(false)
  const opener = React.useRef<HTMLElement | null>(null)
  const [viewport, setViewport] = React.useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  React.useEffect(() => {
    setNatural({ width: 0, height: 0 }); setManualScale(null); setFailed(false)
  }, [src])
  React.useEffect(() => { setManualScale(null); setFailed(false) }, [open])
  React.useEffect(() => {
    if (!open) return
    const resize = (): void => setViewport({ width: window.innerWidth, height: window.innerHeight })
    resize(); window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [open])
  const loaded = natural.width > 0 && natural.height > 0 && !failed
  const fitScale = loaded ? Math.min(Math.max(1, viewport.width - 48) / natural.width, Math.max(1, viewport.height - 160) / natural.height, 1) : 1
  const scale = manualScale ?? fitScale
  const zoom = (factor: number): void => { if (loaded) setManualScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor))) }
  if (!src) return null
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[200] bg-background/95 titlebar-no-drag" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[200] flex min-w-0 flex-col gap-4 p-4 text-foreground outline-none sm:p-6"
          onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
          onCloseAutoFocus={event => {
            if (returnFocus) { event.preventDefault(); returnFocus() }
            else if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus() }
          }}
          onKeyDown={event => {
            if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.25) }
            if (event.key === '-') { event.preventDefault(); zoom(0.8) }
            if (event.key === '0') { event.preventDefault(); setManualScale(null) }
          }}
        >
          <div className="flex shrink-0 items-center justify-between gap-3">
            <DialogPrimitive.Title className="min-w-0 truncate text-sm font-medium">{alt || tPreview('image.lightboxAlt')}</DialogPrimitive.Title>
            <div className="flex shrink-0 items-center gap-2">
              {onEdit && <Button type="button" variant="ghost" size="icon" onClick={onEdit} disabled={!loaded} aria-label={t('imageVersion.edit')} title={t('imageVersion.edit')}><Pencil className="size-5" aria-hidden="true" /></Button>}
              {onSave && <Button type="button" variant="ghost" size="icon" onClick={onSave} disabled={failed} aria-label={t('image.save')} title={t('image.save')}><Download className="size-5" aria-hidden="true" /></Button>}
              <DialogPrimitive.Close asChild><Button type="button" variant="ghost" size="icon" aria-label={t('close')} title={t('close')}><X className="size-5" aria-hidden="true" /></Button></DialogPrimitive.Close>
            </div>
          </div>
          <DialogPrimitive.Description className="sr-only">{tPreview('image.lightboxAria', { alt: alt || tPreview('image.lightboxAlt') })}</DialogPrimitive.Description>
          <div className="min-h-0 min-w-0 flex-1 overflow-auto" onClick={event => { if (event.target === event.currentTarget) onOpenChange(false) }}>
            <div
              className="flex min-h-full min-w-full items-center justify-center"
              style={loaded ? { width: natural.width * scale, height: natural.height * scale } : undefined}
              onClick={event => { if (event.target === event.currentTarget) onOpenChange(false) }}
            >
              {failed ? <p role="alert" className="text-sm text-muted-foreground">{tPreview('image.loadFailed')}</p> : <img
                src={src} alt={alt || tPreview('image.lightboxAlt')} draggable={false}
                className="block shrink-0 select-none object-contain"
                style={loaded ? { width: natural.width * scale, height: natural.height * scale, maxWidth: 'none', maxHeight: 'none' } : { maxWidth: '100%', maxHeight: '100%' }}
                onLoad={event => { const { naturalWidth: width, naturalHeight: height } = event.currentTarget; if (width > 0 && height > 0) setNatural({ width, height }) }}
                onError={() => setFailed(true)}
              />}
            </div>
          </div>
          <div role="toolbar" aria-label={tPreview('image.controls')} className="flex shrink-0 items-center justify-center gap-2 self-center rounded-full border border-border/50 bg-background px-3 py-1 shadow-sm">
            <Button type="button" variant="ghost" size="icon" disabled={!loaded || scale <= MIN_SCALE} onClick={() => zoom(0.8)} aria-label={tPreview('image.zoomOut')} title={tPreview('image.zoomOut')}><ZoomOut className="size-4" aria-hidden="true" /></Button>
            <output className="min-w-[4ch] text-center text-sm tabular-nums" aria-live="polite" aria-label={tPreview('image.zoomLevel', { percent: Math.round(scale * 100) })}>{loaded ? `${Math.round(scale * 100)}%` : '—'}</output>
            <Button type="button" variant="ghost" size="icon" disabled={!loaded || scale >= MAX_SCALE} onClick={() => zoom(1.25)} aria-label={tPreview('image.zoomIn')} title={tPreview('image.zoomIn')}><ZoomIn className="size-4" aria-hidden="true" /></Button>
            <Button type="button" variant="ghost" size="icon" disabled={!loaded} onClick={() => setManualScale(null)} aria-label={tPreview('image.fitToWindow')} title={tPreview('image.fitToWindow')}><Maximize2 className="size-4" aria-hidden="true" /></Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
