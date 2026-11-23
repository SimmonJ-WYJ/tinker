/** 原生已提交图片按用途读取；旧附件仍由原预加载桥接打开。 */
import * as React from 'react'
import { isNativeAssetPath } from '../../tauri-formal/image-assets'

export function nativeImageAssets(path?: string) {
  return path && isNativeAssetPath(path) ? window.__TAURI_FORMAL__?.imageAssets : undefined
}

export function readImageThumbnail(path: string): Promise<string> {
  return nativeImageAssets(path)?.thumbnail(path) ?? window.electronAPI.readAttachment(path)
}

interface ImageSource {
  path: string
  src?: string
  failed?: boolean
}

/** 原始字节和 URL 仅属于发起查看的组件，不进入 Jotai 草稿、历史或全局缓存。 */
export function useImageSource(
  path: string | undefined,
  mediaType: string,
  purpose: 'thumbnail' | 'original',
): ImageSource | undefined {
  const [source, setSource] = React.useState<ImageSource>()
  React.useEffect(() => {
    setSource(undefined)
    if (!path) return
    let url: string | undefined
    const controller = new AbortController()
    const { signal } = controller
    const assets = nativeImageAssets(path)
    void (async () => {
      try {
        if (assets && purpose === 'original') {
          const bytes = await assets.original(path, signal)
          if (signal.aborted) return
          url = URL.createObjectURL(bytes)
          setSource({ path, src: url })
        } else {
          const data = assets ? await assets.thumbnail(path) : await window.electronAPI.readAttachment(path)
          if (!signal.aborted) setSource({ path, src: `data:${mediaType};base64,${data}` })
        }
      } catch {
        if (!signal.aborted) setSource({ path, failed: true })
      }
    })()
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [path, mediaType, purpose])
  return path && source?.path === path ? source : undefined
}
