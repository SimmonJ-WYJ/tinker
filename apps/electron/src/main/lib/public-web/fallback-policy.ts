import type { HookCallback } from '@anthropic-ai/claude-agent-sdk'
export const READ_ONLY_LOOKUP_REASON='This is an ordinary public web lookup. Use mcp__asci-web__search/fetch instead of terminal network scripts. If public sources are blocked, report that limitation; do not request repeated terminal approvals.'
export function denyLookupShellFallback(message:string,mode:'search'|'coding'|undefined,tool:string,input:Record<string,unknown>):boolean {
 if(mode==='coding' || tool!=='Bash' || typeof input.command!=='string')return false
 if(/(?:用|使用|通过|运行|执行).{0,16}(?:python|bash|curl|wget|脚本)|(?:写|编写).{0,5}脚本|\b(?:use|using|run|execute|write|implement)\s+(?:a\s+)?(?:python|bash|curl|wget|script)/i.test(message))return false
 return /\b(?:curl|wget)\b|urllib|urlopen|requests\.(?:get|post|request)|httpx\.|https?\.request|\bfetch\s*\(/i.test(input.command)
}
export function createLookupShellGuard(message:string,mode:'search'|'coding'|undefined):HookCallback {
 return async(input)=>{
  if(input.hook_event_name!=='PreToolUse')return {}
  const toolInput=input.tool_input && typeof input.tool_input==='object' ? input.tool_input as Record<string,unknown>:{}
  if(!denyLookupShellFallback(message,mode,input.tool_name,toolInput))return {}
  return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:READ_ONLY_LOOKUP_REASON}}
 }
}
