import {afterEach,expect,test} from 'bun:test'
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,symlinkSync,linkSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {isPreviewResourceAllowed} from './resources.ts'
const roots:string[]=[]
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function fixture(){
 const home=realpathSync(mkdtempSync(join(tmpdir(),'tinker-resource-test-')));roots.push(home)
 const root=join(home,'preview'),dist=join(home,'dist'),outside=join(home,'outside')
 for(const dir of [join(root,'deliverables','s'),join(dist,'renderer'),join(dist,'resources'),outside])mkdirSync(dir,{recursive:true})
 writeFileSync(join(outside,'sentinel.txt'),'synthetic outside sentinel')
 writeFileSync(join(root,'deliverables','s','owned.txt'),'synthetic owned content')
 writeFileSync(join(dist,'renderer','index.html'),'synthetic renderer')
 return {root,dist,outside}
}
test('trusted assets are allowed; all deliverables and nested links are denied',()=>{
 const {root,dist,outside}=fixture();const files=join(root,'deliverables','s')
 const allows=(path:string)=>isPreviewResourceAllowed(pathToFileURL(path).href,dist)
 expect(allows(join(files,'owned.txt'))).toBe(false)
 expect(allows(join(dist,'renderer','index.html'))).toBe(true)
 symlinkSync(outside,join(files,'nested'))
 symlinkSync(join(outside,'sentinel.txt'),join(files,'symlink.txt'))
 linkSync(join(outside,'sentinel.txt'),join(files,'hardlink.txt'))
 for(const path of [join(files,'nested','sentinel.txt'),join(files,'symlink.txt'),join(files,'hardlink.txt'),join(outside,'sentinel.txt')])expect(allows(path)).toBe(false)
})
test('encoded traversal, invalid encoded separators, missing paths and linked static assets fail closed',()=>{
 const {root,dist,outside}=fixture();const base=pathToFileURL(join(root,'deliverables','s')).href
 for(const suffix of ['/../../../outside/sentinel.txt','/%2e%2e/%2e%2e/%2e%2e/outside/sentinel.txt','/%2foutside','/%5coutside','/missing.txt','/%00'])expect(isPreviewResourceAllowed(base+suffix,dist)).toBe(false)
 symlinkSync(outside,join(dist,'resources','linked'))
 expect(isPreviewResourceAllowed(pathToFileURL(join(dist,'resources','linked','sentinel.txt')).href,dist)).toBe(false)
 expect(isPreviewResourceAllowed('https://example.invalid/sentinel',dist)).toBe(false)
})
