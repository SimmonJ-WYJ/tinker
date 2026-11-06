/** AI 运行指示：使用库的行内调校尺寸，自动遵循主题、离屏暂停与系统减少动态效果。 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { ThinkingOrb, type OrbState } from 'thinking-orbs'
import { isDarkAtom } from '@/atoms/theme-atoms'
export interface AIThinkingOrbProps { state?: OrbState; size?: 20 | 32 | 64; paused?: boolean; speed?: number; className?: string }
export function AIThinkingOrb({ state = 'working', size = state === 'working' ? 32 : 20, paused = false, speed = state === 'working' ? 0.6 : 1, className }: AIThinkingOrbProps): React.ReactElement {
 const dark = useAtomValue(isDarkAtom)
 // Keep the semantic state for the surrounding UI, but use the spherical preset
 // for coding work rather than the sparse orbit-particle preset.
 const visualState = state === 'working' ? 'searching' : state
 return <span aria-hidden="true" data-thinking-orb={state} data-orb-visual={visualState} className={className} style={{ display: 'inline-flex', width: size, height: size, flexShrink: 0, pointerEvents: 'none' }}>
   <ThinkingOrb state={visualState} size={size} theme={dark ? 'dark' : 'light'} speed={speed} paused={paused} aria-hidden="true" />
 </span>
}
