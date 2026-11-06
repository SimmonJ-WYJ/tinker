import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { agentSessionDraftsAtom, agentSessionDraftHtmlAtom, agentStreamErrorsAtom, agentPendingFilesAtom, agentPendingMentionsAtom } from '@/atoms/agent-atoms'
import { imageEditDraftsAtom } from '@/atoms/image-edit-atoms'
import { sendRecoveryDraftsAtom, captureSendDraft, forgetSendDraftAtom } from '@/atoms/send-recovery-atoms'
import { setAppLanguage } from '@/lib/i18n'
import { AgentFailureRecovery } from './AgentFailureRecovery'
afterEach(async()=>{cleanup();await act(async()=>{await setAppLanguage('en')})})
test('没有历史的预检失败仍显示错误，可恢复正文、富文本、附件和引用而不重发',async()=>{
 await setAppLanguage('en')
 const send=mock(async()=>{});window.electronAPI={sendAgentMessage:send} as unknown as Window['electronAPI']
 const store=createStore();const file={id:'file-1',filename:'reference.png',size:3,mediaType:'image/png',previewUrl:'blob:expired'}
 const image={imageId:'exact-image',previewSrc:'data:image/png;base64,YWJj',generatedImage:{localPath:'s/image.png',filename:'image.png',mediaType:'image/png'}}
 const draft=captureSendDraft({text:'Keep my draft',html:'<p>Keep my draft</p>',files:[file],mentions:[{id:'note',kind:'file',label:'Notes'}],image},new Map([['file-1','YWJj']]))
 store.set(sendRecoveryDraftsAtom,new Map([['s',draft]]));store.set(agentStreamErrorsAtom,new Map([['s','Key unavailable']]))
 render(<Provider store={store}><AgentFailureRecovery sessionId="s"/></Provider>)
 expect(screen.getByRole('alert')).toHaveTextContent('Key unavailable')
 expect(screen.getByText(/may already have incurred charges/)).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Restore draft'}))
 expect(store.get(agentSessionDraftsAtom).get('s')).toBe('Keep my draft')
 expect(store.get(agentSessionDraftHtmlAtom).get('s')).toBe('<p>Keep my draft</p>')
 expect(store.get(agentPendingFilesAtom)[0]?.previewUrl).toBe('data:image/png;base64,YWJj')
 expect(window.__pendingAgentFileData?.get('file-1')).toBe('YWJj')
 expect(store.get(agentPendingMentionsAtom)[0]?.label).toBe('Notes')
 expect(store.get(imageEditDraftsAtom).get('s')?.imageId).toBe('exact-image')
 expect(send).not.toHaveBeenCalled()
})
test('新草稿和其他会话不会被恢复操作覆盖；旧完成回调不能删除更新的快照',async()=>{
 await setAppLanguage('en');const store=createStore()
 const first=captureSendDraft({text:'failed',html:'',files:[],mentions:[]},new Map())
 const newer=captureSendDraft({text:'new attempt',html:'',files:[],mentions:[]},new Map())
 store.set(sendRecoveryDraftsAtom,new Map([['s',newer],['other',first]]))
 store.set(forgetSendDraftAtom,{sessionId:'s',draft:first});expect(store.get(sendRecoveryDraftsAtom).get('s')).toBe(newer)
 store.set(agentSessionDraftsAtom,new Map([['s','new unsent draft'],['other','private other draft']]))
 store.set(agentStreamErrorsAtom,new Map([['s','failure']]))
 render(<Provider store={store}><AgentFailureRecovery sessionId="s"/></Provider>)
 expect(screen.getByRole('button',{name:'Restore draft'})).toBeDisabled()
 expect(screen.getByText(/draft or reference/)).toBeInTheDocument()
 expect(store.get(agentSessionDraftsAtom).get('other')).toBe('private other draft')
 await act(async()=>{await setAppLanguage('zh')})
 expect(screen.getByRole('alert')).toHaveTextContent('请求未完成')
 expect(screen.getByRole('button',{name:'恢复草稿'})).toBeDisabled()
})

test('没有快照的传输错误仍可见；成功快照清理按会话隔离',async()=>{
 await setAppLanguage('en');const store=createStore()
 const draft=captureSendDraft({text:'done',html:'',files:[],mentions:[]},new Map())
 store.set(sendRecoveryDraftsAtom,new Map([['s',draft],['other',draft]]))
 store.set(forgetSendDraftAtom,{sessionId:'s',draft})
 expect(store.get(sendRecoveryDraftsAtom).has('s')).toBe(false)
 expect(store.get(sendRecoveryDraftsAtom).get('other')).toBe(draft)
 store.set(agentStreamErrorsAtom,new Map([['s','Transport rejected']]))
 render(<Provider store={store}><AgentFailureRecovery sessionId="s"/></Provider>)
 expect(screen.getByRole('alert')).toHaveTextContent('Transport rejected')
 expect(screen.queryByRole('button',{name:'Restore draft'})).toBeNull()
})
