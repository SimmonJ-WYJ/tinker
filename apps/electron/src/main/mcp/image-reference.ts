/** 参考图只允许来自本次会话的文件目录；拒绝越界、符号链接逃逸和伪装图片。 */
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, relative } from 'node:path'
export function readImageReferences(paths: string[], roots: string[]): { name: string; mime: string; bytes: Uint8Array }[] {
  const uniquePaths = [...new Set(paths.map(path => realpathSync(path)))]
  if (uniquePaths.length > 4) throw new Error('At most four reference images are supported')
  let total = 0
  return uniquePaths.map(path => {
    const resolved = realpathSync(path)
    if (!roots.some(root => { try { const rel = relative(realpathSync(root), resolved); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) } catch { return false } })) throw new Error('Reference image must be attached to this session')
    const size = statSync(resolved).size
    total += size
    if (size > 10_000_000 || total > 25_000_000) throw new Error('Reference images exceed upload size limit')
    const bytes = readFileSync(resolved)
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null
    if (!mime) throw new Error('Reference image must be PNG, JPEG or WebP')
    return { name: basename(resolved), mime, bytes: new Uint8Array(bytes) }
  })
}
