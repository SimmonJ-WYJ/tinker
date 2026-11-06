import {z} from 'zod'
import {createSdkMcpServer,tool} from '@anthropic-ai/claude-agent-sdk'
import {verifyProjectHtml} from '../lib/html-preview/verify'
export function createProjectHtmlMcpServer(cwd:string) {
 return createSdkMcpServer({name:'asci-project',version:'1.0.0',tools:[
  tool('verify_html','Load a local project HTML page in isolated Chromium and fill inputs, press supported keys and click elements. Prefer this to Python/Node mock DOM scripts or starting a shell HTTP server for HTML checks. Returns actual before/after DOM text, button states and script errors. Only project files; no external network. Request screenshot:true for a rendered image. Do not claim pixel-level assertions or persistent-storage testing from this result.',{screenshot:z.boolean().optional(),path:z.string().min(1).max(4096),actions:z.array(z.object({selector:z.string().min(1).max(256),type:z.enum(["click","fill","press"]).optional(),value:z.string().max(4000).optional(),key:z.enum(["Enter","Tab","Escape","ArrowUp","ArrowDown","Space"]).optional(),count:z.number().int().min(1).max(5).optional()})).max(12).optional(),observe:z.array(z.string().min(1).max(256)).max(12).optional()},async(input)=>{
   try{const {screenshot,...result}=await verifyProjectHtml(cwd,input);return {...(result.errors.length?{isError:true}:{}),content:[{type:'text' as const,text:JSON.stringify(result)},...(screenshot?[{type:'image' as const,data:screenshot,mimeType:'image/png'}]:[])]}}
   catch(err){return {isError:true,content:[{type:'text' as const,text:JSON.stringify({error:err instanceof Error?err.message:String(err),next:'Explain the failed check accurately. Do not replace actual-browser verification with simulated DOM success claims.'})}]}}
  }),
 ]})
}
