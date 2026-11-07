import type { ImageProtocol, ProviderType } from '@asci/shared'
import { getProviderLogo } from '@/lib/model-logo'
import openai from '@/assets/models/openai.png'
import gemini from '@/assets/models/gemini.png'

export function getChannelProtocolLabel(provider: ProviderType, imageProtocol?: ImageProtocol): string | undefined {
  if (provider === 'custom-openai') return 'OpenAI'
  if (provider === 'custom-anthropic') return 'Anthropic'
  if (provider === 'custom-image') {
    if (imageProtocol === 'gemini-content') return 'Gemini · generateContent'
    if (imageProtocol === 'gemini-interactions') return 'Gemini · Interactions'
    return 'OpenAI Images'
  }
}

export function ChannelProviderMark({ provider, imageProtocol }: { provider: ProviderType; imageProtocol?: ImageProtocol }) {
  // 中转站使用已配置的接口协议识别图标，不根据渠道名称推断来源。
  const logo = provider === 'custom-anthropic' ? getProviderLogo('anthropic')
    : provider === 'custom-openai' ? openai
      : provider === 'custom-image' ? (imageProtocol && imageProtocol !== 'openai-images' ? gemini : openai)
        : getProviderLogo(provider)
  return <img src={logo} alt="" className="size-9 shrink-0 rounded-lg object-contain" />
}
