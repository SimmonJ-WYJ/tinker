/**
 * 内建 MCP 运行时拼接
 *
 * 真相源：settings 中的 zoteroEnabled（含 ocr/asr 子开关）+ 路径工具。
 * paper-search 不再有 UI 开关，uv 可用即自动启用（commit ef28c94）。
 * 从不写盘——消灭 per-workspace 路径漂移问题类别本身。
 *
 * 内建 server 与用户 server 在 SDK 注入点合并时，**内建覆盖同名用户**。
 */

import { join } from 'node:path'
import type { McpServerEntry, PaperSearchEnvConfig } from '@asci/shared'
import { BUILTIN_MCP_RESERVED_NAMES } from '@asci/shared'

export const BUILTIN_MCP_NAMES: Set<string> = new Set(BUILTIN_MCP_RESERVED_NAMES)

export interface BuiltinMcpResolverInput {
  zoteroEnabled: boolean
  /** zotero 子能力：图片识别（OCR），undefined 视作 true（向后兼容） */
  zoteroOcrEnabled: boolean
  /** zotero 子能力：语音识别（ASR），undefined 视作 false（要下载 1GB） */
  zoteroAsrEnabled: boolean
  /** uv 二进制绝对路径，null 表示当前不可用（runtime 还没就绪）。
   *  paper-search 启用条件 == uvBin !== null，无独立总开关。 */
  uvBin: string | null
  paths: {
    zoteroServerCjs: string
    ocrServerCjs: string
    asrServerCjs: string
    paperSearchPackageDir: string
    asrModelDir: string
    asrCacheRoot: string
    /** Python 字节码缓存前缀目录（PYTHONPYCACHEPREFIX），见 config-paths.getPyCacheDir */
    pyCachePrefixDir: string
  }
  /** dev 环境注入子进程的 env（如 ASCI_DEV=1） */
  devEnv: Record<string, string>
  /** paper-search 用户 env（API key 等） */
  paperSearchEnv: Record<string, string>
  /** Zotero 数据目录（用户自定义路径） */
  zoteroDataDir?: string
}

export function resolveBuiltinMcpServers(
  input: BuiltinMcpResolverInput,
): Record<string, McpServerEntry> {
  // 始终输出 4 个内建 entry，enabled 反映对应总开关；这样 capabilities 视图能在
  // 设置页"MCP 服务器（全局）"区块固定列出 4 项（即使关闭也显示，方便用户知晓存在）。
  // SDK 注入点（agent-orchestrator.buildMcpServers）已有 `if (!entry.enabled) continue`
  // 兜底，禁用的 entry 不会被 spawn，行为保持不变。
  const zoteroEnv: Record<string, string> = { ...input.devEnv }
  if (input.zoteroDataDir && input.zoteroDataDir.trim()) {
    zoteroEnv.ZOTERO_DATA_DIR = input.zoteroDataDir.trim()
  }

  return {
    zotero: {
      type: 'stdio',
      command: 'node',
      args: [input.paths.zoteroServerCjs],
      env: Object.keys(zoteroEnv).length > 0 ? zoteroEnv : undefined,
      enabled: input.zoteroEnabled,
    },
    ocr: {
      type: 'stdio',
      command: 'node',
      args: [input.paths.ocrServerCjs],
      env: Object.keys(input.devEnv).length > 0 ? { ...input.devEnv } : undefined,
      // ocr 是 zotero 的子能力，需 zotero 主开关 + ocr 子开关都为真
      enabled: input.zoteroEnabled && input.zoteroOcrEnabled,
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
      // asr 同 ocr：主开关 + 子开关都为真才启用；模型缺失时调用会返回 retryable MODEL_DOWNLOADING
      enabled: input.zoteroEnabled && input.zoteroAsrEnabled,
    },
    'paper-search': (() => {
      // env 合并：devEnv（ASCI_DEV）+ paperSearchEnv（API key 等）。
      // 即使 paper-search MCP 当前不读 ~/.asci 配置，也统一注入 ASCI_DEV 保持隔离一致性，
      // 避免将来子进程内任何路径解析回落到 prod 目录。
      const paperSearchMergedEnv: Record<string, string> = {
        // 字节码缓存重定向（issue #587，替代 #542 的 PYTHONDONTWRITEBYTECODE=1）：
        // .pyc 写到 ~/.asci(-dev)/cache/pycache/ 而非包目录 __pycache__/ ——
        // 既不触发 dev 下 electronmon 监视重载（前端闪没，#542 初衷），
        // 又保留缓存避免每次冷启动全量重编译（pydantic/starlette 等较重）。
        PYTHONPYCACHEPREFIX: input.paths.pyCachePrefixDir,
        ...input.devEnv,
        ...input.paperSearchEnv,
      }
      return {
        type: 'stdio',
        // uvBin 未就绪（RP 未 ready）时填空串占位；只要 enabled=false 就不会被 spawn。
        // RP ready 后 capabilities 会重拉，command 自动补全。
        command: input.uvBin ?? '',
        // --no-sync：不在每次 spawn 时重同步/重建 editable 安装。多个并发 agent 各自
        // `uv run` 会并发重建 hatchling editable，持久损坏共享 .venv 的 .pth（→ import
        // paper_search 失败 → MCP failed → 退回 WebSearch → 右侧 paper 列表空）。venv 的
        // 首次同步改由 ensurePaperSearchVenvSynced() 在会话启动前串行完成。
        args: [
          'run', '--no-sync', '--extra', 'mcp',
          '--directory', input.paths.paperSearchPackageDir,
          'paper-search-mcp',
        ],
        env: Object.keys(paperSearchMergedEnv).length > 0 ? paperSearchMergedEnv : undefined,
        // paper-search 没有 UI 总开关：uv 可用即自动启用（commit ef28c94）。
        enabled: input.uvBin !== null,
        timeout: 60,
      }
    })(),
  }
}

