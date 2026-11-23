/** 只读宿主索引内的 PNG。查看原图时固定内容摘要，逐段校验后才交给浏览器。 */
const RANGE_BYTES = 256 * 1024
const MAX_ORIGINAL_BYTES = 8 * 1024 * 1024
const MAX_THUMBNAIL_BYTES = 512 * 1024
const ASSET_PATH = /^([\w-]{1,128})\/((?:img|ref)-[a-f0-9]{32}\.png)$/
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>

interface ImageRange {
  offset: number
  totalBytes: number
  sha256: string
  data: string
}

export function isNativeAssetPath(path: string): boolean {
  return ASSET_PATH.test(path)
}

function pathParts(path: string): [string, string] {
  const match = ASSET_PATH.exec(path)
  if (!match) throw new Error('invalidImageFile')
  return [match[1]!, match[2]!]
}

function decode(data: string, maxBytes: number): Uint8Array<ArrayBuffer> {
  if (!data.length || data.length % 4 !== 0 || data.length > Math.ceil(maxBytes / 3) * 4) {
    throw new Error('invalidImageFile')
  }
  const decoded = atob(data)
  if (!decoded.length || decoded.length > maxBytes) throw new Error('invalidImageFile')
  return Uint8Array.from(decoded, char => char.charCodeAt(0))
}

function checkPngSize(bytes: Uint8Array, maxEdge: number, maxPixels: number): void {
  if (bytes.length < 33 || PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) {
    throw new Error('invalidImageFile')
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // 首个 chunk 必须是 13 字节 IHDR；宿主同时校验完整 PNG。
  if (header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452) {
    throw new Error('invalidImageFile')
  }
  const width = header.getUint32(16)
  const height = header.getUint32(20)
  if (!width || !height || width > maxEdge || height > maxEdge || width * height > maxPixels) {
    throw new Error('invalidImageFile')
  }
}

function checkRange(value: unknown, offset: number): ImageRange {
  if (!value || typeof value !== 'object') throw new Error('invalidImageFile')
  const { data, offset: start, totalBytes, sha256 } = value as Partial<ImageRange>
  if (start !== offset || typeof data !== 'string' || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('invalidImageFile')
  }
  if (typeof totalBytes !== 'number' || !Number.isSafeInteger(totalBytes) || totalBytes <= offset || totalBytes > MAX_ORIGINAL_BYTES) {
    throw new Error('invalidImageFile')
  }
  return { data, offset, totalBytes, sha256 }
}

/** 仅分配读取槽；取消排队中的视图无需等前面的 IPC 完成。 */
function limitReads(limit: number) {
  const waiting = new Set<() => void>()
  let active = 0
  return async function run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    if (active < limit) {
      active++
    } else {
      await new Promise<void>((resolve, reject) => {
        const start = () => {
          waiting.delete(start)
          signal?.removeEventListener('abort', cancel)
          active++
          resolve()
        }
        const cancel = () => {
          waiting.delete(start)
          reject(new DOMException('Aborted', 'AbortError'))
        }
        waiting.add(start)
        signal?.addEventListener('abort', cancel, { once: true })
      })
    }
    try {
      signal?.throwIfAborted()
      return await operation()
    } finally {
      active--
      waiting.values().next().value?.()
    }
  }
}

async function readOriginal(invoke: Invoke, session: string, filename: string, signal: AbortSignal): Promise<Blob> {
  async function rangeAt(offset: number, digest?: string): Promise<ImageRange> {
    signal.throwIfAborted()
    const args: unknown[] = [session, filename, offset, RANGE_BYTES]
    if (digest) args.push(digest)
    const value = await invoke('agent:read-image-range', ...args)
    signal.throwIfAborted()
    return checkRange(value, offset)
  }

  let range = await rangeAt(0)
  const digest = range.sha256
  const output = new Uint8Array(range.totalBytes)
  let offset = 0
  while (true) {
    if (range.totalBytes !== output.length || range.sha256 !== digest) throw new Error('invalidImageFile')
    const chunk = decode(range.data, RANGE_BYTES)
    if (chunk.length !== Math.min(RANGE_BYTES, output.length - offset)) throw new Error('invalidImageFile')
    output.set(chunk, offset)
    offset += chunk.length
    if (offset === output.length) break
    range = await rangeAt(offset, digest)
  }
  checkPngSize(output, 4096, 8_388_608)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', output))
  signal.throwIfAborted()
  if (Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('') !== digest) {
    throw new Error('invalidImageFile')
  }
  return new Blob([output], { type: 'image/png' })
}

export function createNativeImageAssets(invoke: Invoke) {
  const readThumbnail = limitReads(4)
  const readFullSize = limitReads(2)
  const thumbnails = new Map<string, Promise<string>>()
  return {
    async thumbnail(path: string): Promise<string> {
      const [session, filename] = pathParts(path)
      const pending = thumbnails.get(path)
      if (pending) return pending
      const request = readThumbnail(async () => {
        const data = await invoke('agent:read-image-thumbnail', session, filename)
        if (typeof data !== 'string') throw new Error('invalidImageFile')
        checkPngSize(decode(data, MAX_THUMBNAIL_BYTES), 256, 256 * 256)
        return data
      })
      thumbnails.set(path, request)
      try {
        return await request
      } finally {
        thumbnails.delete(path)
      }
    },

    async original(path: string, signal: AbortSignal): Promise<Blob> {
      const [session, filename] = pathParts(path)
      return readFullSize(() => readOriginal(invoke, session, filename, signal), signal)
    },
  }
}

export type NativeImageAssets = ReturnType<typeof createNativeImageAssets>
