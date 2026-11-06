/**
 * PostHog Feature Flag 拉取（远程 kill switch，ADR-011）
 *
 * 架构没用 posthog-js（禁 autocapture / 主进程汇集），故不能调
 * `posthog.isFeatureEnabled()`，改用 PostHog `/decide` HTTP 端点：
 * 用同一 publishable key + deviceId 取 flag，走现有 proxy-fetch。
 *
 * 返回 boolean | undefined：
 *   - true / false：flag 明确取值
 *   - undefined：拉取失败 / 网络错误 / flag 不存在 —— 调用方据此"以客户端为准"
 */
import { getFetchFn } from '../proxy-fetch.ts'
import { getEffectiveProxyUrl } from '../proxy-settings-service.ts'
import { POSTHOG_HOST } from './posthog-sender.ts'

interface DecideResponse {
  featureFlags?: Record<string, boolean | string>
}

/**
 * 查询单个 feature flag 的启用状态（语义对齐 posthog.isFeatureEnabled）。
 * @returns boolean = flag 取值；undefined = 拉取失败 / flag 不存在
 */
export async function fetchFeatureFlagEnabled(
  apiKey: string,
  distinctId: string,
  flagKey: string,
): Promise<boolean | undefined> {
  try {
    const fetchFn = getFetchFn(await getEffectiveProxyUrl())
    const res = await fetchFn(`${POSTHOG_HOST}/decide/?v=3`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, distinct_id: distinctId }),
    })
    if (!res.ok) return undefined
    const data = (await res.json()) as DecideResponse
    const value = data.featureFlags?.[flagKey]
    if (value === undefined) return undefined
    // isFeatureEnabled 语义：真值即 enabled；布尔 flag 下 false→关、true→开
    return value !== false && value !== ''
  } catch {
    return undefined
  }
}
