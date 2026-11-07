import { expect, test } from 'bun:test'
import { buildImageRequestBody } from './image-request-body.ts'

test('原生协议使用已序列化请求，不再读取参考图以构造未发送的副本', () => {
  const references = [{ name: 'large.png', mime: 'image/png', get bytes(): Uint8Array { throw new Error('不应构造 multipart 副本') } }]
  const body = '{"contents":[{"parts":[{"text":"修改"}]}]}'
  expect(buildImageRequestBody({ model: 'native-image', prompt: '修改', references, geminiBody: body })).toBe(body)
})

test('文生图保持原有 JSON 参数', () => {
  expect(JSON.parse(buildImageRequestBody({ model: 'image-model', prompt: '生成图片', references: [] }) as string)).toEqual({ model: 'image-model', prompt: '生成图片', n: 1 })
})

test('编辑协议在原生宿主运行时保留图像顺序、名称、类型和字节', () => {
  // 仓库测试预加载 happy-dom；主进程使用原生 FormData，子进程避免 DOM polyfill 改写文件名。
  const script = `
    import { buildImageRequestBody } from ${JSON.stringify(new URL('./image-request-body.ts', import.meta.url).href)};
    const references = [{ name: 'base.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }, { name: 'ref.jpg', mime: 'image/jpeg', bytes: new Uint8Array([4, 5]) }];
    const form = buildImageRequestBody({ model: 'exact-model', prompt: '保持姿势', references });
    const files = await Promise.all(form.getAll('image[]').map(async file => ({ name: file.name, type: file.type, bytes: [...new Uint8Array(await file.arrayBuffer())] })));
    console.log(JSON.stringify({ model: form.get('model'), prompt: form.get('prompt'), n: form.get('n'), files }));
  `
  const result = Bun.spawnSync([process.execPath, '--eval', script], { stdout: 'pipe', stderr: 'pipe' })
  expect(result.exitCode).toBe(0)
  expect(JSON.parse(result.stdout.toString())).toEqual({ model: 'exact-model', prompt: '保持姿势', n: '1', files: [{ name: 'base.png', type: 'image/png', bytes: [1, 2, 3] }, { name: 'ref.jpg', type: 'image/jpeg', bytes: [4, 5] }] })
})
