/** Coding 智能审批的执行边界：项目内运行，无法隔离时禁止回退。 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { SandboxSettings } from '@anthropic-ai/claude-agent-sdk'
export function codingSandbox(cwd:string):SandboxSettings {
 return {
  enabled:true, failIfUnavailable:true, autoAllowBashIfSandboxed:true,
  allowUnsandboxedCommands:false,
  network:{allowedDomains:[],deniedDomains:['*'],allowLocalBinding:false,allowAllUnixSockets:false},
  filesystem:{
   allowWrite:[cwd],
   denyWrite:['.git','.agents','.codex','.aws'].map(name=>join(cwd,name)),
   denyRead:['.ssh','.aws','.asci/channels.json','.asci-dev/channels.json'].map(name=>join(homedir(),name)),
  },
 }
}
