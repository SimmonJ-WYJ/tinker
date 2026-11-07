/** 仅将当前回合、当前会话的明确生图引用交给附件桥接，不推断 cwd 中不存在的文件。 */
import * as React from 'react'
import type { SDKAssistantMessage, SDKMessage } from '@asci/shared'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { useT } from '@/hooks/useT'
import { parseImageVersion, type ImageVersion } from './image-versions'
import { findToolResultInMessages } from './tool-result-lookup'

type GeneratedImageArtifact = ImageVersion['generatedImage']

interface ReferenceContext {
  resolve: (reference: string) => GeneratedImageArtifact | null
  open: (image: GeneratedImageArtifact, trigger?: HTMLElement) => void
}

const GeneratedImageReferencesContext = React.createContext<ReferenceContext | null>(null)

/** 只接收本回合成功的宿主工具结果，历史版本仍由原版本列表保留。 */
function collectTurnImages(
  messages: SDKAssistantMessage[],
  allMessages: SDKMessage[],
  sessionId: string | null,
): GeneratedImageArtifact[] {
  if (!sessionId) return []
  const images = new Map<string, GeneratedImageArtifact>()
  for (const message of messages) {
    const blocks = message.message?.content
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      if (block.type !== 'tool_use' || block.name !== 'mcp__asci-image__generate_image' || typeof block.id !== 'string') continue
      const result = findToolResultInMessages(block.id, allMessages)
      if (!result || result.isError) continue
      const image = parseImageVersion(result.result)?.generatedImage
      if (image && image.localPath.split('/')[0] === sessionId) images.set(image.localPath, image)
    }
  }
  return [...images.values()]
}

function resolveReference(reference: string, images: GeneratedImageArtifact[], basePath?: string): GeneratedImageArtifact | null {
  let path = reference
  try { path = decodeURIComponent(path) } catch { /* 保留未编码的精确引用 */ }
  const cwdPrefix = basePath ? `${basePath.replace(/\/+$/, '')}/` : null
  if (cwdPrefix && path.startsWith(cwdPrefix)) path = path.slice(cwdPrefix.length)
  path = path.replace(/^\.\//, '')
  const matches = images.filter((image) => {
    const basename = image.localPath.split('/').pop()
    const displayFilename = /[/\\]/.test(image.filename) ? null : image.filename
    return path === image.localPath || path === basename || path === displayFilename
  })
  return matches.length === 1 ? matches[0]! : null
}

interface SelectedImage {
  image: GeneratedImageArtifact
  request: number
  src: string | null
  open: boolean
}

interface GeneratedImageReferenceProviderProps {
  assistantMessages: SDKAssistantMessage[]
  allMessages: SDKMessage[]
  sessionId: string | null
  basePath?: string
  children: React.ReactNode
}

export function GeneratedImageReferenceProvider({
  assistantMessages, allMessages, sessionId, basePath, children,
}: GeneratedImageReferenceProviderProps): React.ReactElement {
  const { t } = useT('preview')
  const { t: tCommon } = useT('common')
  const images = React.useMemo(() => collectTurnImages(assistantMessages, allMessages, sessionId), [assistantMessages, allMessages, sessionId])
  const [selected, setSelected] = React.useState<SelectedImage | null>(null)
  const [failed, setFailed] = React.useState(false)
  const requestRef = React.useRef(0)
  const openerRef = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    requestRef.current++
    setSelected(null)
    setFailed(false)
    return () => { requestRef.current++ }
  }, [sessionId])

  const open = React.useCallback((image: GeneratedImageArtifact, trigger?: HTMLElement): void => {
    const request = ++requestRef.current
    openerRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setFailed(false)
    setSelected({ image, request, src: null, open: true })
    void window.electronAPI.readAttachment(image.localPath).then((base64) => {
      if (requestRef.current !== request) return
      setSelected({ image, request, src: `data:${image.mediaType};base64,${base64}`, open: true })
    }).catch(() => {
      if (requestRef.current !== request) return
      setSelected(null)
      setFailed(true)
    })
  }, [])

  const context = React.useMemo<ReferenceContext>(() => ({
    resolve: (reference) => resolveReference(reference, images, basePath),
    open,
  }), [images, basePath, open])

  const save = (): void => {
    if (!selected?.src) return
    const anchor = document.createElement('a')
    anchor.href = selected.src
    anchor.download = selected.image.filename.split(/[/\\]/).pop() || selected.image.localPath.split('/').pop()!
    anchor.click()
  }

  return (
    <GeneratedImageReferencesContext.Provider value={context}>
      {children}
      {selected?.open && !selected.src && <p role="status" className="text-sm text-muted-foreground">{tCommon('loading')}</p>}
      {failed && <p role="alert" className="text-sm text-muted-foreground">{t('image.loadFailed')}</p>}
      <ImageLightbox
        key={selected?.request}
        src={selected?.src ?? null}
        alt={selected?.image.filename}
        open={!!selected?.src && selected.open}
        onOpenChange={(isOpen) => {
          if (!isOpen) { requestRef.current++; setSelected(null) }
        }}
        onSave={save}
        returnFocus={() => { if (openerRef.current?.isConnected) openerRef.current.focus() }}
      />
    </GeneratedImageReferencesContext.Provider>
  )
}

/** 返回 null 即不接管，通用链接与文件路径行为保持原有契约。 */
export function useGeneratedImageReference(reference: string): ((trigger?: HTMLElement) => void) | null {
  const context = React.useContext(GeneratedImageReferencesContext)
  const image = context?.resolve(reference)
  return image && context ? (trigger) => context.open(image, trigger) : null
}
