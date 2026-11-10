/** 仅识别完整匹配受信布局的已发布小文件；未知/修改副本不读取附件正文、不删除。 */
import { createHash } from 'node:crypto'
import { constants, opendirSync, lstatSync, openSync, fstatSync, readSync, closeSync, type Stats } from 'node:fs'
import { join } from 'node:path'

interface ShippedSkill { hash: string; files: Readonly<Record<string, number>> }
// 来自受信 baseline 4ca3395 的这五个目录；不得从用户配置扩充本表。
const SHIPPED_SKILLS: Readonly<Record<string, ShippedSkill>> = {
  "lit-search-report": {
    "hash": "eed80d96c8db6c2df8d7723dc21d9914840bb538ae5d82c923740206c189fedd",
    "files": {
      "SKILL.md": 18802,
      "render_report.py": 28870
    }
  },
  "literature-review-result": {
    "hash": "e0e78c1b44810b58ada78f287a49d6c8d174e9944113f7bea72e25a5f039bce9",
    "files": {
      "SKILL.md": 42064
    }
  },
  "litreview": {
    "hash": "44cc53fc807097bcfb00b556e650190273c1d7415d31adb1591dd00b17129baf",
    "files": {
      "SKILL.md": 16812,
      "references/expansion-prompts.md": 4692,
      "references/query-mapping.md": 12949
    }
  },
  "paper-source-selection": {
    "hash": "1e1212609f473153de52ee3e69c5a1174434101501cba9aa99c617236e0d6b75",
    "files": {
      "SKILL.md": 8984,
      "resources/api-source-guide.md": 19405
    }
  },
  "review-proposer": {
    "hash": "3cf5432a4cf05d8470a009f1917e7646e87d3398cc14e6bb3b97bdcfd0670786",
    "files": {
      "SKILL.md": 11926
    }
  }
}

// 除精确发布布局外再设硬预算，防止将来误扩配置导致同步扫描失控。
const MAX_ENTRIES = 8
const MAX_DEPTH = 2
const MAX_FILE_BYTES = 64 * 1024
const MAX_TOTAL_BYTES = 256 * 1024
const READ_CHUNK_BYTES = 8192
interface LayoutEntry { kind: 'file' | 'directory'; bytes?: number }

function expectedLayout(skill: ShippedSkill): Map<string, LayoutEntry> | null {
  const expected = new Map<string, LayoutEntry>()
  let total = 0
  for (const [path, bytes] of Object.entries(skill.files)) {
    const parts = path.split('/')
    if (parts.length > MAX_DEPTH || parts.some(part => !part || part === '.' || part === '..')) return null
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_FILE_BYTES) return null
    total += bytes
    if (total > MAX_TOTAL_BYTES) return null
    expected.set(path, { kind: 'file', bytes })
    for (let i = 1; i < parts.length; i++) expected.set(parts.slice(0, i).join('/'), { kind: 'directory' })
  }
  return expected.size && expected.size <= MAX_ENTRIES ? expected : null
}

/** 先完成整个目录的元数据检查；额外附件、缺失/变长文件、链接和非普通文件均不读正文。 */
function inspectLayout(directory: string, expected: Map<string, LayoutEntry>): Map<string, Stats> | null {
  const root = lstatSync(directory)
  if (!root.isDirectory() || root.isSymbolicLink()) return null
  const snapshot = new Map<string, Stats>([['', root]])
  const pending = ['']
  let count = 0
  while (pending.length) {
    const parent = pending.pop()!
    const stream = opendirSync(join(directory, parent), { bufferSize: MAX_ENTRIES + 1 })
    try {
      for (let entry = stream.readSync(); entry; entry = stream.readSync()) {
        if (++count > expected.size || count > MAX_ENTRIES) return null
        const relativePath = parent ? `${parent}/${entry.name}` : entry.name
        const wanted = expected.get(relativePath)
        if (!wanted || relativePath.split('/').length > MAX_DEPTH || entry.isSymbolicLink()) return null
        const stat = lstatSync(join(directory, relativePath))
        if (stat.isSymbolicLink()) return null
        if (wanted.kind === 'directory') {
          if (!stat.isDirectory()) return null
          pending.push(relativePath)
        } else if (!stat.isFile() || stat.size !== wanted.bytes) return null
        snapshot.set(relativePath, stat)
      }
    } finally { stream.closeSync() }
  }
  return count === expected.size ? snapshot : null
}

function unchanged(before: Stats, after: Stats): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.mode === after.mode &&
    before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs
}

/** 仅允许这五种精确小文件布局；slug 未知时不枚举目录，绝不通用递归读取用户目录。 */
export function skillDirectoryFingerprint(directory: string, slug: string): string | null {
  if (!Object.hasOwn(SHIPPED_SKILLS, slug)) return null
  const skill = SHIPPED_SKILLS[slug]!
  try {
    const expected = expectedLayout(skill)
    if (!expected) return null
    const snapshot = inspectLayout(directory, expected)
    if (!snapshot) return null
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(READ_CHUNK_BYTES)
    for (const path of Object.keys(skill.files).sort()) {
      const bytes = skill.files[path]!
      const before = snapshot.get(path)!
      // O_NONBLOCK 防止元数据检查后被替换为 FIFO 时阻塞；O_NOFOLLOW 拒绝末级 symlink。
      const fd = openSync(join(directory, path), constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0))
      try {
        const opened = fstatSync(fd)
        if (!opened.isFile() || !unchanged(before, opened)) return null
        hash.update(path + '\0')
        let offset = 0
        while (offset < bytes) {
          const read = readSync(fd, buffer, 0, Math.min(buffer.length, bytes - offset), offset)
          if (read === 0) return null
          hash.update(buffer.subarray(0, read))
          offset += read
        }
        // 文件即使在读期间突增也只多读一个字节，之后按 fd 元数据复核并保留用户副本。
        if (readSync(fd, buffer, 0, 1, bytes) !== 0 || !unchanged(before, fstatSync(fd))) return null
        hash.update('\0')
      } finally { closeSync(fd) }
    }
    const after = inspectLayout(directory, expected)
    if (!after || [...snapshot].some(([path, before]) => !after.has(path) || !unchanged(before, after.get(path)!))) return null
    return hash.digest('hex')
  } catch { return null }
}

export function isKnownRetiredWorkflowSkill(directory: string, slug: string): boolean {
  return Object.hasOwn(SHIPPED_SKILLS, slug) && skillDirectoryFingerprint(directory, slug) === SHIPPED_SKILLS[slug]!.hash
}
