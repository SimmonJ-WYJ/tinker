/**
 * 引用图谱结果缓存
 *
 * 存放位置：~/.asci/citation-graph-cache/{sha1}.json
 *
 * 缓存键由 provider + 规范化 seed 输入 + 5 个展开参数共同决定，任一变化都不命中。
 * 缓存写入时机：buildGraph 成功完成且未截断（truncated=false）才写；
 * 截断或出错的结果质量低，不值得缓存。
 *
 * 缓存格式 v1 简单粗暴：直接序列化最终的 nodes/edges，重放时按 kind 分组模拟流式事件。
 * 未来需要精细化（渐进补全 / 跨 seed 共享节点）时再升级。
 */

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type {
  CitationGraphEdge,
  CitationGraphNode,
  CitationGraphSeedInput,
} from '@asci/shared'
import { getCitationGraphCacheDir } from '../config-paths'

/** 磁盘上的 JSON 结构 */
export interface CachedCitationGraph {
  version: 1
  provider: 'openalex' | 'paper-search'
  cacheKey: string
  seedInput: CitationGraphSeedInput
  seedNodeId: string | null
  params: {
    refsLimit: number
    citedByLimit: number
    hop2TopN: number
    hop2RefsPerNode: number
    hop2CitedByPerNode: number
  }
  nodes: CitationGraphNode[]
  edges: CitationGraphEdge[]
  truncated: boolean
  /** ISO 时间 */
  generatedAt: string
}

/** 规范化 seed 输入为一份稳定字符串（用于哈希） */
function normalizeSeedForKey(seed: CitationGraphSeedInput): string {
  const parts: string[] = []
  if (seed.openalexId) parts.push(`oa:${seed.openalexId.trim().toUpperCase().replace(/^.*\//, '')}`)
  if (seed.doi) {
    const doi = seed.doi
      .trim()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
      .replace(/^doi:/i, '')
      .toLowerCase()
    parts.push(`doi:${doi}`)
  }
  if (seed.arxivId) parts.push(`arxiv:${seed.arxivId.trim().replace(/^arxiv:/i, '').toLowerCase()}`)
  if (parts.length === 0 && seed.title) {
    parts.push(`title:${seed.title.trim().toLowerCase().replace(/\s+/g, ' ')}`)
  }
  return parts.join('|') || 'empty'
}

export interface CacheKeyInput {
  provider: 'openalex' | 'paper-search'
  seed: CitationGraphSeedInput
  params: CachedCitationGraph['params']
}

/** 生成缓存键（sha1，16 位足够避免碰撞） */
export function computeCacheKey(input: CacheKeyInput): string {
  const payload = [
    input.provider,
    normalizeSeedForKey(input.seed),
    input.params.refsLimit,
    input.params.citedByLimit,
    input.params.hop2TopN,
    input.params.hop2RefsPerNode,
    input.params.hop2CitedByPerNode,
  ].join('::')
  return createHash('sha1').update(payload).digest('hex').slice(0, 16)
}

function cachePath(key: string): string {
  return join(getCitationGraphCacheDir(), `${key}.json`)
}

/** 读取缓存；文件不存在或格式不对返回 null */
export function readCache(key: string): CachedCitationGraph | null {
  const file = cachePath(key)
  if (!existsSync(file)) return null
  try {
    const raw = readFileSync(file, 'utf-8')
    const parsed = JSON.parse(raw) as CachedCitationGraph
    if (parsed.version !== 1 || parsed.cacheKey !== key) return null
    return parsed
  } catch (error) {
    console.warn('[citation-graph][cache] 读取缓存失败，忽略:', error)
    return null
  }
}

export function writeCache(data: CachedCitationGraph): void {
  const dir = getCitationGraphCacheDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = cachePath(data.cacheKey)
  try {
    writeFileSync(file, JSON.stringify(data), 'utf-8')
  } catch (error) {
    console.warn('[citation-graph][cache] 写入缓存失败，忽略:', error)
  }
}

/** 清除指定 key 的缓存；不存在也不报错 */
export function clearCacheByKey(key: string): boolean {
  const file = cachePath(key)
  if (!existsSync(file)) return false
  try {
    unlinkSync(file)
    return true
  } catch (error) {
    console.warn('[citation-graph][cache] 清除缓存失败:', error)
    return false
  }
}

/** 清空全部缓存，返回被删除的文件数 */
export function clearAllCache(): number {
  const dir = getCitationGraphCacheDir()
  if (!existsSync(dir)) return 0
  let count = 0
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    try {
      rmSync(join(dir, name), { force: true })
      count += 1
    } catch (error) {
      console.warn(`[citation-graph][cache] 删除 ${name} 失败:`, error)
    }
  }
  return count
}
