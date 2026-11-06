/**
 * AgentOrchestrator SDK 环境变量构建
 *
 * 从 agent-orchestrator.ts 拆出的 SDK 子进程环境构造逻辑：
 * - buildSdkEnv：注入 API Key、Base URL、代理、Shell 配置等，并显式管理 ANTHROPIC_* 前缀
 * - buildPathWithBundledPrefix：在系统 PATH 前拼接 bundled runtimes 目录
 *
 * ⚠️ CLAUDE.md §7.2 硬约束：buildSdkEnv 内部逻辑逐字节保留 ——
 * (1) cleanEnv 的 ANTHROPIC_ 前缀过滤；(2) 末尾把未被 sdkEnv 管理的 ANTHROPIC_* 置空的循环。
 * 修改时不得重构内部；纯搬迁。
 */

import { normalizeAnthropicBaseUrlForSdk } from '@asci/core'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { getSdkConfigDir, getConfigDir } from './config-paths'
import { getRuntimeStatus } from './runtime-init'
import { getRuntimeProvisioner } from './runtime/runtime-provisioner.ts'

/**
 * 构建 SDK 环境变量
 *
 * 注入 API Key、Base URL、代理、Shell 配置等。
 */
export async function buildSdkEnv(
  apiKey: string,
  baseUrl: string | undefined,
): Promise<Record<string, string | undefined>> {
  const DEFAULT_ANTHROPIC_URL = 'https://api.anthropic.com'

  // 从 process.env 继承系统变量，但清理所有 ANTHROPIC_ 前缀的变量，
  // 防止本地开发环境（如 ANTHROPIC_AUTH_TOKEN、ANTHROPIC_API_KEY、
  // ANTHROPIC_BASE_URL 等）干扰 SDK 的认证和请求目标。
  // 即使 index.ts 启动时已清理过一次，initializeRuntime() 中的
  // loadShellEnv() 可能从 shell 配置文件（~/.zshrc 等）重新注入这些变量。
  const cleanEnv: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('ANTHROPIC_')) {
      cleanEnv[key] = value
    }
  }

  const sdkEnv: Record<string, string | undefined> = {
    ...cleanEnv,
    ANTHROPIC_API_KEY: apiKey,
    // 提升输出 token 上限，避免 "exceeded 32000 output token maximum" 错误
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: '64000',
    // 启用 Tasks 功能
    CLAUDE_CODE_ENABLE_TASKS: 'true',
    // 禁用实验性 beta 功能，使用稳定模式
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
    // 配置隔离：让 SDK 使用独立的配置目录，不读取用户的 ~/.claude.json
    CLAUDE_CONFIG_DIR: getSdkConfigDir(),
    // 注入 ASCI 配置目录，供 Skill 脚本正确定位 JSONL 等文件（fix #75）
    ASCI_CONFIG_DIR: getConfigDir(),
  }

  // 显式控制 ANTHROPIC_BASE_URL：仅在用户配置了自定义 Base URL 时注入
  // 使用统一的 normalizeAnthropicBaseUrlForSdk 规范化，SDK 内部会自动拼接 /v1/messages
  if (baseUrl && baseUrl !== DEFAULT_ANTHROPIC_URL) {
    sdkEnv.ANTHROPIC_BASE_URL = normalizeAnthropicBaseUrlForSdk(baseUrl)
    // 第三方 Anthropic-compat 端点（Moonshot / Kimi / DeepSeek 等）通常要求
    // Authorization: Bearer 头而非 x-api-key。同时注入 ANTHROPIC_AUTH_TOKEN
    // 让 SDK 走 Bearer 路径，避免 "Not logged in" 误报。
    sdkEnv.ANTHROPIC_AUTH_TOKEN = apiKey
  }

  const proxyUrl = await getEffectiveProxyUrl()
  if (proxyUrl) {
    sdkEnv.HTTPS_PROXY = proxyUrl
    sdkEnv.HTTP_PROXY = proxyUrl
  }

  // Windows 平台：配置 Shell 环境
  // claude.exe (Claude Code) 在 Win 上**不识别** CLAUDE_CODE_SHELL，
  // 它认的是 CLAUDE_CODE_GIT_BASH_PATH（指向 bash.exe 路径）。
  // 错误信息原文："Claude Code on Windows requires git-bash. ... set environment
  // variable pointing to your bash.exe, similar to: CLAUDE_CODE_GIT_BASH_PATH=...".
  // 历史踩坑：ASCI 老逻辑设 CLAUDE_CODE_SHELL，能跑通是因为系统装了 Git for
  // Windows 时 claude.exe 自己 fallback 到 PATH/常见路径找 bash；用户卸了系统
  // Git 后这条 fallback 失效，子进程 exit code 1。
  if (process.platform === 'win32') {
    const runtimeStatus = getRuntimeStatus()
    const shellStatus = runtimeStatus?.shell

    if (shellStatus) {
      if (shellStatus.gitBash?.available && shellStatus.gitBash.path) {
        // 同时设 CLAUDE_CODE_GIT_BASH_PATH（claude.exe 认）和 CLAUDE_CODE_SHELL
        // （ASCI 自身代码里若有别的地方依赖此变量则保留兼容；目前只 claude.exe 关心）
        sdkEnv.CLAUDE_CODE_GIT_BASH_PATH = shellStatus.gitBash.path
        sdkEnv.CLAUDE_CODE_SHELL = shellStatus.gitBash.path
        console.log(`[Agent 编排] 配置 Shell 环境: Git Bash (${shellStatus.gitBash.path})`)
      } else if (shellStatus.wsl?.available) {
        sdkEnv.CLAUDE_CODE_SHELL = 'wsl'
        console.log(`[Agent 编排] 配置 Shell 环境: WSL ${shellStatus.wsl.version} (${shellStatus.wsl.defaultDistro})`)
      } else {
        console.warn('[Agent 编排] Windows 平台未检测到可用的 Shell 环境（Git Bash / WSL）')
      }
      sdkEnv.CLAUDE_BASH_NO_LOGIN = '1'
    }
  }

  // 让 agent 的 Bash 工具与 MCP 子进程能直接调到 bundled runtimes：
  // .app 把 uv / python / node 装在 ~/Library/Application Support/ASCI/runtimes/ 下，
  // 但用户系统 PATH 不含这些目录，导致 SKILL 脚本里裸 `uv run ...` / `python3.12 ...` 调用失败，
  // 以及 mcp.json 里裸 `command: "node"` 的内置 MCP（zotero / ocr / asr）依赖系统 nvm node 兜底，
  // 一旦用户禁用/卸载系统 node 就会全部 spawn 失败。
  // PATH 前缀通过 buildPathWithBundledPrefix 拼接，确保 SDK 子进程与 MCP 子进程共用同一份。
  sdkEnv.PATH = buildPathWithBundledPrefix(sdkEnv.PATH)

  // SDK 0.2.111/0.2.113 曾调整 options.env 的叠加/替换语义。
  // 本项目始终显式传入完整 env，并对未被 sdkEnv 管理的 ANTHROPIC_* 置空，
  // 避免 shell 中的 ANTHROPIC_CUSTOM_HEADERS、ANTHROPIC_MODEL 等变量污染 SDK 子进程。
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ANTHROPIC_') && !(key in sdkEnv)) {
      sdkEnv[key] = ''
    }
  }

  return sdkEnv
}

/**
 * 在已有 PATH 上拼接 bundled runtimes 前缀目录。
 *
 * runtimes 子树布局封装在 RuntimeProvisioner.getPathPrefixDirs()，编排层只 join。
 * RuntimeProvisioner 未 ready 时返回 currentPath（兜底走系统 PATH）。
 */
export function buildPathWithBundledPrefix(currentPath: string | undefined): string | undefined {
  const rp = getRuntimeProvisioner()
  if (rp.getStatus().phase !== 'ready') return currentPath
  const sep = process.platform === 'win32' ? ';' : ':'
  return [...rp.getPathPrefixDirs(), currentPath].filter(Boolean).join(sep)
}
