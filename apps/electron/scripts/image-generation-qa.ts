import { app } from 'electron'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
async function main() {
app.setName('ASCI')
app.on('window-all-closed',()=>{})
await app.whenReady()
process.env.ASCI_CONFIG_HOME=mkdtempSync(join(tmpdir(),'asci-image-qa-'))
const {createChannel}=await import('../src/main/lib/channel-manager.ts')
const {createImageGenerationMcpServer}=await import('../src/main/mcp/image-generation-tool.ts')
const {resolveAttachmentPath}=await import('../src/main/lib/config-paths.ts')
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII='
let requests=0;let correct=false;let editCorrect=false
const server=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;requests++;if(req.url==='/v1/images/edits'){editCorrect=editCorrect||String(req.headers['content-type']).includes('multipart/form-data')&&raw.includes('name="image[]"')&&raw.indexOf('first.png')<raw.indexOf('second.png')}else{const body=JSON.parse(raw);correct=req.url==='/v1/images/generations'&&body.model==='gpt-image-2-o'&&body.n===1&&!body.messages;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{b64_json:png}]}))})
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
const address=server.address();if(!address||typeof address==='string')throw Error('address')
createChannel({name:'QA image',provider:'custom-image',baseUrl:`http://127.0.0.1:${address.port}`,apiKey:'disposable-qa-key',enabled:true,models:[{id:'gpt-image-2-o',name:'Image',enabled:true}]})
const refs=mkdtempSync(join(tmpdir(),'asci-refs-'));writeFileSync(join(refs,'first.png'),Buffer.from(png,'base64'));writeFileSync(join(refs,'second.png'),Buffer.from(png,'base64'));
const sdk=createImageGenerationMcpServer('qa-session',refs)!; const client=new Client({name:'qa',version:'1'})
const [a,b]=InMemoryTransport.createLinkedPair()
await Promise.all([sdk.instance.connect(b),client.connect(a)])
try {
 const tools=await client.listTools();const result=await client.callTool({name:'generate_image',arguments:{prompt:'A blue circle'}})
 const text=(result.content as Array<{type:string;text?:string}>).find(item=>item.type==='text')?.text??''
 const artifact=JSON.parse(text).generatedImage
 const persisted=readFileSync(resolveAttachmentPath(artifact.localPath)).toString('base64')===png
 const editResult=await client.callTool({name:'generate_image',arguments:{prompt:'Keep first style, use second pose',model:'gpt-image-2-o',referenceImagePaths:[join(refs,'first.png'),join(refs,'second.png')]}})
 const listing=await client.callTool({name:'list_images',arguments:{}})
 const entries=JSON.parse((listing.content as Array<{text:string}>)[0]!.text).images
 const viewed=await client.callTool({name:'inspect_image',arguments:{imageId:'latest'}})
 if(viewed.isError||entries.length!==2)throw Error('Image registry or inspection failed')
 await client.close();await sdk.instance.close()
 const rebuilt=createImageGenerationMcpServer('qa-session',refs)!
 const [c,d]=InMemoryTransport.createLinkedPair()
 await Promise.all([rebuilt.instance.connect(d),client.connect(c)])
 const continued=await client.callTool({name:'generate_image',arguments:{prompt:'More whitespace',baseImageId:'latest'}})
 if(continued.isError)throw Error('Persisted image continuation failed')
 const before=requests;const unavailable=await client.callTool({name:'generate_image',arguments:{prompt:'x',model:'unavailable-model'}});
 if(editResult.isError||!editCorrect||!unavailable.isError||requests!==before)throw Error('Reference edit or exact-model QA failed');
 console.log(JSON.stringify({persistedContinuation:true,inspection:true,editCorrect,exactModelRejectedWithoutRequest:requests===before,toolRegistered:tools.tools.some(tool=>tool.name==='generate_image'),requests,correctEndpointAndPayload:correct,success:!result.isError,persisted,localPath:artifact.localPath}))
 if(!persisted||!correct||result.isError)throw Error('image QA failed')
} finally {await client.close();await sdk.instance.close();server.close();app.quit()}

}
void main().catch(error=>{console.error(error);app.exit(1)})
