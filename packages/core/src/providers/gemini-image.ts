/** Gemini 原生生图适配；协议由渠道明确配置，不按模型别名猜测。 */
import { parseGeneratedImage } from './image-response.ts'
import { validateCustomEndpoint } from './custom-providers.ts'
import type { ProviderRequest } from './types.ts'
export function geminiImageBaseUrl(baseUrl: string): string {
 validateCustomEndpoint(baseUrl)
 const root=baseUrl.trim().replace(/\/+$/, '').replace(/\/v1(?:beta)?$/, '')
 return `${root}/v1beta`
}
export function buildGeminiImageRequest(baseUrl:string,key:string,model:string,prompt:string,images:Array<{data:string;mime:string}>, protocol: 'gemini-interactions' | 'gemini-content' = 'gemini-interactions'): ProviderRequest {
 const base=geminiImageBaseUrl(baseUrl)
 const headers={'Content-Type':'application/json','x-goog-api-key':key}
 if(protocol==='gemini-content') return {
  url:`${base}/models/${encodeURIComponent(model.replace(/^models\//,''))}:generateContent`, headers,
  body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt},...images.map(image=>({inlineData:{mimeType:image.mime,data:image.data}}))]}],generationConfig:{responseModalities:['TEXT','IMAGE']}}),
 }
 return {url:`${base}/interactions`,headers:{...headers,'Api-Revision':'2026-05-20'},body:JSON.stringify({model,input:[{type:'text',text:prompt},...images.map(image=>({type:'image',data:image.data,mime_type:image.mime}))],response_format:{type:'image'}})}
}
export function parseGeminiImage(body:unknown): {data:string;mimeType:string} {
 const response=body as {output_image?:{data?:unknown};steps?:Array<{type?:string;content?:Array<{type?:string;data?:unknown}>}>;candidates?:Array<{content?:{parts?:Array<{thought?:boolean;inlineData?:{data?:unknown}}>}}>}
 const direct=response?.output_image?.data
 const steps=response?.steps?.filter(step=>step.type==='model_output').flatMap(step=>step.content ?? []).filter(block=>block.type==='image')
 const parts=response?.candidates?.[0]?.content?.parts?.filter(part=>!part.thought && part.inlineData)
 const data=direct ?? steps?.at(-1)?.data ?? parts?.at(-1)?.inlineData?.data
 return parseGeneratedImage({data:[{b64_json:data}]})
}
