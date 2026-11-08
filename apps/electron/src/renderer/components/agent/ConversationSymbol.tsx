import * as React from 'react'
import symbol from '@/assets/conversation/assistant-symbol.svg'
import { TinkerLogo } from '@/components/auth/TinkerLogo'

/** 浅色使用 Figma 原始 19.8046×20.4169 SVG；深色复用同版官方 VI 的主题组件。 */
export function ConversationSymbol(): React.ReactElement {
  return <span className="conversation-symbol" aria-hidden="true">
    <img src={symbol} alt="" className="conversation-symbol__light" />
    <TinkerLogo className="conversation-symbol__dark" />
  </span>
}
