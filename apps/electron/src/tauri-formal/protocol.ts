/** 正式原生宿主的窄 DTO；业务 API 仍复用原 preload 工厂。 */
import type { AgentStreamEvent, SDKMessage } from '@asci/shared'
import type { AppSettings, UserProfile, ResolvedTheme } from '../types/index.ts'
export interface PlatformSnapshot {
  version: number
  revision: number
  settings: Omit<AppSettings, 'agentEffort'> & { agentEffort?: AppSettings['agentEffort'] | ''; sessionDrafts?: Record<string, string> }
  userProfile: UserProfile
  workspaces: unknown[]
  theme: ResolvedTheme
  chrome: { platform: string; fullscreen: boolean }
}
export interface ActiveRun {
  sessionId: string
  requestId: string
  startedAt: number
  currentSnapshot: AgentStreamEvent
  cursor: number
}
export interface Bootstrap {
  credentialedChannels?: boolean
  queueing?: boolean
  environmentSequence?: number
  generation: string
  platformSnapshot: PlatformSnapshot
  activeRuns: ActiveRun[]
}
export interface StreamEnvelope {
  version: number
  generation: string
  deliverySequence: number
  channel: string
  payload: { sessionId: string; [key: string]: unknown }
}
export type NativeEvent = StreamEnvelope | { kind: 'environment'; sequence: number; snapshot: PlatformSnapshot } | { kind: 'action'; action: 'close' | 'reload' | 'close-tab' }
export interface NativeBridge {
  request<T>(request: Record<string, unknown>): Promise<T>
  listen(callback: (event: NativeEvent) => void): Promise<() => void>
}
export interface RestoreBundle {
  chainStates?: {sessionId:string;chainId:string;closureReason:string|null}[]
  restoreToken: string
  deliverySequence: number
  messages: unknown[]
  sdkMessages: SDKMessage[]
  activeSnapshot: ActiveRun | null
  cursor: number
}
export const STREAM_CHANNELS = ['agent:stream:event', 'agent:stream:complete', 'agent:stream:error'] as const
export const MUTATION_CHANNELS = new Set([
  'channel:update', 'settings:update', 'user-profile:update', 'agent:set-reasoning-effort',
  ...['start', 'advance', 'skip-sub-stage', 'complete', 'skip', 'restart'].map((name) => `onboarding-spotlight:${name}`),
  ...['start', 'advance', 'skip', 'complete', 'restart'].map((name) => `concept-spotlight:${name}`),
])
