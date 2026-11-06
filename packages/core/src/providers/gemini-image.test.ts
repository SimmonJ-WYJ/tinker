import { expect, test } from 'bun:test'
import { buildGeminiImageRequest, parseGeminiImage } from './gemini-image.ts'
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
test('Gemini 原生请求按顺序传真实参考图，不发往 OpenAI 端点', () => {
 const request=buildGeminiImageRequest('https://relay.test','key','custom-gemini','change pose',[{data:png,mime:'image/png'},{data:'second',mime:'image/jpeg'}])
 expect(request.url).toBe('https://relay.test/v1beta/interactions')
 expect(request.headers['x-goog-api-key']).toBe('key')
 expect(JSON.parse(request.body).input).toEqual([{type:'text',text:'change pose'},{type:'image',data:png,mime_type:'image/png'},{type:'image',data:'second',mime_type:'image/jpeg'}])
 expect(parseGeminiImage({output_image:{data:png,mime_type:'image/png'}}).mimeType).toBe('image/png')
 expect(()=>parseGeminiImage({output_image:{data:'not-image'}})).toThrow()
})

test('Gemini generateContent 与步骤响应均可解析实际图片', () => {
 const request=buildGeminiImageRequest('https://relay.test/v1','key','models/test-image','保留姿势',[{data:png,mime:'image/png'}],'gemini-content')
 expect(request.url).toBe('https://relay.test/v1beta/models/test-image:generateContent')
 expect(JSON.parse(request.body).contents[0].parts[1].inlineData.data).toBe(png)
 expect(parseGeminiImage({candidates:[{content:{parts:[{inlineData:{data:png}}]}}]}).mimeType).toBe('image/png')
 expect(parseGeminiImage({steps:[{type:'model_output',content:[{type:'image',data:png}]}]}).mimeType).toBe('image/png')
 expect(()=>parseGeminiImage({candidates:[]})).toThrow()
})
