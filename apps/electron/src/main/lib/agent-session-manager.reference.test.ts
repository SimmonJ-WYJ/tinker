/** 独立子进程与临时配置目录验证真实 JSONL，避免访问用户资料或污染模块缓存。 */
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

test('引用写入真实 JSONL 后跨进程重开仍绑定同一来源，旧数据与普通上传不被改写', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'tinker-reference-jsonl-'))
  const env = { ...process.env, ASCI_CONFIG_HOME: configHome, ASCI_DEV: '1', CLAUDE_CONFIG_DIR: join(configHome, 'sdk') }
  const moduleUrl = new URL('./agent-session-manager.ts', import.meta.url).href
  const pathsUrl = new URL('./config-paths.ts', import.meta.url).href
  try {
    const first = execFileSync('bun', ['-e', `
      import { appendSDKMessages, getAgentSessionSDKMessages } from ${JSON.stringify(moduleUrl)};
      import { getAgentSessionMessagesPath } from ${JSON.stringify(pathsUrl)};
      import { readFileSync } from 'node:fs';
      const ref = {imageId:'image-a',localPath:'qa-session/image-a.png',filename:'image-a.png',mediaType:'image/png'};
      const source = [{type:'assistant',uuid:'source-a',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'call-a',name:'mcp__asci-image__generate_image',input:{}}]}},{type:'user',parent_tool_use_id:null,message:{content:[{type:'tool_result',tool_use_id:'call-a',content:JSON.stringify({imageId:ref.imageId,generatedImage:ref})}]}}];
      appendSDKMessages('qa-session',source);
      const before=readFileSync(getAgentSessionMessagesPath('qa-session'),'utf8');
      appendSDKMessages('qa-session',[{type:'user',uuid:'reply',parent_tool_use_id:null,imageEditReference:{...ref,sourceMessageId:'old-id'},message:{content:[{type:'text',text:'Edit this.'}]}},{type:'user',uuid:'upload-only',parent_tool_use_id:null,message:{content:[{type:'text',text:'<attached_files>\\n- upload.png: qa-session/upload.png\\n</attached_files>\\nUse this.'}]}}]);
      if(!readFileSync(getAgentSessionMessagesPath('qa-session'),'utf8').startsWith(before))throw Error('历史被改写');
      console.log('PERSISTED:'+JSON.stringify(getAgentSessionSDKMessages('qa-session')));
    `], { env, encoding: 'utf8' })
    const second = execFileSync('bun', ['-e', `import {getAgentSessionSDKMessages} from ${JSON.stringify(moduleUrl)};console.log('PERSISTED:'+JSON.stringify(getAgentSessionSDKMessages('qa-session')))`], { env, encoding: 'utf8' })
    const parse = (value: string): Array<{uuid?:string;imageEditReference?:{sourceMessageId?:string}}> => JSON.parse(value.split('PERSISTED:')[1]!)
    expect(parse(second)).toEqual(parse(first))
    expect(parse(second).find(message => message.uuid === 'reply')?.imageEditReference?.sourceMessageId).toBe('source-a')
    expect(parse(second).find(message => message.uuid === 'upload-only')?.imageEditReference).toBeUndefined()
  } finally { rmSync(configHome, { recursive: true, force: true }) }
})


test('硬停止事实只追加一次，清除会话标记和继续发送不会丢失原回合状态', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'tinker-stopped-jsonl-'))
  try {
    const moduleUrl = new URL('./agent-session-manager.ts', import.meta.url).href
    const output = execFileSync('bun', ['-e', `
      import {createAgentSession,appendSDKMessages,updateAgentSessionMeta,getAgentSessionSDKMessages} from ${JSON.stringify(moduleUrl)};
      const session=createAgentSession('Synthetic stop test');
      appendSDKMessages(session.id,[{type:'assistant',uuid:'stopped-assistant',message:{content:[{type:'tool_use',id:'pending',name:'mcp__asci-image__generate_image',input:{}}]}}]);
      updateAgentSessionMeta(session.id,{stoppedByUser:true});
      updateAgentSessionMeta(session.id,{stoppedByUser:true});
      updateAgentSessionMeta(session.id,{stoppedByUser:false});
      appendSDKMessages(session.id,[{type:'user',parent_tool_use_id:null,message:{content:[{type:'text',text:'Next request'}]}}]);
      console.log('HISTORY:'+JSON.stringify(getAgentSessionSDKMessages(session.id)));
    `], {env:{...process.env,ASCI_CONFIG_HOME:configHome,ASCI_DEV:'1',CLAUDE_CONFIG_DIR:join(configHome,'sdk')},encoding:'utf8'})
    const history=JSON.parse(output.split('HISTORY:')[1]!) as Array<{type:string;subtype?:string}>
    expect(history.map(message=>message.type)).toEqual(['assistant','system','user'])
    expect(history[1]?.subtype).toBe('asci_turn_stopped')
  } finally {rmSync(configHome,{recursive:true,force:true})}
})
