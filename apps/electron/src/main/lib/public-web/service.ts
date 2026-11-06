import { publicGet, parseSearchRss, pageText } from './transport'
type Getter=typeof publicGet
export function createPublicWebHandlers(get:Getter=publicGet) {
 const cache=new Map<string,Promise<ReturnType<typeof success>|ReturnType<typeof failure>>>()
 let searches=0,fetches=0,failures=0
 const success=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}]})
 const failure=(message:string)=>({isError:true,content:[{type:'text' as const,text:JSON.stringify({code:'PUBLIC_WEB_UNAVAILABLE',message,next:'Do not retry blocked endpoints with Bash, Python or curl. Try another public source within the remaining budget, or explain the source limitation honestly.'})}]})
 const memo=(key:string,run:()=>Promise<unknown>)=>{
  const old=cache.get(key);if(old)return old
  const pending=(async()=>{
   if(failures>=2)return failure('Two public-source attempts failed in this run. Stop repeated retries and report the limitation.')
   try{const value=await run();failures=0;return success(value)}catch(err){failures++;return failure(err instanceof Error?err.message:String(err))}
  })();cache.set(key,pending);return pending
 }
 return {
  search:(query:string)=>{
   const text=query.trim().replace(/\s+/g,' ')
   return memo(`search:${text.toLowerCase()}`,async()=>{
    if(!text || text.length>500)throw new Error('Search query must contain 1–500 characters')
    if(++searches>6)throw new Error('Enough search queries have been attempted. Summarize verified findings and disclose missing coverage; do not expose internal counters to the user.')
    const url=new URL('https://www.bing.com/search');url.searchParams.set('format','rss');url.searchParams.set('q',text)
    const response=await get(url.href);const results=parseSearchRss(response.body)
    if(!results.length)throw new Error('Search source returned no usable HTTPS results')
    return {query:text,source:response.url,fetchedAt:new Date().toISOString(),results}
   })
  },
  fetch:(value:string)=>{
   let key=value;try{const u=new URL(value);u.hash='';key=u.href}catch{ /* Transport will reject invalid URLs. */ }
   return memo(`fetch:${key}`,async()=>{
    if(++fetches>10)throw new Error('Enough source pages have been attempted. Summarize the evidence collected and disclose unavailable sources.')
    const response=await get(value)
    const text=/json/i.test(response.contentType)?response.body:pageText(response.body)
    return {url:response.url,fetchedAt:new Date().toISOString(),contentType:response.contentType,content:text.slice(0,16000),truncated:text.length>16000,untrustedContent:true}
   })
  },
 }
}
