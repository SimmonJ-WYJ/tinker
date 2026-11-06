import {test,expect} from 'bun:test'
import {validatePublicUrl,isPublicAddress,parseSearchRss,pageText} from './transport'
test('only public global addresses are accepted',()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.2','100.64.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1'])expect(isPublicAddress(ip)).toBe(false)
 for(const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])expect(isPublicAddress(ip)).toBe(true)
})
test('URL and DNS checks reject credentials, local networks and rebinding candidates',async()=>{
 const publicDns=async()=>[{address:'1.1.1.1',family:4}]
 for(const url of ['file:///etc/passwd','http://example.com','https://a:b@example.com','https://example.com:8443','https://example.com/?api_key=secret']) await expect(validatePublicUrl(url,publicDns)).rejects.toThrow()
 await expect(validatePublicUrl('https://example.com',async()=>[{address:'127.0.0.1',family:4}])).rejects.toThrow()
 await expect(validatePublicUrl('https://example.com',async()=>[{address:'1.1.1.1',family:4},{address:'10.0.0.1',family:4}])).rejects.toThrow()
 expect((await validatePublicUrl('https://example.com/path',publicDns)).address).toBe('1.1.1.1')
})
test('RSS sources remain attributed and page output omits scripts/styles',()=>{
 const results=parseSearchRss('<rss><item><title>A &amp; B</title><link>https://example.com/x</link><description>Example</description></item></rss>')
 expect(results).toEqual([{title:'A & B',url:'https://example.com/x',snippet:'Example'}])
 expect(pageText('<style>secret css</style><script>alert(1)</script><p>Hello &amp; world</p>')).toBe('Hello & world')
})

test('Fake-IP uses authenticated public resolution; private DNS is never reinterpreted as public',async()=>{
 const {resolveForPublicRequest}=await import('./transport')
 let calls=0;const doh=async()=>{calls++;return [{address:'1.1.1.1',family:4}]}
 const fake=await resolveForPublicRequest('example.com',async()=>[{address:'198.18.0.2',family:4}],doh)
 expect(fake[0]?.address).toBe('1.1.1.1');expect(calls).toBe(1)
 const local=await resolveForPublicRequest('example.com',async()=>[{address:'10.0.0.2',family:4}],doh)
 expect(local[0]?.address).toBe('10.0.0.2');expect(calls).toBe(1)
})
