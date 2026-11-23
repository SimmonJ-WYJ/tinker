import { useImageSource } from '@/lib/image-asset-reads'
import * as React from 'react'
import { useSetAtom } from 'jotai'
import { Download, Pencil, Columns2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
import { nativeImageSave } from './native-image-files'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { imageEditDraftsAtom } from '@/atoms/image-edit-atoms'
import { parseImageVersion, type ImageVersion } from './image-versions'
import { ImageVersionCompare } from './ImageVersionCompare'
import './generated-image.css'
/** 文件缺失仍保留结果卡，避免把曾经成功的生成结果静默隐藏。 */
export function GeneratedImage({result,versions=[],sessionId}:{result?:string;versions?:ImageVersion[];sessionId?:string}):React.ReactElement|null {
 const compareButton=React.useRef<HTMLButtonElement>(null)
 const {t}=useT('common');const setDrafts=useSetAtom(imageEditDraftsAtom)
 const [open,setOpen]=React.useState(false);const [compare,setCompare]=React.useState<string>();const [broken,setBroken]=React.useState<string>()
 const version=React.useMemo(()=>parseImageVersion(result),[result]);const artifact=version?.generatedImage
 const preview = useImageSource(artifact?.localPath, artifact?.mediaType ?? 'image/png', 'thumbnail')
 const src = preview?.src ?? ''
 const failed = preview?.failed || (Boolean(src) && src === broken)
 if(!artifact || !version) return null
 const owner=artifact.localPath.split('/')[0]!
 const parent=versions.find(item=>item.imageId===version.baseImageId && item.generatedImage.localPath.split('/')[0]===owner)
 const canEdit=Boolean(src && !failed && version.imageId && (!sessionId || sessionId===owner))
 const select=():void=>{
  if(!canEdit || !version.imageId) return
  const sourceMessageId=versions.find(item=>item.imageId===version.imageId && item.generatedImage.localPath===version.generatedImage.localPath)?.sourceMessageId
  const selected={...version,imageId:version.imageId,previewSrc:src,sourceMessageId}
  setDrafts(previous=>new Map(previous).set(sessionId??owner,selected))
 }
 const save=window.__TAURI_FORMAL__ ? nativeImageSave(artifact.localPath) : ():void=>{void window.electronAPI.saveImageAs(artifact.localPath,artifact.filename)}
 return <div className="generated-image" data-generated-image="true">
  {failed?<p role="alert" className="generated-image__placeholder">{t('imageVersion.missing')}</p>:src?<button type="button" onClick={()=>setOpen(true)} className="generated-image__preview"><img src={src} alt={artifact.filename} onError={()=>setBroken(src)}/></button>:<p role="status" className="generated-image__placeholder">{t('loading')}</p>}
  <div className="generated-image__actions">
   <Button variant="outline" size="sm" className="generated-image__action" onClick={select} disabled={!canEdit} title={!canEdit&&!failed?t('imageVersion.unavailableId'):undefined}><Pencil aria-hidden="true"/>{t('imageVersion.edit')}</Button>
   {version.baseImageId && <Button ref={compareButton} variant="subtle" size="sm" className="generated-image__action" disabled={!parent} onClick={()=>setCompare(artifact.localPath)} title={!parent?t('imageVersion.parentMissing'):undefined}><Columns2 aria-hidden="true"/>{t('imageVersion.compare')}</Button>}
   <Button variant="subtle" size="sm" className="generated-image__action" onClick={save} disabled={!save||!src||failed}><Download aria-hidden="true"/>{t('save')}</Button>
  </div>
  {version.baseImageId && !parent && <p role="status" className="generated-image__notice">{t('imageVersion.parentMissing')}</p>}
  {version.model && <p className="generated-image__caption">{t('imageGeneratedBy',{model:version.model})}</p>}
  <ImageLightbox localPath={artifact.localPath} src={src} alt={artifact.filename} open={open} onOpenChange={setOpen} onSave={save}/>
  {parent && <ImageVersionCompare current={version} parent={parent} open={compare===artifact.localPath} onOpenChange={show=>setCompare(show?artifact.localPath:undefined)} returnFocus={()=>compareButton.current?.focus()}/>}
 </div>
}
