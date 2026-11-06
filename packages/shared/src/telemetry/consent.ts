/**
 * 遥测 consent 模型 + 地域默认值判定（issue #426 T-3 / ADR-011）
 *
 * 地域判定 = 本地时区启发式：系统时区 ∈ EU/EEA/UK 清单 → GDPR 区，
 * 默认关闭需显式 opt-in；清单外 → 默认开启可 opt-out；无法判定 → 按 GDPR 区保守处理。
 *
 * 为什么不用 IP geo：查 IP 归属本身就要把 IP 发给第三方 geo 服务，
 * 发生在用户同意采集之前，构成「同意前先泄 IP」悖论。时区启发式零网络外发，
 * 误差场景（旅行 / 代理）的 fallback 方向是更保守（多判 GDPR 区）而非更激进。
 *
 * 判定结果每次启动实时计算、不持久化；用户的显式开关选择持久化在
 * settings.json 的 telemetryConsent 字段（undefined = 跟随地域默认）。
 */

export type TelemetryRegion = 'gdpr' | 'non-gdpr' | 'unknown'

/** settings.json 持久化形态：undefined = 用户未显式选择，跟随地域默认 */
export interface TelemetryConsentSettings {
  posthogEnabled?: boolean
  agentEvolutionEnabled?: boolean
}

/** 运行时生效的 consent 状态（地域默认 + 用户显式选择合成后） */
export interface TelemetryConsentState {
  region: TelemetryRegion
  /** 地域默认值（gdpr/unknown → false；non-gdpr → true） */
  defaultEnabled: boolean
  /** PostHog 行为埋点最终生效开关 */
  posthogEnabled: boolean
  /** 自进化信号采集最终生效开关（与 PostHog 完全解耦） */
  agentEvolutionEnabled: boolean
}

/**
 * GDPR 区 IANA 时区清单：EU 27 国 + EEA（冰岛/列支敦士登/挪威）+ UK（UK GDPR 等效，保守纳入）
 * + 适用 GDPR 的法国/葡萄牙/西班牙海外属地时区。
 * 维护原则：宁多勿漏——多判一个时区的代价只是该地用户默认关闭（更保守）。
 */
export const GDPR_TIMEZONES: ReadonlySet<string> = new Set([
  // 欧洲大陆 EU 27
  'Europe/Vienna',
  'Europe/Brussels',
  'Europe/Sofia',
  'Europe/Zagreb',
  'Europe/Nicosia',
  'Asia/Nicosia',
  'Asia/Famagusta',
  'Europe/Prague',
  'Europe/Copenhagen',
  'Europe/Tallinn',
  'Europe/Helsinki',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Busingen',
  'Europe/Athens',
  'Europe/Budapest',
  'Europe/Dublin',
  'Europe/Rome',
  'Europe/Riga',
  'Europe/Vilnius',
  'Europe/Luxembourg',
  'Europe/Malta',
  'Europe/Amsterdam',
  'Europe/Warsaw',
  'Europe/Lisbon',
  'Atlantic/Madeira',
  'Atlantic/Azores',
  'Europe/Bucharest',
  'Europe/Bratislava',
  'Europe/Ljubljana',
  'Europe/Madrid',
  'Atlantic/Canary',
  'Africa/Ceuta',
  'Europe/Stockholm',
  // EEA
  'Atlantic/Reykjavik',
  'Europe/Vaduz',
  'Europe/Oslo',
  // UK（UK GDPR 等效，保守纳入）
  'Europe/London',
  'Europe/Gibraltar',
  // 法国海外属地（GDPR 适用的最外延地区）
  'America/Martinique',
  'America/Guadeloupe',
  'America/Cayenne',
  'America/Miquelon',
  'Indian/Reunion',
  'Indian/Mayotte',
  'Pacific/Noumea',
  'Pacific/Tahiti',
  'Pacific/Marquesas',
  'Pacific/Gambier',
  'Pacific/Wallis',
])

/** 系统时区 → 地域；空值/非法值 → 'unknown'（上层按 GDPR 区保守处理） */
export function resolveRegionFromTimeZone(timeZone: string | undefined | null): TelemetryRegion {
  if (!timeZone || typeof timeZone !== 'string') return 'unknown'
  if (GDPR_TIMEZONES.has(timeZone)) return 'gdpr'
  // IANA 时区至少形如 Area/Location；形态不对视为无法判定
  if (!timeZone.includes('/') && timeZone !== 'UTC') return 'unknown'
  return 'non-gdpr'
}

/** 地域 → 默认开关：GDPR 区与无法判定 → 关（opt-in）；其余 → 开（opt-out） */
export function resolveDefaultEnabled(region: TelemetryRegion): boolean {
  return region === 'non-gdpr'
}

/** 合成最终 consent 状态：用户显式选择优先，未选择跟随地域默认 */
export function resolveConsentState(
  timeZone: string | undefined | null,
  settings: TelemetryConsentSettings | undefined,
): TelemetryConsentState {
  const region = resolveRegionFromTimeZone(timeZone)
  const defaultEnabled = resolveDefaultEnabled(region)
  return {
    region,
    defaultEnabled,
    posthogEnabled: settings?.posthogEnabled ?? defaultEnabled,
    agentEvolutionEnabled: settings?.agentEvolutionEnabled ?? defaultEnabled,
  }
}
