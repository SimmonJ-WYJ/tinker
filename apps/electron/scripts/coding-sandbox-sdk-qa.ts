/** 本地模型夹具：真实 SDK 执行隔离命令，不产生上游模型费用。 */
import {createServer} from 'node:http'
import {mkdtempSync,existsSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {query} from '@anthropic-ai/claude-agent-sdk'
import {codingSandbox} from '../src/main/lib/coding-sandbox'
async function main(){
 const root=mkdtempSync(join(tmpdir(),'asci-sandbox-sdk-'));let n=0,prompts=0,resultText='',sent=0
 const outsideDir=process.env.ASCI_QA_OUTSIDE_DIR
 if(!outsideDir)throw new Error('Set ASCI_QA_OUTSIDE_DIR to a disposable directory outside the project and /tmp')
 const outside=join(outsideDir,'asci-sandbox-outside-'+process.pid)
 const commands=['echo inside > check.txt', 'node -e '+JSON.stringify("require('fs').appendFileSync('check.txt','checked')"), 'echo escape > '+JSON.stringify(outside)]
 const server=createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
 if(req.url?.includes('count_tokens')){res.end('{"input_tokens":10}');return}
 if(!req.url?.includes('messages')){res.end('{}');return}
 n++;const body=JSON.parse(raw);const run=sent<commands.length && (body.tools??[]).some((t:{name:string})=>t.name==='Bash');const command=run?commands[sent++]:undefined;console.log('model request',n,'tool',run)
 resultText+=JSON.stringify(body.messages.at(-1)?.content)
 res.writeHead(200,{'Content-Type':'text/event-stream'});const event=(type:string,data:unknown)=>res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
 event('message_start',{type:'message_start',message:{id:'msg_'+n,type:'message',role:'assistant',model:'claude-sonnet-4-5',content:[],stop_reason:null,usage:{input_tokens:10,output_tokens:0}}})
 event('content_block_start',{type:'content_block_start',index:0,content_block:run?{type:'tool_use',id:'toolu_qa_'+sent,name:'Bash',input:{}}:{type:'text',text:''}})
 event('content_block_delta',{type:'content_block_delta',index:0,delta:run?{type:'input_json_delta',partial_json:JSON.stringify({command})}:{type:'text_delta',text:'QA complete'}})
 event('content_block_stop',{type:'content_block_stop',index:0});event('message_delta',{type:'message_delta',delta:{stop_reason:run?'tool_use':'end_turn'},usage:{output_tokens:10}});event('message_stop',{type:'message_stop'});res.end()
 })});await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));const port=(server.address() as {port:number}).port
 let release=()=>{};const hold=new Promise<void>(ok=>{release=ok});const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),45000)
 try{
 const stream=query({prompt:(async function*(){yield {type:'user' as const,session_id:'',parent_tool_use_id:null,message:{role:'user' as const,content:'Run local QA'}};await hold})(),options:{pathToClaudeCodeExecutable:process.env.ASCI_QA_CLI!,cwd:root,settingSources:[],model:'claude-sonnet-4-5',stderr:line=>console.log('CLI',line.slice(0,500)),tools:['Bash'],systemPrompt:'Local fixture',permissionMode:'acceptEdits',sandbox:codingSandbox(root),maxTurns:5,abortController:abort,canUseTool:async()=>{prompts++;return {behavior:'deny',message:'Unexpected prompt'}},env:{...process.env,HOME:root,CLAUDE_CONFIG_DIR:join(root,'config'),ANTHROPIC_API_KEY:'fixture',ANTHROPIC_AUTH_TOKEN:undefined,ANTHROPIC_BASE_URL:`http://127.0.0.1:${port}`,DISABLE_TELEMETRY:'1'}}})
 for await(const msg of stream){if(msg.type==='result'){release();console.log('result',msg.subtype)}}
 const summary={prompts,commands:sent,insideWritten:existsSync(join(root,'check.txt')) && readFileSync(join(root,'check.txt'),'utf8').includes('checked'),outsideBlocked:!existsSync(outside),toolReportedDenial:/not permitted|denied|sandbox/i.test(resultText)};console.log(JSON.stringify(summary));console.log('tool response',resultText)
 if(prompts || !summary.insideWritten || !summary.outsideBlocked || !summary.toolReportedDenial)throw new Error('Sandbox contract failed')
 }finally{release();clearTimeout(timer);server.closeAllConnections();server.close();rmSync(root,{recursive:true,force:true});if(existsSync(outside))rmSync(outside)}
}
main().catch(e=>{console.error(e);process.exitCode=1})
