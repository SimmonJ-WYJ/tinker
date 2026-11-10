import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AGENT_IPC_CHANNELS } from '@asci/shared'
import { DesktopClient } from './client.ts'
import { DesktopRouter } from './router.ts'
const roots: string[] = []; const clients: DesktopClient[] = []; const servers: { stop: (force?: boolean) => void }[] = []
afterEach(async () => { clients.splice(0).forEach(c => c.close()); servers.splice(0).forEach(s => s.stop(true)); await Bun.sleep(50); roots.splice(0).forEach(r => rmSync(r, { recursive: true, force: true })) })
const binary = process.env.TINKER_TEST_RUNTIME_BINARY ?? join(process.env.CARGO_TARGET_DIR ?? resolve(import.meta.dir, '../../../../../tinker-rust/src-tauri/target'), 'debug/tinker-runtime')
const integration = existsSync(binary) ? test : test.skip
integration('actual Rust sends Unicode/high, persists two turns, cancels/errors, and restores history after restart', async () => {
  const requests: Record<string, unknown>[] = []
  const server = createServer(async (req,res) => {
    let text = ''; for await (const chunk of req) text += chunk.toString()
    const body = JSON.parse(text) as Record<string,unknown>; requests.push(body)
    const last = (body.messages as {content:string}[]).at(-1)?.content
    if(last==='fail') { res.writeHead(500);res.end('synthetic-secret');return }
    res.writeHead(200,{'content-type':'text/event-stream'})
    res.write('data: '+JSON.stringify({choices:[{delta:{content:'你好🌱'}}]})+'\n\n')
    await Bun.sleep(last==='cancel'?1500:90)
    res.end('data: [DONE]\n\n')
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  servers.push({stop:()=>{server.closeAllConnections();server.close()}})
  const address = server.address(); if (!address || typeof address==='string') throw new Error('bind')
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tinker-desktop-preview-'))); roots.push(root)
  const config = { root, binary, profilesFile:join(root,'profiles.json'), compatHome:join(root,'electron-compat') }
  writeFileSync(config.profilesFile, JSON.stringify([{profileId:'local',label:'Local',configRevision:'r1',protocol:'openai-chat',models:[{modelId:'model/a',label:'A',supportedEfforts:['high']},{modelId:'model/b',label:'B',supportedEfforts:['high']}],endpoint:`http://127.0.0.1:${address.port}/v1/chat/completions`,key:'synthetic-secret'}]))
  const client = new DesktopClient(config); clients.push(client)
  const router = new DesktopRouter(client, config)
  expect((await router.channels())[0]?.models).toHaveLength(2)
  const session = await router.create('Synthetic', 'local')
  const events: {channel:string; payload:unknown}[] = []
  const sender = { isDestroyed:()=>false, send:(channel:string,payload:unknown)=>{events.push({channel,payload})} }
  const input = {sessionId:session.id,channelId:'local',modelId:'model/a',userMessage:'hello',taskMode:'search' as const,effort:'high' as const,startedAt:100}
  await router.send(input,sender)
  expect(events.some(e=>JSON.stringify(e).includes('text_delta'))).toBe(true)
  expect(events.filter(e=>e.channel===AGENT_IPC_CHANNELS.STREAM_COMPLETE)).toHaveLength(1)
  expect((await router.history(session.id)).sdkMessages).toHaveLength(2)
  await router.send({...input,userMessage:'second',modelId:'model/b',startedAt:200},sender)
  expect(requests.map(r=>(r.messages as unknown[]).length)).toEqual([1,3])
  expect(requests.every(r=>r.reasoning_effort==='high')).toBe(true)
  await router.send(input,sender)
  expect(requests).toHaveLength(2)
  await expect(router.send({...input,startedAt:300,taskMode:'coding'},sender)).rejects.toThrow()
  await expect(router.send({...input,startedAt:300,additionalDirectories:['/tmp']},sender)).rejects.toThrow()
  for(const userMessage of ['@file:example.txt Read it','@dir:project inspect','<attached_files>\n- test.txt: test.txt\n</attached_files>','<referenced_directory path="project">\n(empty directory)\n</referenced_directory>']) await expect(router.send({...input,startedAt:301,userMessage},sender)).rejects.toThrow()
  expect(requests).toHaveLength(2)
  await expect(router.send({...input,startedAt:400,userMessage:'fail'},sender)).rejects.toThrow()
  const pending = router.send({...input,startedAt:500,userMessage:'cancel'},sender)
  await Bun.sleep(150); await router.stop(session.id); await pending
  const history = await router.history(session.id)
  expect(history.sdkMessages).toHaveLength(9)
  expect(JSON.stringify(history)).not.toContain('synthetic-secret')
  client.close(); await Bun.sleep(150)
  const next = new DesktopClient(config); clients.push(next)
  const reopened = new DesktopRouter(next,config)
  expect(await reopened.history(session.id)).toEqual(history)
  expect(await reopened.list()).toHaveLength(1)
  const crashEvents:{channel:string;payload:unknown}[]=[]
  await expect(reopened.send({...input,startedAt:600,userMessage:'transport'}, {isDestroyed:()=>false,send:(channel,payload)=>{
    crashEvents.push({channel,payload})
    if(JSON.stringify(payload).includes('text_delta'))next.close()
  }})).rejects.toThrow()
  expect(crashEvents.some(e=>JSON.stringify(e).includes('interrupted')&&JSON.stringify(e).includes('你好🌱'))).toBe(true)
  const count=requests.length
  await Bun.sleep(150)
  const recoveredClient=new DesktopClient(config);clients.push(recoveredClient)
  const recovered=new DesktopRouter(recoveredClient,config)
  const recoveredTurns=await recovered.turns(session.id)
  expect(recoveredTurns.at(-1)?.status).toBe('interrupted')
  expect(recoveredTurns.at(-1)?.assistantMessage).toBe('你好🌱')
  expect(requests).toHaveLength(count)
},15000)
