import { expect, test } from 'bun:test'
import { parseGeneratedImage } from './image-response.ts'
import { buildCustomProbe } from './custom-providers.ts'
import { getProfile } from './profile-registry.ts'
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII='
test('生图测试请求使用图片接口，保留渠道模型 ID，不携带聊天参数', () => {
 const request = buildCustomProbe('custom-image','https://relay.test/v1','secret','gpt-image-2-o')
 expect(request.url).toBe('https://relay.test/v1/images/generations')
 expect(JSON.parse(request.body)).toMatchObject({model:'gpt-image-2-o',n:1})
 expect(JSON.parse(request.body).messages).toBeUndefined()
 expect(JSON.parse(request.body).max_tokens).toBeUndefined()
})
test('支持合法 PNG，拒绝 HTML、空结果、链接型响应和超大 base64', () => {
 expect(parseGeneratedImage({data:[{b64_json:png}]})).toEqual({data:png,mimeType:'image/png'})
 for (const body of [null, {}, {data:[]}, {data:[{url:'http://127.0.0.1/secret'}]}, {data:[{b64_json:Buffer.from('<svg onload="evil()"></svg>').toString('base64')}]}, {data:[{b64_json:'A'.repeat(28_000_001)}]}]) expect(() => parseGeneratedImage(body)).toThrow()
})
test('生图渠道独立发现模型，不改写模型名称', async () => {
 const result = await getProfile('custom-image').fetchModels({baseUrl:'https://relay.test',apiKey:'secret',fetchFn:async url => {
  expect(url).toBe('https://relay.test/v1/models'); return Response.json({data:[{id:'gpt-image-2-o'}]})
 }})
 expect(result.models[0]?.id).toBe('gpt-image-2-o')
})
