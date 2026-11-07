import * as React from 'react'
import { useSetAtom } from 'jotai'
import { Download, Pencil, Columns2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { imageEditDraftsAtom } from '@/atoms/image-edit-atoms'
import { parseImageVersion, type ImageVersion } from './image-versions'
import { ImageVersionCompare } from './ImageVersionCompare'
import './generated-image.css'
/** 文件缺失仍保留结果卡，避免把曾经成功的生成结果静默隐藏。 */
export function GeneratedImage({result,versions=[],sessionId}:{result?:string;versions?:ImageVersion[];sessionId?:string}):React.ReactElement|null {
 const compareButton=React.useRef<HTMLButtonElement>(null)
 const {t}=useT('common');const setDrafts=useSetAtom(imageEditDraftsAtom)
 const [src,setSrc]=React.useState('');const [open,setOpen]=React.useState(false);const [compare,setCompare]=React.useState(false);const [failed,setFailed]=React.useState(false)
 const [dimensions,setDimensions]=React.useState<{width:number;height:number}|null>(null)
 const version=React.useMemo(()=>parseImageVersion(result),[result]);const artifact=version?.generatedImage
 React.useEffect(()=>{
  let active=true;setSrc('');setDimensions(null);setFailed(false)
  if(artifact) void window.electronAPI.readAttachment(artifact.localPath).then(data=>{if(active)setSrc(`data:${artifact.mediaType};base64,${data}`)}).catch(()=>{if(active)setFailed(true)})
  return ()=>{active=false}
 },[artifact])
 if(!artifact || !version) return null
 const owner=artifact.localPath.split('/')[0]!
 const parent=versions.find(item=>item.imageId===version.baseImageId && item.generatedImage.localPath.split('/')[0]===owner)
 const canEdit=Boolean(src && !failed && version.imageId && (!sessionId || sessionId===owner))
 const select=():void=>{
  if(!canEdit || !version.imageId) return
  const selected={...version,imageId:version.imageId,previewSrc:src}
  setDrafts(previous=>new Map(previous).set(sessionId??owner,selected))
 }
 const save=():void=>{void window.electronAPI.saveImageAs(artifact.localPath,artifact.filename)}
 return <div className="generated-image" data-generated-image="true">
  {failed?<p role="alert" className="generated-image__placeholder">{t('imageVersion.missing')}</p>:src?<button type="button" onClick={()=>setOpen(true)} className="generated-image__preview"><img src={src} alt={artifact.filename} onError={()=>setFailed(true)} onLoad={event=>{const {naturalWidth:width,naturalHeight:height}=event.currentTarget;if(width>0&&height>0)setDimensions({width,height})}}/></button>:<p role="status" className="generated-image__placeholder">{t('loading')}</p>}
  <div className="generated-image__actions">
   <Button variant="outline" size="sm" className="generated-image__action" onClick={select} disabled={!canEdit} title={!canEdit&&!failed?t('imageVersion.unavailableId'):undefined}><Pencil aria-hidden="true"/>{t('imageVersion.edit')}</Button>
   {version.baseImageId && <Button ref={compareButton} variant="subtle" size="sm" className="generated-image__action" disabled={!parent} onClick={()=>setCompare(true)} title={!parent?t('imageVersion.parentMissing'):undefined}><Columns2 aria-hidden="true"/>{t('imageVersion.compare')}</Button>}
   <Button variant="subtle" size="sm" className="generated-image__action" onClick={save} disabled={!src||failed}><Download aria-hidden="true"/>{t('save')}</Button>
  </div>
  {version.baseImageId && !parent && <p role="status" className="generated-image__notice">{t('imageVersion.parentMissing')}</p>}
  <details className="generated-image__details">
   <summary><span>{t('imageDetails')}</span>{dimensions && <span className="generated-image__dimensions">{t('imageDimensionsSummary',dimensions)}</span>}</summary>
   <div className="generated-image__metadata">
    {version.imageId && <p title={version.imageId}>{t('imageVersion.label',{id:version.imageId.slice(0,8)})}{version.baseImageId && <span title={version.baseImageId}> · {t('imageVersion.from',{id:version.baseImageId.slice(0,8)})}</span>}</p>}
    {(version.model || version.channelName || typeof version.referenceCount==='number') && <p>{[version.model,version.channelName,typeof version.referenceCount==='number'?t('imageReferenceCount',{count:version.referenceCount}):undefined].filter(Boolean).join(' · ')}</p>}
    {dimensions && <p>{t('imageActualDimensions',dimensions)}</p>}
    {(version.referenceCount??0)>0 && <p>{t('imageEditDimensionsNotice')}</p>}
    <p>{t('imageBillingNotice')}</p>
   </div>
  </details>
  <ImageLightbox src={src} alt={artifact.filename} open={open} onOpenChange={setOpen} onSave={save}/>
  {parent && <ImageVersionCompare current={version} parent={parent} open={compare} onOpenChange={setCompare} returnFocus={()=>compareButton.current?.focus()}/>}
 </div>
}
