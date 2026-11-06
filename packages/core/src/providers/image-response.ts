/** 生图响应边界：限制内存占用，拒绝 SVG/HTML 和畸形 base64。 */
export function parseGeneratedImage(body: unknown): { data: string; mimeType: string } {
  const items = (body as { data?: Array<{ b64_json?: unknown }> } | null)?.data
  const value = items?.[0]?.b64_json
  if (typeof value !== 'string' || value.length > 28_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('Image response must contain a base64 PNG, JPEG or WebP in data[0].b64_json')
  }
  const bytes = Buffer.from(value, 'base64')
  const mimeType = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
    : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : ''
  if (!mimeType || bytes.length < 16) throw new Error('Unsupported image content')
  return { data: value, mimeType }
}
