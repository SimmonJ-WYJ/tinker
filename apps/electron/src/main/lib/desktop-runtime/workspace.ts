/** 兼容层在调用会创建路径的旧 helper 前验证工作区边界。 */
import {lstatSync,realpathSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {getConfigDirName} from '../config-paths.ts'
import {ensureDefaultWorkspace,listAgentWorkspaces} from '../agent-workspace-manager.ts'
export function isPreviewWorkspace(slug:unknown,compatHome:string,knownSlugs:string[]):slug is string {
  if(typeof slug!=='string' || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(slug) || !knownSlugs.includes(slug))return false
  try {
    const configDir=join(compatHome,getConfigDirName())
    const parent=join(configDir,'agent-workspaces')
    return [compatHome,configDir,parent,join(parent,slug)].every(path=>{
      const stat=lstatSync(path)
      return stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(path)===path
    })
  } catch { return false }
}

const failIndex:()=>never=()=>{throw new Error('DESKTOP_WORKSPACE_INDEX')}
const record=(value:unknown):value is Record<string,unknown>=>value!==null && typeof value==='object' && !Array.isArray(value)
function checkExistingDirectory(path:string):void {
  const stat=lstatSync(path,{throwIfNoEntry:false})
  if(stat && (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path)!==path))failIndex()
}
/** 旧 readIndex 会迁移、恢复备份并创建目录；所有候选必须先通过无写入预检。 */
function assertPreviewWorkspaceIndex(compatHome:string):void {
  if(process.env.ASCI_CONFIG_HOME!==compatHome)failIndex()
  const configDir=join(compatHome,getConfigDirName()),workspaceRoot=join(configDir,'agent-workspaces')
  for(const directory of [compatHome,configDir,workspaceRoot])checkExistingDirectory(directory)
  for(const suffix of ['', '.tmp', '.bak']) {
    const path=join(configDir,'agent-workspaces.json'+suffix)
    const stat=lstatSync(path,{throwIfNoEntry:false})
    if(!stat)continue
    if(!stat.isFile() || stat.nlink!==1 || stat.size>1024*1024 || (stat.mode & 0o022)!==0 || realpathSync(path)!==path)failIndex()
    let value:unknown
    try {value=JSON.parse(readFileSync(path,'utf8'))}catch {failIndex()}
    if(!record(value) || Object.keys(value).sort().join()!=='version,workspaces' || value.version!==2 || !Array.isArray(value.workspaces) || value.workspaces.length>128)failIndex()
    const slugs=new Set<string>(),ids=new Set<string>()
    for(const workspace of value.workspaces) {
      if(!record(workspace) || Object.keys(workspace).sort().join()!=='createdAt,id,name,slug,updatedAt')failIndex()
      const {id,name,slug,createdAt,updatedAt}=workspace
      if(typeof id!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || typeof name!=='string' || name.length>1024 || typeof slug!=='string' || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(slug))failIndex()
      if(typeof createdAt!=='number' || !Number.isSafeInteger(createdAt) || createdAt<0 || typeof updatedAt!=='number' || !Number.isSafeInteger(updatedAt) || updatedAt<0 || slugs.has(slug) || ids.has(id))failIndex()
      slugs.add(slug);ids.add(id)
      checkExistingDirectory(join(workspaceRoot,slug))
    }
  }
}
export function initializePreviewWorkspace(compatHome:string):void {
  assertPreviewWorkspaceIndex(compatHome)
  ensureDefaultWorkspace()
}
export function listPreviewWorkspaces(compatHome:string):ReturnType<typeof listAgentWorkspaces> {
  assertPreviewWorkspaceIndex(compatHome)
  return listAgentWorkspaces()
}
