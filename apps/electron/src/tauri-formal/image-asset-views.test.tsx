import {afterEach, expect, mock, spyOn, test} from 'bun:test'
import {act, cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react'
import {createStore, Provider} from 'jotai'
import {GeneratedImage} from '../renderer/components/agent/GeneratedImage'
import {ImageLightbox} from '../renderer/components/ui/image-lightbox'
import {imageEditDraftsAtom} from '../renderer/atoms/image-edit-atoms'
import {setAppLanguage} from '../renderer/lib/i18n'

const original=window.__TAURI_FORMAL__
const previousApi=window.electronAPI
const file='img-'+'a'.repeat(32)+'.png'
const path='qa/'+file
afterEach(()=>{cleanup();window.__TAURI_FORMAL__=original;window.electronAPI=previousApi;mock.restore()})
function marker(read:(path:string,signal:AbortSignal)=>Promise<Blob>) {
  const thumbnail=mock(async()=> 'cG5n')
  const original=mock(read)
  const legacy=mock(async()=>{throw Error('unexpected full attachment')})
  window.electronAPI={...previousApi,readAttachment:legacy}
  window.__TAURI_FORMAL__={hydrated(){},imageAssets:{thumbnail,original}}
  const create=spyOn(URL,'createObjectURL').mockImplementation(()=> 'blob:owned-original')
  const release=spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
  return {thumbnail,original,legacy,create,release}
}
test('browsing and selecting an image use only its thumbnail; each opened original is released on close',async()=>{
  await setAppLanguage('en')
  const f=marker(async()=>new Blob(['full']))
  const store=createStore()
  const result=JSON.stringify({imageId:file.slice(0,-4),generatedImage:{localPath:path,filename:file,mediaType:'image/png'}})
  render(<Provider store={store}><GeneratedImage sessionId="qa" result={result}/></Provider>)
  const card=await screen.findByRole('img',{name:file})
  expect(card).toHaveAttribute('src','data:image/png;base64,cG5n')
  fireEvent.click(screen.getByRole('button',{name:'Edit from this image'}))
  expect(store.get(imageEditDraftsAtom).get('qa')?.previewSrc).toBe('data:image/png;base64,cG5n')
  expect(f.original).not.toHaveBeenCalled()
  for(let n=1;n<=2;n++){
    fireEvent.click(card)
    const dialog=await screen.findByRole('dialog')
    await waitFor(()=>expect(within(dialog).getByRole('img')).toHaveAttribute('src','blob:owned-original'))
    expect(f.original).toHaveBeenCalledTimes(n)
    fireEvent.click(within(dialog).getByRole('button',{name:'Close'}))
    await waitFor(()=>expect(f.release).toHaveBeenCalledTimes(n))
  }
  expect(f.thumbnail).toHaveBeenCalledTimes(1)
  expect(f.legacy).not.toHaveBeenCalled()
})
test('switching away during a read aborts it, ignores its late bytes and never opens the next session’s original',async()=>{
  let done!: (b:Blob)=>void
  const f=marker(()=>new Promise(resolve=>{done=resolve}))
  const closed=mock(()=>{})
  const view=render(<ImageLightbox localPath={path} src="data:image/png;base64,cG5n" alt="owned" open onOpenChange={closed}/>)
  expect(f.original).toHaveBeenCalledTimes(1)
  const signal = f.original.mock.calls[0]![1]
  view.rerender(<ImageLightbox localPath={'other/'+file} src="data:image/png;base64,cG5n" alt="other" open onOpenChange={closed}/>)
  expect(closed).toHaveBeenCalledWith(false)
  expect(signal.aborted).toBe(true)
  await act(async()=>{done(new Blob(['stale']))})
  expect(f.original).toHaveBeenCalledTimes(1)
  expect(f.create).not.toHaveBeenCalled()
  expect(screen.queryByRole('img')).toBeNull()
})
