/** 单次真实输出检查：仅向用户已配置的渠道发送固定测试文本，不打印密钥。 */
import {app,safeStorage} from 'electron'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {homedir,tmpdir} from 'node:os'
import {query} from '@anthropic-ai/claude-agent-sdk'
app.setName('@asci/electron')
app.whenReady().then(async()=>{
 const root=mkdtempSync(join(tmpdir(),'asci-live-output-'));let release=()=>{};const hold=new Promise<void>(ok=>{release=ok});const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),60000)
 try{
 const config=JSON.parse(readFileSync(join(homedir(),'.asci/channels.json'),'utf8')) as {channels:{name:string;provider:string;apiKey:string;baseUrl:string;enabled:boolean}[]}
 const channel=config.channels.find(c=>c.enabled && c.name==='SF CC' && c.provider==='anthropic')
 if(!channel)throw new Error('Configured Anthropic channel unavailable')
 const key=safeStorage.decryptString(Buffer.from(channel.apiKey,'base64'))
 const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('ANTHROPIC_'))delete env[k]
 Object.assign(env,{ANTHROPIC_API_KEY:key,ANTHROPIC_BASE_URL:channel.baseUrl,CLAUDE_CONFIG_DIR:join(root,'config'),DISABLE_TELEMETRY:'1',CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS:'1'})
 let answer='',success=false
 const stream=query({prompt:(async function*(){yield {type:'user' as const,session_id:'',parent_tool_use_id:null,message:{role:'user' as const,content:'Reply exactly ASCI_OUTPUT_OK. Do not use tools.'}};await hold})(),options:{pathToClaudeCodeExecutable:process.env.ASCI_QA_CLI!,cwd:root,model:'claude-opus-4-8',systemPrompt:'Reply to the user briefly.',tools:[],settingSources:[],maxTurns:1,abortController:abort,env}})
 for await(const message of stream){if(message.type==='assistant')for(const block of message.message.content)if(block.type==='text')answer+=block.text;if(message.type==='result'){success=message.subtype==='success';release()}}
 console.log(JSON.stringify({channel:channel.name,model:'claude-opus-4-8',success,answer,nonEmpty:answer.trim().length>0}))
 if(!success||!answer.trim())throw new Error('No successful text reply')
 app.exit(0)
 }catch(e){console.error(e instanceof Error?e.message:'Output test failed');app.exit(1)}finally{release();clearTimeout(timer);rmSync(root,{recursive:true,force:true})}
})
