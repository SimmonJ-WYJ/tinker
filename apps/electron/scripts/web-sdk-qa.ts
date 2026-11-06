import {createServer} from 'node:http'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {query} from '@anthropic-ai/claude-agent-sdk'
import {createLookupShellGuard} from '../src/main/lib/public-web/fallback-policy'
import {createPublicWebMcpServer} from '../src/main/mcp/public-web-tool'
let requests=0,calls=0,hasWeb=false,hasNative=false,bashSent=false,guardDenied=false
const text=(data:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(data)}]})
const web=createPublicWebMcpServer({search:async()=>{calls++;return text({results:[{title:'Fixture',url:'https://example.com',snippet:'Public source fixture'}]})},fetch:async()=>text({content:'fixture'})})
async function main(){
 const home=mkdtempSync(join(tmpdir(),'asci-sdk-web-'))
 const server=createServer((req,res)=>{
  let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
   if(req.url?.includes('count_tokens')){res.setHeader('Content-Type','application/json');res.end('{"input_tokens":10}');return}
   if(!req.url?.includes('messages')){res.end('{}');return}
   const body=JSON.parse(raw);console.log('Mock request',JSON.stringify({stream:body.stream,maxTokens:body.max_tokens,last:body.messages?.slice(-1)?.[0]?.content}).slice(0,500));requests++
   hasWeb ||= (body.tools??[]).some((t:{name:string})=>t.name==='mcp__asci-web__search')
   hasNative ||= (body.tools??[]).some((t:{name:string})=>t.name==='WebSearch'||t.name==='WebFetch')
   const bash=process.env.ASCI_WEB_QA_TRY_BASH==='1' && calls>0 && !bashSent
   if(bash)bashSent=true
   const tool=calls===0 && (body.tools??[]).some((t:{name:string})=>t.name==='mcp__asci-web__search')
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'})
   const event=(type:string,data:unknown)=>res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
   event('message_start',{type:'message_start',message:{id:`msg_${requests}`,type:'message',role:'assistant',model:'claude-sonnet-4-5',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}})
   event('content_block_start',{type:'content_block_start',index:0,content_block:(tool||bash)?{type:'tool_use',id:bash?'toolu_bash':'toolu_search',name:bash?'Bash':'mcp__asci-web__search',input:{}}:{type:'text',text:''}})
   event('content_block_delta',{type:'content_block_delta',index:0,delta:(tool||bash)?{type:'input_json_delta',partial_json:JSON.stringify(bash?{command:'python -c "import urllib.request; urllib.request.urlopen(\'https://example.com\')"'}:{query:'Tesla'})}:{type:'text_delta',text:'Verified public search fixture.'}})
   event('content_block_stop',{type:'content_block_stop',index:0})
   event('message_delta',{type:'message_delta',delta:{stop_reason:(tool||bash)?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:10}})
   event('message_stop',{type:'message_stop'});res.end()
  })
 })
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 const port=(server.address() as {port:number}).port
 const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),45000)
 let prompts=0,completed=false
 let releaseInput:()=>void=()=>{};const keepInputOpen=new Promise<void>(resolve=>{releaseInput=resolve})
 try{
  const stream=query({prompt:(async function*(){yield {type:'user' as const,session_id:'',parent_tool_use_id:null,message:{role:'user' as const,content:'Search Tesla once with the provided host web tool.'}};await keepInputOpen})(),options:{
   pathToClaudeCodeExecutable:process.env.ASCI_WEB_QA_CLI!,cwd:home,model:'claude-sonnet-4-5',systemPrompt:'Test host web tool execution.',settingSources:[],tools:['Read','Bash','WebSearch','WebFetch'],disallowedTools:['WebSearch','WebFetch'],allowedTools:['mcp__asci-web__search','mcp__asci-web__fetch'],mcpServers:{'asci-web':web},permissionMode:'acceptEdits',hooks:{PreToolUse:[{matcher:'*',hooks:[createLookupShellGuard('search Tesla stock news','search')]}]},maxTurns:4,abortController:abort,
   canUseTool:async()=>{prompts++;return {behavior:'deny' as const,message:'Unexpected approval'}},
   env:{...process.env,HOME:home,CLAUDE_CONFIG_DIR:join(home,'config'),ANTHROPIC_API_KEY:'local-fixture-only',ANTHROPIC_AUTH_TOKEN:undefined,ANTHROPIC_BASE_URL:`http://127.0.0.1:${port}`,CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS:'1',DISABLE_TELEMETRY:'1'},
  }})
  for await(const message of stream) {if(message.type==='assistant') console.log('Assistant',JSON.stringify(message.message.content).slice(0,500));if(message.type==='user') {const content=JSON.stringify(message.message.content);guardDenied ||= content.includes('ordinary public web lookup');console.log('Tool result',content.slice(0,400))}if(message.type==='result'){completed=message.subtype==='success';releaseInput();console.log('SDK result',message.subtype)}}
  console.log(JSON.stringify({hasWeb,hasNative,hostToolCalls:calls,approvalPrompts:prompts,requests,completed,bashSent,guardDenied}))
  if(!hasWeb || hasNative || calls!==1 || prompts!==0 || !completed || (process.env.ASCI_WEB_QA_TRY_BASH==='1' && !guardDenied))throw new Error('Host web SDK contract failed')
 }finally{releaseInput();clearTimeout(timeout);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
main().catch(err=>{console.error(err);process.exitCode=1})