// ─── env 收集器 ───────────────────────────────────────────────────────────────

/** ASR 模型子目录名称（与 runtime-provisioner 中的命名保持一致） */
const ASR_MODEL_SUBDIR = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17'

/** buildBuiltinResolverInputFromEnv 所需的依赖注入接口 */
export interface BuiltinResolverEnvDeps {
  getSettings: () => {
    zoteroEnabled: boolean
    zoteroOcrEnabled: boolean
    zoteroAsrEnabled: boolean
    zoteroDataDir?: string
  }
  findUvBin: () => string | null
  getZoteroServerCjsPath: () => string
  getOcrServerCjsPath: () => string
  getAsrServerCjsPath: () => string
  getPaperSearchPackageDir: () => string
  getAsrWeightsDir: () => string
  getAsrCacheDir: () => string
  getPyCacheDir: () => string
  getConfigEnvForChildren: () => Record<string, string>
  loadPaperSearchEnv: () => PaperSearchEnvConfig
}

/** 将 PaperSearchEnvConfig 转换为 Record<string, string> 供 env 注入 */
function paperSearchEnvToRecord(cfg: PaperSearchEnvConfig): Record<string, string> {
  const out: Record<string, string> = {}
  if (cfg.unpaywall_email) out.PAPER_SEARCH_MCP_UNPAYWALL_EMAIL = cfg.unpaywall_email
  if (cfg.semantic_scholar_api_key) out.PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY = cfg.semantic_scholar_api_key
  if (cfg.core_api_key) out.PAPER_SEARCH_MCP_CORE_API_KEY = cfg.core_api_key
  if (cfg.ieee_api_key) out.PAPER_SEARCH_MCP_IEEE_API_KEY = cfg.ieee_api_key
  return out
}

/**
 * 从运行时环境（settings / runtime provisioner / 路径工具 / paper-search env 文件）
 * 收集并组装 BuiltinMcpResolverInput。
 *
 * 依赖通过 deps 注入，便于单测和双调用点（agent-prompt-builder / capabilities）复用。
 */
export function buildBuiltinResolverInputFromEnv(deps: BuiltinResolverEnvDeps): BuiltinMcpResolverInput {
  const settings = deps.getSettings()
  return {
    zoteroEnabled: settings.zoteroEnabled,
    zoteroOcrEnabled: settings.zoteroOcrEnabled,
    zoteroAsrEnabled: settings.zoteroAsrEnabled,
    uvBin: deps.findUvBin(),
    zoteroDataDir: settings.zoteroDataDir,
    paths: {
      zoteroServerCjs: deps.getZoteroServerCjsPath(),
      ocrServerCjs: deps.getOcrServerCjsPath(),
      asrServerCjs: deps.getAsrServerCjsPath(),
      paperSearchPackageDir: deps.getPaperSearchPackageDir(),
      asrModelDir: join(deps.getAsrWeightsDir(), ASR_MODEL_SUBDIR),
      asrCacheRoot: deps.getAsrCacheDir(),
      pyCachePrefixDir: deps.getPyCacheDir(),
    },
    devEnv: deps.getConfigEnvForChildren(),
    paperSearchEnv: paperSearchEnvToRecord(deps.loadPaperSearchEnv()),
  }
}
