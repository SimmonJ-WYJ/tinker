/**
 * Channel capabilities：基于 ProviderProfile 的统一查询入口
 *
 * 从 @asci/shared/utils/channel-capabilities 迁移过来，原 switch 改为读 profile。
 * 新增 provider 只需扩 ProviderType + profileRegistry，本文件零代码改动。
 */

import type { Channel, ChannelCapabilities, ProviderType } from '@asci/shared'
import { getProfile } from './profile-registry.ts'

/** 按 provider 计算默认能力 */
export function getDefaultCapabilities(
  provider: ProviderType,
): ChannelCapabilities & Required<Pick<ChannelCapabilities, 'supportsPdfDocumentBlock'>> {
  return getProfile(provider).defaultCapabilities()
}

/**
 * 获取 channel 的 effective 能力。
 *
 * 行为：以 provider 默认为底，channel.capabilities 上字段逐项覆盖。
 * 字段缺省（undefined）时回退到默认；字段为 false 时显式覆盖为 false。
 */
export function getEffectiveCapabilities(
  channel: Pick<Channel, 'provider' | 'capabilities'>,
): ChannelCapabilities & Required<Pick<ChannelCapabilities, 'supportsPdfDocumentBlock'>> {
  const defaults = getDefaultCapabilities(channel.provider)
  const overrides = channel.capabilities
  if (!overrides) return defaults
  return {
    ...overrides,
    supportsPdfDocumentBlock:
      overrides.supportsPdfDocumentBlock ?? defaults.supportsPdfDocumentBlock,
  }
}
