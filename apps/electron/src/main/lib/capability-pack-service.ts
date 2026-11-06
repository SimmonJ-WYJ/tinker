/**
 * 能力包管理服务（IPC 业务层 — 配置页 → 能力包板块 · Codex 风只读展示，#414 CP-6）
 *
 * 提供唯一能力：
 *   listCapabilityPacks() — 扫 ~/.asci/capability-packs/ 派生 UI 列表（manifest 校验状态）
 *
 * 设计要点：
 *  - 能力包默认启用、不可禁用、不导入/卸载（Codex 风），故无 toggle / import / uninstall。
 *  - list 只读：直接读目录 + manifest 派生展示数据，不持有任何启停状态。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CapabilityPackManifest } from '@asci/shared'
import type { CapabilityPackListItem, CapabilityPackListResponse } from '@asci/shared'
import { getCapabilityPacksDir } from './config-paths.ts'

/**
 * 内置能力包 id（事实源：apps/electron/default-capability-packs/<id>/；用户自建包不在此列）。
 * 暂以本地常量维护（另见 plan-terminal-skill-guard.LIT_SEARCH_PACK_ID / telemetry conversation-type）；
 * 新增内置包时同步此处。
 */
const BUILTIN_PACK_IDS = new Set(['lit-search', 'lit-review'])

/** 是否有可展示的面向用户摘要（任一语言非空） */
export function hasUsableSummary(summaryI18n?: { zh?: string; en?: string }): boolean {
  return !!(summaryI18n?.zh?.trim() || summaryI18n?.en?.trim())
}

/**
 * 安全边界 #710：内置生产包必须自带 summaryI18n。
 * DTO 已不再下发 scenarioAgent.description（routing prompt），故缺摘要的内置包**标 invalid**而非回退展示路由 prompt。
 * 用户自建包不受此约束（缺摘要时 UI 显示中性占位）。
 */
export function isBuiltinMissingSummary(packId: string, summaryI18n?: { zh?: string; en?: string }): boolean {
  return BUILTIN_PACK_IDS.has(packId) && !hasUsableSummary(summaryI18n)
}

interface ScanEntry {
  packId: string
  manifestPath: string
  manifestValid: boolean
  manifestError?: string
  rawManifest?: unknown
}

/** 扫 ~/.asci/capability-packs/ 子目录，逐个 manifest 校验 → 收集中间结果 */
function scanPacksDir(): ScanEntry[] {
  const packsDir = getCapabilityPacksDir()
  let dirEntries: string[]
  try {
    dirEntries = readdirSync(packsDir)
  } catch {
    return []
  }

  const result: ScanEntry[] = []
  for (const entry of dirEntries) {
    const packDir = join(packsDir, entry)
    try {
      if (!statSync(packDir).isDirectory()) continue
    } catch {
      continue
    }

    const manifestPath = join(packDir, 'manifest.json')
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } catch (err) {
      result.push({
        packId: entry,
        manifestPath,
        manifestValid: false,
        manifestError: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    const parsed = CapabilityPackManifest.safeParse(raw)
    if (!parsed.success) {
      result.push({
        packId: entry,
        manifestPath,
        manifestValid: false,
        manifestError: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        rawManifest: raw,
      })
      continue
    }

    result.push({
      packId: parsed.data.packId,
      manifestPath,
      manifestValid: true,
      rawManifest: parsed.data,
    })
  }
  return result
}

/**
 * 枚举所有已安装能力包。
 *
 * 顺序：按目录名升序（稳定列表，避免 UI 抖动）。
 */
export function listCapabilityPacks(): CapabilityPackListResponse {
  const scans = scanPacksDir()

  const packs: CapabilityPackListItem[] = scans
    .map((scan): CapabilityPackListItem => {
      if (!scan.manifestValid || !scan.rawManifest) {
        return {
          packId: scan.packId,
          version: '',
          scenarioAgentName: '',
          skillRefs: [],
          mcpRefs: [],
          manifestValid: false,
          manifestError: scan.manifestError,
        }
      }
      // 已 zod 校验 → 安全 cast
      const manifest = scan.rawManifest as {
        packId: string
        version: string
        scenarioAgent: { name: string; description: string }
        skillRefs: string[]
        mcpRefs: string[]
        summaryI18n?: { zh?: string; en?: string }
      }
      // 安全边界 #710：内置包缺面向用户摘要 → 标 invalid（不可回退展示路由 prompt）
      if (isBuiltinMissingSummary(manifest.packId, manifest.summaryI18n)) {
        return {
          packId: manifest.packId,
          version: manifest.version,
          scenarioAgentName: manifest.scenarioAgent.name,
          skillRefs: [],
          mcpRefs: [],
          manifestValid: false,
          manifestError:
            '内置能力包缺少面向用户的 summaryI18n（安全边界 #710：不可回退展示 scenarioAgent.description 路由 prompt）',
        }
      }
      return {
        packId: manifest.packId,
        version: manifest.version,
        scenarioAgentName: manifest.scenarioAgent.name,
        skillRefs: manifest.skillRefs,
        mcpRefs: manifest.mcpRefs,
        manifestValid: true,
        summaryI18n: manifest.summaryI18n,
      }
    })
    .sort((a, b) => a.packId.localeCompare(b.packId))

  return { packs }
}
