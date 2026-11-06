/**
 * Provider Profile 注册表
 *
 * 调用层只通过 getProfile(provider) 拿到对应 profile，不应直接 import 具体 profile 文件。
 * 新增 provider 只需：扩 ProviderType 联合（@asci/shared） + 在此 Map 加一行。
 */

import type { ProviderType } from '@asci/shared'
import type { ProviderProfile } from './profile.ts'
import { anthropicProfile } from './profiles/anthropic-profile.ts'
import { minimaxProfile } from './profiles/minimax-profile.ts'
import { kimiProfile } from './profiles/kimi-profile.ts'
import { moonshotProfile } from './profiles/moonshot-profile.ts'
import { deepseekProfile } from './profiles/deepseek-profile.ts'
import { openrouterProfile } from './profiles/openrouter-profile.ts'
import { glmProfile } from './profiles/glm-profile.ts'

import { createCustomProfile } from './custom-providers.ts'

const profileRegistry: ReadonlyMap<ProviderType, ProviderProfile> = new Map<
  ProviderType,
  ProviderProfile
>([
  ['anthropic', anthropicProfile],
  ['minimax', minimaxProfile],
  ['kimi', kimiProfile],
  ['moonshot', moonshotProfile],
  ['deepseek', deepseekProfile],
  ['openrouter', openrouterProfile],
  ['glm', glmProfile],
  ['custom-anthropic', createCustomProfile('custom-anthropic')],
  ['custom-openai', createCustomProfile('custom-openai')],
  ['custom-image', createCustomProfile('custom-image')],
])

export function getProfile(provider: ProviderType): ProviderProfile {
  const profile = profileRegistry.get(provider)
  if (!profile) {
    throw new Error(
      `不支持的供应商: ${provider}。你可能过去使用的是 ASCI 商业版，请重新下载商业版覆盖安装，当前版本为开源版本。`,
    )
  }
  return profile
}

export function getAllProfiles(): ProviderProfile[] {
  return Array.from(profileRegistry.values())
}
