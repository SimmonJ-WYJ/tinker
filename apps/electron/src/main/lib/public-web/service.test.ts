import {test,expect,mock} from 'bun:test'
import {createPublicWebHandlers} from './service'
test('same search and source read are deduplicated including concurrent calls',async()=>{
 const get=mock(async(url:string)=>({url,contentType:'text/xml',body:'<item><title>Example</title><link>https://example.com/</link><description>Source</description></item>'}))
 const h=createPublicWebHandlers(get)
 await Promise.all([h.search(' Tesla  news '),h.search('tesla news')]);expect(get).toHaveBeenCalledTimes(1)
 await h.fetch('https://example.com/#a');await h.fetch('https://example.com/#b');expect(get).toHaveBeenCalledTimes(2)
})
test('failed source is not retried and failure budget stops network escalation',async()=>{
 const get=mock(async()=>{throw new Error('HTTP 403')});const h=createPublicWebHandlers(get)
 expect((await h.fetch('https://a.example.com/')).isError).toBe(true)
 await h.fetch('https://a.example.com/');expect(get).toHaveBeenCalledTimes(1)
 await h.fetch('https://b.example.com/');const result=await h.search('other query')
 expect(get).toHaveBeenCalledTimes(2);expect(result.content[0]?.text).toContain('Stop repeated retries')
})
test('source text is bounded and attribution is preserved',async()=>{
 const h=createPublicWebHandlers(async(url)=>({url,contentType:'text/plain',body:'x'.repeat(20000)}))
 const result=await h.fetch('https://example.com/')
 const data=JSON.parse(result.content[0]!.text);expect(data.content.length).toBe(16000);expect(data.truncated).toBe(true);expect(data.url).toBe('https://example.com/')
})

test('targeted refinements can continue past three queries, with a finite cap', async () => {
 const get=mock(async(url:string)=>({url,contentType:'text/xml',body:'<item><title>Example</title><link>https://example.com/</link><description>Source</description></item>'}))
 const h=createPublicWebHandlers(get)
 for(let i=0;i<6;i++) expect((await h.search(`query ${i}`)).isError).not.toBe(true)
 expect((await h.search('query seven')).isError).toBe(true)
 expect(get).toHaveBeenCalledTimes(6)
})
test('a successful source resets consecutive failures', async () => {
 const h=createPublicWebHandlers(async(url:string)=>{if(url.includes('blocked'))throw new Error('403');return {url,contentType:'text/plain',body:'verified text'}})
 await h.fetch('https://blocked.example/1')
 expect((await h.fetch('https://good.example/')).isError).not.toBe(true)
 await h.fetch('https://blocked.example/2')
 expect((await h.fetch('https://another.example/')).isError).not.toBe(true)
})
