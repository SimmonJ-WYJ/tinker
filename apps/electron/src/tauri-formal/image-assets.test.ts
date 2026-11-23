import { expect, test } from 'bun:test'
import { createNativeImageAssets } from './image-assets'

const name = 'img-' + 'a'.repeat(32) + '.png'
const path = 'session-a/' + name
const limit = 256 * 1024
const bytes = new Uint8Array(limit + 19)
bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,10,0,0,0,12])
const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), n=>n.toString(16).padStart(2,'0')).join('')
const chunk = (offset: number) => ({offset,totalBytes:bytes.length,sha256:digest,data:Buffer.from(bytes.slice(offset,offset+limit)).toString('base64')})
test('thumbnail and original are independent; ranges are sequential and pinned to one digest', async () => {
  const calls: unknown[][]=[]
  const thumb=Buffer.from(bytes.slice(0,33)).toString('base64')
  const assets=createNativeImageAssets(async (channel,...args)=>{
    calls.push([channel,...args])
    return channel==='agent:read-image-thumbnail'?thumb:chunk(Number(args[2]))
  })
  expect(await assets.thumbnail(path)).toBe(thumb)
  expect(calls).toEqual([['agent:read-image-thumbnail','session-a',name]])
  const blob=await assets.original(path,new AbortController().signal)
  expect(blob.type).toBe('image/png')
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes)
  expect(calls.slice(1)).toEqual([['agent:read-image-range','session-a',name,0,limit],['agent:read-image-range','session-a',name,limit,limit,digest]])
})
test('ranges reject foreign paths, malformed receipts, changed identity, corruption and aborted views', async()=>{
  const ctrl=new AbortController()
  for(const bad of [{data:''},{data:'AAAA'},{offset:1},{totalBytes:8*1024*1024+1},{sha256:'x'}]) {
    const assets=createNativeImageAssets(async()=>({...chunk(0),...bad}))
    await expect(assets.original(path,ctrl.signal)).rejects.toThrow()
  }
  for(const part of [{totalBytes:bytes.length+1},{sha256:'f'.repeat(64)},{data:Buffer.alloc(19,1).toString('base64')}]) {
    const assets=createNativeImageAssets(async(_,...args)=>args[2]===0?chunk(0):({...chunk(limit),...part}))
    await expect(assets.original(path,ctrl.signal)).rejects.toThrow()
  }
  const calls:unknown[]=[]
  const assets=createNativeImageAssets(async(...args)=>{calls.push(args);ctrl.abort();return chunk(0)})
  await expect(assets.original('../session-a/'+name,ctrl.signal)).rejects.toThrow()
  await expect(assets.original(path,ctrl.signal)).rejects.toThrow()
  expect(calls).toHaveLength(1)
})

test('two original transfers can compare concurrently; cancelling a queued selection consumes no native reads',async()=>{
  const names=Array.from({length:3},(_,i)=> 'sid/img-'+String(i+1).repeat(32)+'.png')
  const calls:unknown[][]=[]
  const release:(()=>void)[]=[]
  const assets=createNativeImageAssets(async(ch,...args)=>{
    calls.push([ch,...args])
    if(args[2]===0) await new Promise<void>(resolve=>release.push(resolve))
    return chunk(Number(args[2]))
  })
  const controllers=names.map(()=>new AbortController())
  const tasks=names.map((name,i)=>assets.original(name,controllers[i]!.signal))
  await Promise.resolve()
  const initial=calls.length
  controllers[2]!.abort()
  const cancelled=Promise.allSettled(tasks)
  for(const finish of release) finish()
  expect((await cancelled).map(r=>r.status)).toEqual(['fulfilled','fulfilled','rejected'])
  expect(initial).toBe(2)
  expect(calls.some(([, ,name])=>name===names[2]!.split('/')[1])).toBe(false)
})

test('a restored history with forty images loads every thumbnail, coalescing repeats within four active reads', async () => {
  let active = 0
  let peak = 0
  const calls: unknown[][] = []
  const data = Buffer.from(bytes.slice(0, 33)).toString('base64')
  const assets = createNativeImageAssets(async (...args) => {
    calls.push(args)
    peak = Math.max(peak, ++active)
    await new Promise(resolve => setTimeout(resolve, 1))
    active--
    return data
  })
  const paths = Array.from({length:40}, (_,i) => 'sid/img-'+i.toString(16).padStart(32,'0')+'.png')
  const loaded = await Promise.all([...paths,...paths].map(path => assets.thumbnail(path)))
  expect(loaded).toEqual(Array(80).fill(data))
  expect(calls).toHaveLength(40)
  expect(peak).toBe(4)
  expect(calls.every(([channel]) => channel === 'agent:read-image-thumbnail')).toBe(true)
})

test('rejects an oversized thumbnail and an original above the shared decoded pixel limit', async () => {
  const hugeThumb = new Uint8Array(bytes.slice(0, 33))
  new DataView(hugeThumb.buffer).setUint32(16, 257)
  const assets = createNativeImageAssets(async () => Buffer.from(hugeThumb).toString('base64'))
  await expect(assets.thumbnail(path)).rejects.toThrow('invalidImageFile')
  const hugeOriginal = new Uint8Array(bytes.slice(0, 33))
  new DataView(hugeOriginal.buffer).setUint32(16, 4096)
  new DataView(hugeOriginal.buffer).setUint32(20, 4096)
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',hugeOriginal)),n=>n.toString(16).padStart(2,'0')).join('')
  const original = createNativeImageAssets(async () => ({
    offset:0, data:Buffer.from(hugeOriginal).toString('base64'),sha256:sha,totalBytes:hugeOriginal.length,
  }))
  await expect(original.original(path,new AbortController().signal)).rejects.toThrow('invalidImageFile')
})
