import { Provider, createStore } from 'jotai'
import { imageEditDraftsAtom } from '@/atoms/image-edit-atoms'
import { agentSessionDraftsAtom } from '@/atoms/agent-atoms'
import { ImageEditReference } from './ImageEditReference'
import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GeneratedImage } from './GeneratedImage.tsx'
import { setAppLanguage } from '@/lib/i18n'
afterEach(async () => { cleanup(); await act(async () => { await setAppLanguage('en') }) })
test('actual loaded dimensions and billing limits are shown in both languages', async () => {
 await setAppLanguage('en')
 window.electronAPI = {readAttachment:mock(async ()=>'cG5n'),saveImageAs:mock(async()=>{})} as unknown as Window['electronAPI']
 const result=JSON.stringify({referenceCount:1,generatedImage:{localPath:'session-1/image-1.png',filename:'generated.png',mediaType:'image/png'}})
 render(<GeneratedImage result={result} />)
 const image=await screen.findByRole('img')
 expect(screen.queryByText(/1254 × 1254/)).toBeNull()
 Object.defineProperty(image,'naturalWidth',{value:1254})
 Object.defineProperty(image,'naturalHeight',{value:1254})
 fireEvent.load(image)
 expect(screen.getByText('Actual dimensions: 1254 × 1254 px')).toBeInTheDocument()
 expect(screen.getByText(/Original dimensions.*not guaranteed/)).toBeInTheDocument()
 expect(screen.getByText(/Check your relay bill/)).toBeInTheDocument()
 await act(async () => { await setAppLanguage('zh') })
 await waitFor(()=>expect(screen.getByText(/实际尺寸.*1254 × 1254/)).toBeInTheDocument())
 expect(screen.getByText(/中转账单/)).toBeInTheDocument()
})
test('生成图片读取本地附件并可保存，拒绝外部及穿越路径', async () => {
 await setAppLanguage('en')
 const read = mock(async (_path:string) => 'cG5n')
 const save = mock(async () => {})
 window.electronAPI = {readAttachment:read,saveImageAs:save} as unknown as Window['electronAPI']
 const image = {localPath:'session-1/image-1.png',filename:'generated.png',mediaType:'image/png'}
 const view = render(<GeneratedImage result={JSON.stringify({generatedImage:image})} />)
 await waitFor(()=>expect(screen.getByRole('img')).toBeInTheDocument())
 fireEvent.click(screen.getByRole('button',{name:/^Save$/}))
 expect(save).toHaveBeenCalledWith(image.localPath,image.filename)
 view.rerender(<GeneratedImage result={JSON.stringify({generatedImage:{...image,localPath:'../../secret.png'}})} />)
 expect(screen.queryByRole('img')).toBeNull()
 expect(read).toHaveBeenCalledTimes(1)
})
test('生图卡片展示真实渠道模型与参考图数，中英文可读', async () => {
 window.electronAPI = {readAttachment:mock(async ()=>'cG5n'),saveImageAs:mock(async()=>{})} as unknown as Window['electronAPI']
 const result=JSON.stringify({model:'configured-image',channelName:'My channel',referenceCount:2,generatedImage:{localPath:'session-1/image-1.png',filename:'generated.png',mediaType:'image/png'}})
 await setAppLanguage('en')
 const view=render(<GeneratedImage result={result} />)
 await waitFor(()=>expect(screen.getByText(/configured-image · My channel · 2 reference images/)).toBeInTheDocument())
 await act(async () => { await setAppLanguage('zh') })
 await waitFor(()=>expect(screen.getByText(/2 张参考图/)).toBeInTheDocument())
 view.unmount()
})
test('图片文件缺失时保留明确提示和禁用操作，不再悄悄消失',async()=>{
 await setAppLanguage('en')
 window.electronAPI={readAttachment:mock(async()=>{throw Error('missing')}),saveImageAs:mock(async()=>{})} as unknown as Window['electronAPI']
 render(<GeneratedImage result={JSON.stringify({imageId:'image-1',generatedImage:{localPath:'session-1/image-1.png',filename:'generated.png',mediaType:'image/png'}})} />)
 expect(await screen.findByRole('alert')).toHaveTextContent('unavailable')
 expect(screen.getByRole('button',{name:'Edit from this image'})).toBeDisabled()
 expect(screen.getByRole('button',{name:'Save'})).toBeDisabled()
})
test('选择确定版本仅回填当前会话引用，保留草稿且不发送，可移除',async()=>{
 await setAppLanguage('en')
 const send=mock(async()=>{});const store=createStore()
 store.set(agentSessionDraftsAtom,new Map([['session-1','Keep this draft']]))
 window.electronAPI={readAttachment:mock(async()=>'cG5n'),saveImageAs:mock(async()=>{}),sendAgentMessage:send} as unknown as Window['electronAPI']
 const result=JSON.stringify({imageId:'version-first',generatedImage:{localPath:'session-1/image-1.png',filename:'generated.png',mediaType:'image/png'}})
 await act(async()=>{render(<Provider store={store}><GeneratedImage result={result} sessionId="session-1"/><ImageEditReference sessionId="session-1"/></Provider>)})
 expect(screen.getByRole('button',{name:'Edit from this image'})).toBeEnabled()
 fireEvent.click(screen.getByRole('button',{name:'Edit from this image'}))
 expect(store.get(imageEditDraftsAtom).get('session-1')?.imageId).toBe('version-first')
 expect(store.get(agentSessionDraftsAtom).get('session-1')).toBe('Keep this draft')
 expect(send).not.toHaveBeenCalled()
 expect(screen.getByText('Editing version version-')).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Remove image reference'}))
 expect(store.get(imageEditDraftsAtom).has('session-1')).toBe(false)
})
test('对比读取明确父版本，不使用另一张最近图片；父文件缺失可见',async()=>{
 await setAppLanguage('en')
 const read=mock(async(path:string)=>{if(path.endsWith('parent.png'))throw Error('missing parent');return 'cG5n'})
 window.electronAPI={readAttachment:read,saveImageAs:mock(async()=>{})} as unknown as Window['electronAPI']
 const parent={imageId:'parent-version',generatedImage:{localPath:'session-1/parent.png',filename:'parent.png',mediaType:'image/png'}}
 const current={imageId:'child-version',baseImageId:'parent-version',generatedImage:{localPath:'session-1/child.png',filename:'child.png',mediaType:'image/png'}}
 const latest={imageId:'unrelated-latest',generatedImage:{localPath:'session-1/latest.png',filename:'latest.png',mediaType:'image/png'}}
 await act(async()=>{render(<GeneratedImage result={JSON.stringify(current)} versions={[parent,current,latest]} sessionId="session-1"/>)})
 expect(screen.getByRole('button',{name:'Edit from this image'})).toBeEnabled()
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Compare versions'}))})
 expect(screen.getByRole('dialog')).toBeInTheDocument()
 expect(screen.getByRole('alert')).toHaveTextContent('unavailable')
 expect(read.mock.calls.some(([path])=>path.endsWith('parent.png'))).toBe(true)
 expect(read.mock.calls.some(([path])=>path.endsWith('latest.png'))).toBe(false)
})

