/** 每次资源请求重新核对真实路径、目录链和链接数，不靠 URL 前缀授权。 */
import { lstatSync, realpathSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

function isOwnedFile(path:string,root:string):boolean {
  if (!path.startsWith(root+sep) || realpathSync(root)!==root || realpathSync(path)!==path) return false
  const rootStat = lstatSync(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return false
  const segments = relative(root,path).split(sep)
  if (segments.length>128 || segments.some(part=>!part || part==='.' || part==='..')) return false
  let cursor=root
  for (let index=0;index<segments.length;index++) {
    cursor=join(cursor,segments[index]!)
    const stat=lstatSync(cursor)
    if (stat.isSymbolicLink()) return false
    if (index<segments.length-1) {
      if (!stat.isDirectory()) return false
    } else if (!stat.isFile() || stat.nlink!==1 || stat.size>16*1024*1024) return false
  }
  return true
}

export function isPreviewResourceAllowed(rawUrl:string,dist:string):boolean {
  try {
    if (rawUrl.length>16384) return false
    const url=new URL(rawUrl)
    if (['data:','blob:','devtools:'].includes(url.protocol)) return true
    if (url.protocol!=='file:' || url.hostname || url.username || url.password) return false
    const path=fileURLToPath(url)
    if(path.length>4096) return false
    return [join(dist,'renderer'),join(dist,'resources')]
      .some(directory=>isOwnedFile(path,directory))
  } catch {
    // 畸形编码、丢失文件和任何路径检查错误均拒绝，不能让请求回落放行。
    return false
  }
}
