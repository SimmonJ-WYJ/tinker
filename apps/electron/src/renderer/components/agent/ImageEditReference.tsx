/** 输入框中显式、可撤销的图片版本引用，不改写用户正文。 */
import { useAtom } from 'jotai'
import { X } from 'lucide-react'
import { imageEditDraftsAtom, clearImageEditDraft } from '@/atoms/image-edit-atoms'
import { useT } from '@/hooks/useT'
import { Button } from '@/components/ui/button'
export function ImageEditReference({sessionId}:{sessionId:string}):React.ReactElement|null {
 const {t}=useT('common');const [drafts,setDrafts]=useAtom(imageEditDraftsAtom);const selected=drafts.get(sessionId)
 if(!selected) return null
 return <div className="mx-3 mt-3 flex items-center gap-3 rounded-lg bg-muted/60 p-2" role="status"><img src={selected.previewSrc} alt={selected.generatedImage.filename} className="size-10 shrink-0 rounded object-contain"/><div className="min-w-0 flex-1"><p className="text-sm font-medium" title={selected.imageId}>{t('imageVersion.selected',{id:selected.imageId.slice(0,8)})}</p><p className="text-sm text-muted-foreground">{t('imageVersion.selectedNote')}</p></div><Button type="button" variant="ghost" size="icon-sm" aria-label={t('imageVersion.remove')} onClick={()=>setDrafts(previous=>clearImageEditDraft(previous,sessionId,selected.imageId))}><X aria-hidden="true"/></Button></div>
}
