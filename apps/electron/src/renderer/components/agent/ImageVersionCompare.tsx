/** 只读取选中版本和明确父版本，不使用 latest，也不调整原图比例。 */
import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useT } from '@/hooks/useT'
import type { ImageVersion } from './image-versions'
function VersionPreview({version,label}:{version:ImageVersion;label:string}):React.ReactElement {
 const {t}=useT('common');const [src,setSrc]=React.useState('');const [failed,setFailed]=React.useState(false)
 React.useEffect(()=>{
  let active=true;setSrc('');setFailed(false)
  void window.electronAPI.readAttachment(version.generatedImage.localPath).then(data=>{if(active)setSrc(`data:${version.generatedImage.mediaType};base64,${data}`)}).catch(()=>{if(active)setFailed(true)})
  return ()=>{active=false}
 },[version.generatedImage.localPath,version.generatedImage.mediaType])
 return <figure className="min-w-0 space-y-2"><figcaption className="text-sm font-medium" title={version.imageId}>{label} · {version.imageId?.slice(0,8)}</figcaption><div className="flex min-h-40 items-center justify-center rounded-lg bg-muted/40 p-2">{failed?<p role="alert" className="text-sm text-muted-foreground">{t('imageVersion.missing')}</p>:src?<img src={src} alt={label} className="max-h-[60vh] max-w-full object-contain" onError={()=>setFailed(true)}/>:<p role="status" className="text-sm text-muted-foreground">{t('loading')}</p>}</div></figure>
}
export function ImageVersionCompare({current,parent,open,onOpenChange,returnFocus}:{current:ImageVersion;parent:ImageVersion;open:boolean;onOpenChange:(open:boolean)=>void;returnFocus:()=>void}):React.ReactElement {
 const {t}=useT('common')
 return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent onCloseAutoFocus={event=>{event.preventDefault();returnFocus()}} className="max-h-[90vh] max-w-5xl overflow-y-auto"><DialogHeader><DialogTitle>{t('imageVersion.compare')}</DialogTitle></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><VersionPreview version={parent} label={t('imageVersion.source')}/><VersionPreview version={current} label={t('imageVersion.current')}/></div><p className="text-sm text-muted-foreground">{t('imageVersion.compareNote')}</p></DialogContent></Dialog>
}