test('image and billing details start collapsed and expand while actions stay available', async () => {
 await setAppLanguage('en')
 window.electronAPI={readAttachment:mock(async()=>'cG5n'),saveImageAs:mock(async()=>{})} as unknown as Window['electronAPI']
 const result=JSON.stringify({imageId:'child-version',baseImageId:'missing-parent',model:'configured-image',channelName:'My channel',referenceCount:2,generatedImage:{localPath:'session-1/image.png',filename:'generated.png',mediaType:'image/png'}})
 render(<GeneratedImage result={result} sessionId="session-1" />)
 await screen.findByRole('img')
 const summary=screen.getByText('Image and billing details')
 const details=summary.closest('details')!
 expect(details).not.toBeNull()
 expect(details.open).toBe(false)
 expect(details).toContainElement(screen.getByText(/configured-image · My channel · 2 reference images/))
 expect(details).toContainElement(screen.getByText(/Original dimensions.*not guaranteed/))
 expect(details).toContainElement(screen.getByText(/Check your relay bill/))
 const parentWarning=screen.getByText(/source version.*unavailable/i)
 expect(details).not.toContainElement(parentWarning)
 expect(screen.getByRole('button',{name:'Edit from this image'})).toBeEnabled()
 expect(screen.getByRole('button',{name:'Save'})).toBeEnabled()
 expect(screen.getByRole('button',{name:'Compare versions'})).toBeDisabled()
 fireEvent.click(summary)
 expect(details.open).toBe(true)
 await act(async()=>{await setAppLanguage('zh')})
 expect(screen.getByText('图片与费用详情')).toBeInTheDocument()
 expect(details.open).toBe(true)
})

test('missing file warning remains outside collapsed image details', async () => {
 await setAppLanguage('en')
 window.electronAPI={readAttachment:mock(async()=>{throw Error('missing')}),saveImageAs:mock(async()=>{})} as unknown as Window['electronAPI']
 render(<GeneratedImage result={JSON.stringify({imageId:'image-1',generatedImage:{localPath:'session-1/image.png',filename:'generated.png',mediaType:'image/png'}})} />)
 const warning=await screen.findByRole('alert')
 const details=screen.getByText('Image and billing details').closest('details')!
 expect(details.open).toBe(false)
 expect(details).not.toContainElement(warning)
 expect(screen.getByRole('button',{name:'Edit from this image'})).toBeDisabled()
 expect(screen.getByRole('button',{name:'Save'})).toBeDisabled()
})
