/**
 * 主进程 esbuild 构建脚本（ADR-011）
 *
 * 把原 package.json 内联的 build:main / watch:main esbuild 命令抽到这里，
 * 解决两个问题：
 *   1. 构建期 key 注入：默认读 committed 的 telemetry.config.json，env
 *      ASCI_POSTHOG_KEY / ASCI_SENTRY_DSN 若非空则覆盖；经 --define 注入
 *      __POSTHOG_KEY__ / __SENTRY_DSN__（均为 publishable key，可进客户端）。
 *      两者皆空时不注入，build-config.ts 的 typeof 防御返回 undefined →
 *      上报链路自动降级本地缓冲。配置文件随代码走，本地/CI/clone 都自动有。
 *   2. build/watch 两条命令共享参数，避免 package.json 内两处漂移
 *
 * external 清单（CLAUDE.md §7.1）：electron、agent-sdk、native 模块，
 * 以及 @sentry/electron（OTel 动态 instrumentation 不可 bundle，
 * electron-builder files 带完整依赖闭包——见 electron-builder.yml）。
 *
 * 用法：bun run scripts/build-main.ts [--watch]
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 读 committed telemetry.config.json（缺失/损坏时返回空，安全降级） */
function readTelemetryConfig(): { posthogKey?: string; sentryDsn?: string } {
  const path = join(dirname(fileURLToPath(import.meta.url)), '../telemetry.config.json')
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as { posthogKey?: string; sentryDsn?: string }
  } catch {
    console.warn('[build-main] telemetry.config.json 解析失败，跳过 key 注入')
    return {}
  }
}

const EXTERNALS = [
  'electron',
  '@anthropic-ai/claude-agent-sdk',
  '@vscode/ripgrep',
  'fsevents',
  'better-sqlite3',
  'bindings',
  'pdfjs-dist',
  'sqlite-vec',
  'onnxruntime-node',
  '@sentry/electron',
]

const args = [
  'src/main/index.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--outfile=dist/main.cjs',
  ...EXTERNALS.map((name) => `--external:${name}`),
  '--loader:.sql=text',
]

// 构建期注入 publishable key：committed 配置文件为默认，env 非空则覆盖
const telemetryConfig = readTelemetryConfig()
for (const [defineName, envName, configValue] of [
  ['__POSTHOG_KEY__', 'ASCI_POSTHOG_KEY', telemetryConfig.posthogKey],
  ['__SENTRY_DSN__', 'ASCI_SENTRY_DSN', telemetryConfig.sentryDsn],
] as const) {
  const value = process.env[envName] || configValue
  if (value) {
    // define 的值必须是合法 JS 表达式：字符串需要双重 JSON 编码
    args.push(`--define:${defineName}=${JSON.stringify(value)}`)
  }
}

if (process.argv.includes('--watch')) {
  args.push('--watch=forever')
}

if (process.env.TINKER_CANDIDATE === '1') args.push('--define:process.env.TINKER_CANDIDATE="1"')
if (process.env.ASCI_SKIP_LOGIN === '1') args.push('--define:process.env.ASCI_SKIP_LOGIN="1"')

const result = spawnSync('bunx', ['esbuild', ...args], { stdio: 'inherit' })
process.exit(result.status ?? 1)
