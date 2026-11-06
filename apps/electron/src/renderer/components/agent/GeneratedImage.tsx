import * as React from 'react'
import { useSetAtom } from 'jotai'
import { Download, Pencil, Columns2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { imageEditDraftsAtom } from '@/atoms/image-edit-atoms'
import { parseImageVersion, type ImageVersion } from './image-versions'
import { ImageVersionCompare } from './ImageVersionCompare'
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
 return <div className="my-4 space-y-2 rounded-xl bg-muted/20 p-3" data-generated-image="true">
  {failed?<p role="alert" className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{t('imageVersion.missing')}</p>:src?<button type="button" onClick={()=>setOpen(true)} className="block overflow-hidden rounded-lg focus-visible:outline focus-visible:outline-2"><img src={src} alt={artifact.filename} className="max-h-[520px] max-w-full object-contain" onError={()=>setFailed(true)} onLoad={event=>{const {naturalWidth:width,naturalHeight:height}=event.currentTarget;if(width>0&&height>0)setDimensions({width,height})}}/></button>:<p role="status" className="text-sm text-muted-foreground">{t('loading')}</p>}
  {version.imageId && <p className="text-sm font-medium" title={version.imageId}>{t('imageVersion.label',{id:version.imageId.slice(0,8)})}{version.baseImageId && <span className="font-normal text-muted-foreground" title={version.baseImageId}> · {t('imageVersion.from',{id:version.baseImageId.slice(0,8)})}</span>}</p>}
  {version.model && <p className="text-xs text-muted-foreground">{version.model}{version.channelName?` · ${version.channelName}`:''}{typeof version.referenceCount==='number'?` · ${t('imageReferenceCount',{count:version.referenceCount})}`:''}</p>}
  {dimensions && <p className="text-xs text-muted-foreground">{t('imageActualDimensions',dimensions)}</p>}
  {(version.referenceCount??0)>0 && <p className="text-xs text-muted-foreground">{t('imageEditDimensionsNotice')}</p>}
  <p className="text-xs text-muted-foreground">{t('imageBillingNotice')}</p>
  {version.baseImageId && !parent && <p role="status" className="text-sm text-muted-foreground">{t('imageVersion.parentMissing')}</p>}
  <div className="flex flex-wrap items-center gap-2">
   <Button variant="outline" size="sm" onClick={select} disabled={!canEdit} title={!canEdit&&!failed?t('imageVersion.unavailableId'):undefined}><Pencil aria-hidden="true"/>{t('imageVersion.edit')}</Button>
   {version.baseImageId && <Button ref={compareButton} variant="subtle" size="sm" disabled={!parent} onClick={()=>setCompare(true)} title={!parent?t('imageVersion.parentMissing'):undefined}><Columns2 aria-hidden="true"/>{t('imageVersion.compare')}</Button>}
   <Button variant="subtle" size="sm" onClick={save} disabled={!src||failed}><Download aria-hidden="true"/>{t('save')}</Button>
  </div>
  <ImageLightbox src={src} alt={artifact.filename} open={open} onOpenChange={setOpen} onSave={save}/>
  {parent && <ImageVersionCompare current={version} parent={parent} open={compare} onOpenChange={setCompare} returnFocus={()=>compareButton.current?.focus()}/>}
 </div>
}
