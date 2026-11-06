import * as React from 'react'
import { useT } from '@/hooks/useT'
import type { PreviewRendererProps } from '../preview-registry'

/**
 * 直接用原生 <img src="file://..."> 渲染
 * - Electron renderer 开启 webSecurity 时需确认 file:// 可加载；
 *   本项目 renderer 已允许（attachment 也是这样显示）
 * - 图片超大时浏览器会自动解码为 bitmap，内存占用高但可接受
 */
export default function ImageRenderer({ path, onError }: PreviewRendererProps): React.ReactElement {
  const { t } = useT('preview')
  const src = `file://${encodeURI(path).replace(/#/g, '%23')}`

  return (
    <div className="flex items-center justify-center h-full overflow-auto bg-muted/10 p-4 scrollbar-thin">
      <img
        src={src}
        alt={path.split('/').pop()}
        className="max-w-full max-h-full object-contain"
        onError={() => onError(new Error(t('image.loadFailed')))}
      />
    </div>
  )
}
