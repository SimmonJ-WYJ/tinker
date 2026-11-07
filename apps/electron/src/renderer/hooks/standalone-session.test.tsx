import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { useCreateSession } from './useCreateSession'
import { useSyncActiveTabSideEffects } from './useSyncActiveTabSideEffects'
import { agentSessionsAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
const savedApi=window.electronAPI
afterEach(()=>{cleanup();window.electronAPI=savedApi})
test('普通新会话不继承当前项目，显式项目创建仍保留项目',async()=>{
 const store=createStore();store.set(currentAgentWorkspaceIdAtom,'project-1')
 const create=mock(async(_title?:string,_channel?:string,workspaceId?:string)=>({id:'new-session',title:'New',createdAt:0,updatedAt:0,archived:false,workspaceId}))
 window.electronAPI={createAgentSession:create,updateSettings:mock(async()=>({}))} as unknown as typeof window.electronAPI
 function Actions(){const {createAgent}=useCreateSession();return <><button onClick={()=>void createAgent()}>plain</button><button onClick={()=>void createAgent({workspaceId:'project-1'})}>project</button></>}
 render(<Provider store={store}><Actions/></Provider>)
 fireEvent.click(screen.getByRole('button',{name:'plain'}))
 await waitFor(()=>expect(create.mock.calls.length).toBe(1))
 expect(create.mock.calls[0]?.[2]).toBeUndefined()
 await waitFor(()=>expect(store.get(currentAgentWorkspaceIdAtom)).toBeNull())
 fireEvent.click(screen.getByRole('button',{name:'project'}))
 await waitFor(()=>expect(create.mock.calls.length).toBe(2))
 expect(create.mock.calls[1]?.[2]).toBe('project-1')
})
test('切回独立会话清除前一个项目上下文',async()=>{
 const store=createStore();store.set(currentAgentWorkspaceIdAtom,'project-1')
 store.set(agentSessionsAtom,[{id:'plain',title:'Plain',createdAt:0,updatedAt:0,archived:false}])
 window.electronAPI={updateSettings:mock(async()=>({}))} as unknown as typeof window.electronAPI
 function Actions(){const sync=useSyncActiveTabSideEffects();return <button onClick={()=>sync({id:'plain',type:'agent',sessionId:'plain',title:'Plain'})}>switch</button>}
 render(<Provider store={store}><Actions/></Provider>)
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'switch'}))})
 expect(store.get(currentAgentWorkspaceIdAtom)).toBeNull()
})
