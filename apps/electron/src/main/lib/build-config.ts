/**
 * 构建期注入常量（ADR-011）
 *
 * PostHog project API key 与 Sentry DSN 都是 publishable key（可进客户端，
 * 不属于密钥），由 scripts/build-main.ts 在 esbuild --define 注入：
 *   __POSTHOG_KEY__ ← env ASCI_POSTHOG_KEY
 *   __SENTRY_DSN__  ← env ASCI_SENTRY_DSN
 *
 * 未注入（本地开发 / 账号未开通）时返回 undefined，
 * 上报链路自动降级为仅本地 JSONL 缓冲——开发与测试不被账号阻塞。
 */

declare const __POSTHOG_KEY__: string | undefined
declare const __SENTRY_DSN__: string | undefined

export function getPosthogKey(): string | undefined {
  // typeof 防御：dev/test 下 esbuild define 不存在时直接引用会 ReferenceError
  if (typeof __POSTHOG_KEY__ !== 'undefined' && __POSTHOG_KEY__) return __POSTHOG_KEY__
  return process.env.ASCI_POSTHOG_KEY || undefined
}

export function getSentryDsn(): string | undefined {
  if (typeof __SENTRY_DSN__ !== 'undefined' && __SENTRY_DSN__) return __SENTRY_DSN__
  return process.env.ASCI_SENTRY_DSN || undefined
}
