import {expect,test,mock} from 'bun:test'
import {preparePaperSearchRuntime} from './runtime-scope'
test('general capabilities retain user tools but never prepare the scientific Python environment',async()=>{
 const servers:Record<string,unknown>={'paper-search':{},'custom-tool':{name:'mine'}}
 const sync=mock(async()=>{throw new Error('must not run')})
 await preparePaperSearchRuntime(servers,{scientific:false,hasSession:true},sync)
 expect(sync).not.toHaveBeenCalled();expect(servers['paper-search']).toBeUndefined();expect(servers['custom-tool']).toEqual({name:'mine'})
})
test('scientific session waits for its required environment; unbound discovery does not install it',async()=>{
 const servers={'paper-search':{}}
 const sync=mock(async()=>{})
 await preparePaperSearchRuntime(servers,{scientific:true,hasSession:false},sync);expect(sync).not.toHaveBeenCalled()
 await preparePaperSearchRuntime(servers,{scientific:true,hasSession:true},sync);expect(sync).toHaveBeenCalledTimes(1)
})
