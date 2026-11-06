/**
 * 引用图谱 Provider 注册表
 *
 * v1 阶段默认返回 OpenAlexProvider。
 * 后续接入 paper-search MCP 时，新增 PaperSearchMcpProvider 实现并在此按
 * settings / env 开关切换，service 层对具体 provider 无感知。
 */

import { openAlexProvider } from './providers/openalex'
import type { CitationProvider } from './providers/types'

export type CitationProviderId = 'openalex' | 'paper-search'

/**
 * 获取当前生效的 citation provider
 *
 * 后期可通过 `override` 参数或读取 settings.json 来切换数据源。
 */
export function getCitationProvider(override?: CitationProviderId): CitationProvider {
  const target = override ?? 'openalex'

  switch (target) {
    case 'openalex':
      return openAlexProvider
    case 'paper-search':
      // TODO: paper-search MCP 接入后返回对应 provider
      throw new Error('paper-search MCP provider 尚未实现，请使用 openalex')
    default:
      return openAlexProvider
  }
}
