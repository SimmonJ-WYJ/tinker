/**
 * 把 @ 引用的项目目录展开成 <referenced_directory> 块，拼到发送给 Agent 的消息前。
 *
 * 现状：@file:<path> 只是路径提示、不注入内容；目录引用同理只给「有哪些文件」的清单，
 * 让 Agent 立即知道目录里有什么，再按需用 Read 打开（不灌全文）。
 * 纯函数（列目录的 IO 在调用方完成），便于单测。内置 prompt 统一英文。
 */

/** 单个被引用目录：path = 相对会话工作目录的路径；files = 内含文件相对路径；total = 实际文件总数。 */
export interface ReferencedDirectory {
  path: string
  files: string[]
  total: number
}

/** 每个目录最多列出的文件条数，超出标注省略数。 */
const MAX_FILES_PER_DIR = 50

export function buildReferencedDirectoriesBlock(dirs: ReferencedDirectory[]): string {
  if (dirs.length === 0) return ''

  const blocks = dirs.map((dir) => {
    const lines = [`<referenced_directory path="${dir.path}">`]
    if (dir.files.length === 0) {
      lines.push('(empty directory)')
    } else {
      for (const f of dir.files.slice(0, MAX_FILES_PER_DIR)) lines.push(`- ${f}`)
      const omitted = dir.total - Math.min(dir.files.length, MAX_FILES_PER_DIR)
      if (omitted > 0) lines.push(`(${omitted} more file(s) not listed; use Glob/Read to inspect)`)
    }
    lines.push('</referenced_directory>')
    return lines.join('\n')
  })

  const hint =
    'The user referenced the following project directory(ies). Paths are relative to the working directory; use Read to open any file.'
  return `${hint}\n${blocks.join('\n')}\n\n`
}
