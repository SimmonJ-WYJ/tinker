import {afterEach,expect,test} from 'bun:test'
import {mkdtempSync,realpathSync,mkdirSync,symlinkSync,rmSync,writeFileSync,readFileSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {getConfigDirName} from '../config-paths.ts'
import {isPreviewWorkspace,initializePreviewWorkspace,listPreviewWorkspaces} from './workspace.ts'
const roots:string[]=[]
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
test('corrupt index membership cannot authorize traversal or linked workspace directories',()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'tinker-workspace-test-')));roots.push(root)
 const home=join(root,'compat'),parent=join(home,getConfigDirName(),'agent-workspaces'),outside=join(root,'outside')
 mkdirSync(join(parent,'default'),{recursive:true});mkdirSync(outside)
 expect(isPreviewWorkspace('default',home,['default'])).toBe(true)
 for(const slug of ['../../outside','/outside','..','a/b','a%2fb',''])expect(isPreviewWorkspace(slug,home,[slug])).toBe(false)
 symlinkSync(outside,join(parent,'linked'))
 expect(isPreviewWorkspace('linked',home,['linked'])).toBe(false)
 expect(isPreviewWorkspace('unknown',home,['default'])).toBe(false)
})

test.each(['','1'])('actual default workspace and effort config remain contained with ASCI_DEV=%s',async mode=>{
 const home=realpathSync(mkdtempSync(join(tmpdir(),'tinker-workspace-real-')));roots.push(home)
 const priorHome=process.env.ASCI_CONFIG_HOME,priorDev=process.env.ASCI_DEV
 process.env.ASCI_CONFIG_HOME=home;process.env.ASCI_DEV=mode
 try {
  const {getWorkspaceReasoningEffort,setWorkspaceReasoningEffort}=await import('../agent-workspace-manager.ts')
  const {getAgentWorkspacePath}=await import('../config-paths.ts')
  initializePreviewWorkspace(home)
  const workspace=listPreviewWorkspaces(home)[0]!
  expect(getAgentWorkspacePath(workspace.slug)).toBe(join(home,mode==='1'?'.asci-dev':'.asci','agent-workspaces','default'))
  expect(isPreviewWorkspace(workspace.slug,home,listPreviewWorkspaces(home).map(w=>w.slug))).toBe(true)
  setWorkspaceReasoningEffort(workspace.slug,'low');expect(getWorkspaceReasoningEffort(workspace.slug)).toBe('low')
  setWorkspaceReasoningEffort(workspace.slug,'high');expect(getWorkspaceReasoningEffort(workspace.slug)).toBe('high')
 } finally {
  if(priorHome===undefined)delete process.env.ASCI_CONFIG_HOME;else process.env.ASCI_CONFIG_HOME=priorHome
  if(priorDev===undefined)delete process.env.ASCI_DEV;else process.env.ASCI_DEV=priorDev
 }
})

test.each(['','1'])('preview rejects reused v1 before legacy migration can touch owned sibling (ASCI_DEV=%s)',mode=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'tinker-workspace-migration-')));roots.push(root)
 const home=join(root,'preview','compat'),outside=join(root,'owned-sibling')
 const priorHome=process.env.ASCI_CONFIG_HOME,priorDev=process.env.ASCI_DEV
 process.env.ASCI_CONFIG_HOME=home;process.env.ASCI_DEV=mode
 try {
  const configDir=join(home,getConfigDirName());mkdirSync(configDir,{recursive:true});mkdirSync(outside)
  const indexPath=join(configDir,'agent-workspaces.json'),sentinel=join(outside,'sentinel.txt')
  const raw=JSON.stringify({version:1,workspaces:[{id:'unsafe',name:'synthetic',slug:'../../../../owned-sibling',createdAt:1,updatedAt:1}]})
  writeFileSync(indexPath,raw,{mode:0o600});writeFileSync(sentinel,'synthetic sentinel')
  expect(()=>initializePreviewWorkspace(home)).toThrow()
  expect(readFileSync(indexPath,'utf8')).toBe(raw)
  expect(readFileSync(sentinel,'utf8')).toBe('synthetic sentinel')
  expect(existsSync(join(outside,'skills'))).toBe(false)
  expect(existsSync(join(outside,'skills-inactive'))).toBe(false)
  expect(()=>listPreviewWorkspaces(home)).toThrow()
  expect(readFileSync(indexPath,'utf8')).toBe(raw)
 } finally {
  if(priorHome===undefined)delete process.env.ASCI_CONFIG_HOME;else process.env.ASCI_CONFIG_HOME=priorHome
  if(priorDev===undefined)delete process.env.ASCI_DEV;else process.env.ASCI_DEV=priorDev
 }
})

test.each(['v1','future','malformed','traversal','oversized','backup','temporary'])('preview preflights index candidate before legacy read: %s',kind=>{
 const home=realpathSync(mkdtempSync(join(tmpdir(),'tinker-workspace-index-')));roots.push(home)
 const priorHome=process.env.ASCI_CONFIG_HOME;process.env.ASCI_CONFIG_HOME=home
 try {
  const dir=join(home,getConfigDirName());mkdirSync(dir)
  const suffix=kind==='backup'?'.bak':kind==='temporary'?'.tmp':''
  const path=join(dir,'agent-workspaces.json'+suffix)
  const workspace={id:'default',name:'synthetic',slug:kind==='traversal'?'../escape':'default',createdAt:1,updatedAt:1}
  const raw=kind==='malformed'?'{broken':kind==='oversized'?' '.repeat(1024*1024+1):JSON.stringify({version:kind==='future'?3:['v1','backup','temporary'].includes(kind)?1:2,workspaces:[workspace]})
  writeFileSync(path,raw,{mode:0o600})
  expect(()=>listPreviewWorkspaces(home)).toThrow()
  expect(readFileSync(path,'utf8')).toBe(raw)
  expect(existsSync(join(dir,'agent-workspaces'))).toBe(false)
 } finally {if(priorHome===undefined)delete process.env.ASCI_CONFIG_HOME;else process.env.ASCI_CONFIG_HOME=priorHome}
})
