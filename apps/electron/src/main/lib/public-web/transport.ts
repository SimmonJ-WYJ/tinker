import { BlockList, isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
const privateV4=new BlockList()
for(const [ip,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) privateV4.addSubnet(ip,prefix,'ipv4')
const globalV6=new BlockList();globalV6.addSubnet('2000::',3,'ipv6')
const reservedV6=new BlockList();reservedV6.addSubnet('2001::',23,'ipv6');reservedV6.addSubnet('2001:db8::',32,'ipv6');reservedV6.addSubnet('2002::',16,'ipv6');reservedV6.addSubnet('3fff::',20,'ipv6')
export function isPublicAddress(ip:string):boolean {
 if(isIP(ip)===4)return !privateV4.check(ip,'ipv4')
 if(isIP(ip)===6)return globalV6.check(ip,'ipv6') && !reservedV6.check(ip,'ipv6')
 return false
}
type Address={address:string;family:number}
export async function validatePublicUrl(value:string,resolve:(host:string)=>Promise<Address[]>=host=>lookup(host,{all:true,verbatim:true})) {
 const url=new URL(value)
 if(value.length>4096 || url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443'))throw new Error('Only public HTTPS URLs on port 443 without credentials are supported')
 for(const key of url.searchParams.keys()) if(/^(?:api[_-]?key|access[_-]?token|authorization|password|secret|token|signature)$/i.test(key)) throw new Error('Credential-bearing URLs are not supported by public web reading')
 const host=url.hostname.replace(/^\[|\]$/g,'')
 if(!host.includes('.') && !isIP(host) || /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(host))throw new Error('Local addresses are not supported')
 const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await resolve(host)
 if(!addresses.length || addresses.some(a=>!isPublicAddress(a.address)))throw new Error('Private or non-global network addresses are not supported')
 url.hash=''
 return {url,host,...addresses[0]!}
}
const fakeIpRange=new BlockList();fakeIpRange.addSubnet('198.18.0.0',15,'ipv4')
export async function resolveForPublicRequest(host:string,systemResolve:(host:string)=>Promise<Address[]>,publicResolve:(host:string)=>Promise<Address[]>):Promise<Address[]> {
 const addresses=await systemResolve(host)
 // TUN/Fake-IP DNS is not an origin address. Resolve it through authenticated
 // public DoH, then pin the returned public address; never allow Fake-IP directly.
 if(addresses.length && addresses.every(a=>isIP(a.address)===4 && fakeIpRange.check(a.address,'ipv4'))) return publicResolve(host)
 return addresses
}
const publicDnsCache=new Map<string,{expires:number;addresses:Address[]}>()
async function publicDns(host:string):Promise<Address[]> {
 const hit=publicDnsCache.get(host);if(hit && hit.expires>Date.now())return hit.addresses
 const url=new URL('https://cloudflare-dns.com/dns-query');url.searchParams.set('name',host);url.searchParams.set('type','A')
 const response=await publicGet(url.href,0,async()=>[{address:'1.1.1.1',family:4}],'application/dns-json')
 const data=JSON.parse(response.body) as {Answer?:Array<{type:number;data:string}>}
 const addresses=(data.Answer??[]).filter(a=>a.type===1).map(a=>({address:a.data,family:4}))
 if(!addresses.length || addresses.some(a=>!isPublicAddress(a.address)))throw new Error('Public DNS returned no usable public address')
 if(publicDnsCache.size>256)publicDnsCache.clear()
 publicDnsCache.set(host,{expires:Date.now()+300000,addresses});return addresses
}
async function systemResolve(host:string):Promise<Address[]> {
 let timer:ReturnType<typeof setTimeout>|undefined
 try {return await Promise.race([lookup(host,{all:true,verbatim:true}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('DNS lookup timed out')),8000)})])} finally {clearTimeout(timer)}
}
async function boundedResolve(host:string):Promise<Address[]> {return resolveForPublicRequest(host,systemResolve,publicDns)}
export async function publicGet(value:string,hops=0,resolve:(host:string)=>Promise<Address[]>=boundedResolve,accept='text/html,application/json,application/rss+xml,application/xml,text/plain;q=0.9'):Promise<{url:string;body:string;contentType:string}> {
 if(hops>3)throw new Error('Too many redirects')
 const target=await validatePublicUrl(value,resolve)
 // Pin the validated address on the actual connection. Redirects are validated again.
 const response=await new Promise<{status:number;location?:string;body:string;contentType:string}>((resolve,reject)=>{
  let settled=false
  const timer=setTimeout(()=>req.destroy(new Error('Public web request timed out')),15_000)
  const done=(error?:Error,result?:{status:number;location?:string;body:string;contentType:string})=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(result!)}
  const req=request(target.url,{method:'GET',family:target.family,agent:false,
   lookup:(_host,_options,cb)=>cb(null,target.address,target.family),
   headers:{'User-Agent':'Mozilla/5.0 (compatible; ASCI/0.1; public-web-reader)','Accept':accept,'Accept-Encoding':'identity'},
  },res=>{
   const status=res.statusCode??0
   if(status>=300 && status<400){res.destroy();done(undefined,{status,location:res.headers.location,body:'',contentType:''});return}
   if(status<200 || status>=300){res.destroy();done(new Error(`Public source returned HTTP ${status}`));return}
   const contentType=String(res.headers['content-type']??'text/plain')
   if(!/(?:text\/|json|xml)/i.test(contentType)){res.destroy();done(new Error('Source is not an HTML, text, XML or JSON page'));return}
   if(res.headers['content-encoding'] && res.headers['content-encoding']!=='identity'){res.destroy();done(new Error('Source requires an unsupported content encoding'));return}
   const chunks:Buffer[]=[];let bytes=0
   res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>2*1024*1024){req.destroy(new Error('Public page exceeds 2 MiB limit'));return}chunks.push(chunk)})
   res.on('error',err=>done(err));res.on('aborted',()=>done(new Error('Source closed the response early')))
   res.on('end',()=>done(undefined,{status,body:Buffer.concat(chunks).toString('utf8'),contentType}))
  })
  req.on('error',err=>done(err));req.end()
 })
 if(response.status>=300 && response.status<400){if(!response.location)throw new Error('Redirect without Location');return publicGet(new URL(response.location,target.url).href,hops+1,resolve,accept)}
 return {url:target.url.href,body:response.body,contentType:response.contentType}
}
function entities(text:string):string {
 return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(whole,code:string)=>{
  if(code.startsWith('#')){const n=code[1]?.toLowerCase()==='x'?parseInt(code.slice(2),16):parseInt(code.slice(1),10);return n>0 && n<=0x10ffff?String.fromCodePoint(n):whole}
  return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '} as Record<string,string>)[code.toLowerCase()]??whole
 })
}
export function pageText(html:string):string {
 return entities(html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim()
}
export function parseSearchRss(xml:string) {
 return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0,8).flatMap(match=>{
  const field=(name:string)=>entities(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,'i').exec(match[1]!)?.[1]??'').trim()
  const url=field('link');if(!url.startsWith('https://'))return []
  return [{title:pageText(field('title')),url,snippet:pageText(field('description')).slice(0,1000)}]
 })
}
