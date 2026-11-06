import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { join } from 'node:path'
const app=process.env.ASCI_SLIM_APP
if(!app) throw new Error('ASCI_SLIM_APP required')
const resources=join(app,'Contents/Resources')
async function check(name:string) {
 const transport=new StdioClientTransport({command:join(resources,'runtimes/node/bin/node'),args:[join(resources,`app/dist/resources/${name}-mcp/server.cjs`)],env:{PATH:process.env.PATH??'',HOME:'/private/tmp/asci-slim-empty-home',ASCI_CONFIG_HOME:'/private/tmp/asci-slim-empty-home'},stderr:'inherit'})
 const client=new Client({name:'slim-qa',version:'1'},{capabilities:{}})
 try {
  await client.connect(transport)
  const list=await client.listTools();console.log(name,'tools:',list.tools.map(t=>t.name).join(','))
  if(name==='ocr') {
   const result=await client.callTool({name:'ocr_image',arguments:{imagePath:'/private/tmp/asci-slim-native-fixtures/ocr.png',enableCache:false}},undefined,{timeout:120_000})
   console.log('OCR MCP result:',JSON.stringify(result))
   if(result.isError || !JSON.stringify(result).includes('HELLO')) throw new Error('OCR MCP failed')
  }
 } finally {await client.close()}
}
async function main(){await check('ocr');await check('asr')}
main().catch(err=>{console.error(err);process.exitCode=1})
