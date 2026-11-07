/** 按实际协议构造图片请求体，避免生成未发送的 multipart 副本。 */
interface ImageReference { name: string; mime: string; bytes: Uint8Array }
interface ImageBodyInput { model: string; prompt: string; references: readonly ImageReference[]; geminiBody?: string }
export function buildImageRequestBody(input: ImageBodyInput): string | FormData {
  if (input.geminiBody !== undefined) return input.geminiBody
  if (input.references.length === 0) {
    return JSON.stringify({ model: input.model, prompt: input.prompt, n: 1 })
  }
  const form = new FormData()
  form.set('model', input.model)
  form.set('prompt', input.prompt)
  form.set('n', '1')
  for (const reference of input.references) {
    form.append('image[]', new Blob([reference.bytes as Uint8Array<ArrayBuffer>], { type: reference.mime }), reference.name)
  }
  return form
}
