/** 内置 MCP 只提供通用 OCR/ASR；开关沿用兼容字段，从不写入用户 MCP 配置。 */

import { join } from 'node:path'
import type { McpServerEntry } from '@asci/shared'
import { BUILTIN_MCP_RESERVED_NAMES } from '@asci/shared'

export const BUILTIN_MCP_NAMES: Set<string> = new Set(BUILTIN_MCP_RESERVED_NAMES)

export interface BuiltinMcpResolverInput {
  /** 沿用旧字段名，两个媒体开关独立生效。 */
  zoteroOcrEnabled: boolean
  zoteroAsrEnabled: boolean
  paths: {
    ocrServerCjs: string
    asrServerCjs: string
    asrModelDir: string
    asrCacheRoot: string
  }
  /** dev 环境注入子进程的 env（如 ASCI_DEV=1） */
  devEnv: Record<string, string>

}

export function resolveBuiltinMcpServers(
  input: BuiltinMcpResolverInput,
): Record<string, McpServerEntry> {
  return {
    ocr: {
      type: 'stdio',
      command: 'node',
      args: [input.paths.ocrServerCjs],
      env: Object.keys(input.devEnv).length > 0 ? { ...input.devEnv } : undefined,
      // 只跟随独立 OCR 设置。
      enabled: input.zoteroOcrEnabled,
    },
    asr: {
      type: 'stdio',
      command: 'node',
      args: [input.paths.asrServerCjs],
      env: {
        ...input.devEnv,
        ASCI_ASR_MODEL_DIR: input.paths.asrModelDir,
        ASCI_ASR_CACHE_ROOT: input.paths.asrCacheRoot,
      },
      // ASR 默认关闭，用户主动启用后才可调用。
      enabled: input.zoteroAsrEnabled,
    },

  }
}

// ─── env 收集器 ───────────────────────────────────────────────────────────────

/** ASR 模型子目录名称（与 runtime-provisioner 中的命名保持一致） */
const ASR_MODEL_SUBDIR = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17'

/** buildBuiltinResolverInputFromEnv 所需的依赖注入接口 */
export interface BuiltinResolverEnvDeps {
  getSettings: () => {
    zoteroOcrEnabled: boolean
    zoteroAsrEnabled: boolean
  }
  getOcrServerCjsPath: () => string
  getAsrServerCjsPath: () => string
  getAsrWeightsDir: () => string
  getAsrCacheDir: () => string
  getConfigEnvForChildren: () => Record<string, string>
}

export function buildBuiltinResolverInputFromEnv(deps: BuiltinResolverEnvDeps): BuiltinMcpResolverInput {
  const settings = deps.getSettings()
  return {
    zoteroOcrEnabled: settings.zoteroOcrEnabled,
    zoteroAsrEnabled: settings.zoteroAsrEnabled,
    paths: {
      ocrServerCjs: deps.getOcrServerCjsPath(),
      asrServerCjs: deps.getAsrServerCjsPath(),
      asrModelDir: join(deps.getAsrWeightsDir(), ASR_MODEL_SUBDIR),
      asrCacheRoot: deps.getAsrCacheDir(),
    },
    devEnv: deps.getConfigEnvForChildren(),
  }
}
