// apps/electron/src/main/lib/auth-upgrade.ts
/**
 * 老用户升级 - spec §八
 *
 * scanLocalData: 检测 ~/.asci/ 下对象规模 + owner.json 存在性
 * write/read owner.json: marker，不修改对象本身（对象级 ownerUid 归 0.4）
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { LocalDataSnapshot, OwnerMarker } from '@asci/shared'

const FILE_OWNER = 'owner.json'
const DIR_PAPERS = 'papers'
const DIR_NOTES = 'notes'
const DIR_EVIDENCE = 'evidence-sets'

async function countJsonFiles(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir)
    return entries.filter((e) => e.endsWith('.json')).length
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') return 0
    throw err
  }
}

export async function scanLocalData(basePath: string): Promise<LocalDataSnapshot> {
  const [papers, notes, evidenceSets, owner] = await Promise.all([
    countJsonFiles(path.join(basePath, DIR_PAPERS)),
    countJsonFiles(path.join(basePath, DIR_NOTES)),
    countJsonFiles(path.join(basePath, DIR_EVIDENCE)),
    readOwnerMarker(basePath),
  ])
  return {
    hasLocalData: papers + notes + evidenceSets > 0,
    counts: { papers, notes, evidenceSets },
    attributedTo: owner?.uid ?? null,
  }
}

export async function readOwnerMarker(basePath: string): Promise<OwnerMarker | null> {
  try {
    const buf = await fs.readFile(path.join(basePath, FILE_OWNER), 'utf-8')
    return JSON.parse(buf) as OwnerMarker
  } catch {
    return null
  }
}

export async function writeOwnerMarker(basePath: string, marker: OwnerMarker): Promise<void> {
  await fs.mkdir(basePath, { recursive: true })
  await fs.writeFile(path.join(basePath, FILE_OWNER), JSON.stringify(marker, null, 2), 'utf-8')
}
