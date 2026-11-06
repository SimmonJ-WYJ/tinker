import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { Channel } from '@asci/shared'
import { channelsAtom, channelsLoadedAtom } from '@/atoms/channels-atoms'
import { setAppLanguage } from '@/lib/i18n'
import { ModelSelector } from './ModelSelector'
const channels = [
 {id:'a',name:'Relay A',provider:'custom-openai',enabled:true,models:[{id:'same',name:'Shared model',enabled:true}]},
 {id:'b',name:'Relay B',provider:'anthropic',enabled:true,models:[{id:'same',name:'Shared model',enabled:true},{id:'off',name:'Disabled model',enabled:false}]},
 {id:'image',name:'Image relay',provider:'custom-image',enabled:true,models:[{id:'image-model',name:'Image model',enabled:true}]},
] as Channel[]
afterEach(cleanup)
test('显示实际选中渠道，搜索不改变选择，保留推理与管理入口，生图渠道不混入聊天选择', async()=>{
 await setAppLanguage('en')
 window.electronAPI={listChannels:mock(async()=>channels)} as unknown as Window['electronAPI']
 const store=createStore();store.set(channelsAtom,channels);store.set(channelsLoadedAtom,true)
 const select=mock(()=>{})
 await act(async()=>{render(<Provider store={store}><ModelSelector externalSelectedModel={{channelId:'b',modelId:'same'}} onModelSelect={select} reasoning={{title:'Reasoning',current:'deep',options:[{value:'deep',label:'Deep'}],onSelect:()=>{}}}/></Provider>)})
 const trigger=screen.getByRole('button',{name:/Shared model.*Relay B/})
 await act(async()=>{fireEvent.pointerDown(trigger,{button:0,ctrlKey:false,pointerType:'mouse'})})
 const search=screen.getByRole('textbox',{name:'Search models or channels'})
 expect(search).toHaveFocus()
 fireEvent.keyDown(search,{key:'ArrowDown'})
 expect(screen.getAllByRole('menuitem',{name:/Shared model/})[0]).toHaveFocus()
 act(()=>{search.focus()})

 fireEvent.change(search,{target:{value:'Relay A'}})
 expect(screen.getByRole('menuitem',{name:/Shared model/})).toBeInTheDocument()
 expect(screen.getByText('Reasoning')).toBeInTheDocument()
 expect(screen.getByText('Manage channels & models')).toBeInTheDocument()
 expect(screen.getByText(/Image relay/)).toBeInTheDocument()
 expect(screen.queryByRole('menuitem',{name:'Image model'})).toBeNull()
 expect(select).not.toHaveBeenCalled()
 fireEvent.change(search,{target:{value:'not-found'}})
 expect(screen.getByText('No models found')).toBeInTheDocument()
 fireEvent.change(search,{target:{value:'Relay A'}})
 fireEvent.click(screen.getByRole('menuitem',{name:/Shared model/}))
 expect(select).toHaveBeenCalledWith(expect.objectContaining({channelId:'a',modelId:'same'}))
})

test('渠道过滤和已禁用模型仍受尊重，中文搜索与未知信息说明可见', async()=>{
 await setAppLanguage('zh')
 const configured=[...channels,{...channels[0]!,id:'disabled',enabled:false}]
 window.electronAPI={listChannels:mock(async()=>configured)} as unknown as Window['electronAPI']
 const store=createStore();store.set(channelsAtom,configured);store.set(channelsLoadedAtom,true)
 await act(async()=>{render(<Provider store={store}><ModelSelector filterChannelIds={['b']} externalSelectedModel={{channelId:'b',modelId:'same'}} onModelSelect={()=>{}}/></Provider>)})
 await act(async()=>{fireEvent.pointerDown(screen.getByRole('button',{name:/Shared model.*Relay B/}),{button:0,ctrlKey:false,pointerType:'mouse'})})
 expect(screen.getByRole('textbox',{name:'搜索模型或渠道'})).toBeInTheDocument()
 expect(screen.queryByText('Relay A · 聊天渠道')).toBeNull()
 expect(screen.getByText('Relay B · 聊天渠道')).toBeInTheDocument()
 expect(screen.queryByRole('menuitem',{name:'Disabled model'})).toBeNull()
 expect(screen.getByText(/其他能力与价格尚未核实/)).toBeInTheDocument()
 cleanup()
 await act(async()=>{await setAppLanguage('en')})
})
