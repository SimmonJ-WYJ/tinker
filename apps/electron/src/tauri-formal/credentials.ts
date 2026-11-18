/** 受管保存仅暂存私有密钥；公开回执和待重试请求只保留不透明引用。 */
import type { Channel, ChannelCreateInput, ChannelUpdateInput } from '@asci/shared'
import type { PlatformSnapshot } from './protocol.ts'

interface Request {
  version: number
  channel: string
  args: unknown[]
  mutation: {
    mutationId: string
    expectedRevision: number
  }
}
interface Reply {
  value: unknown
  snapshot?: PlatformSnapshot
}
interface Pending {
  intent: string
  request: Request
  staged: boolean
}

const WRITES = new Set(['channel:create', 'channel:update', 'channel:delete'])
const UNCERTAIN = new Set([
  'runtimeUnavailable',
  'transportTimeout',
  'deadline',
  'timeout',
  'commandTimeout',
  'staleGeneration',
  'recoveryRequired',
  'storeIo',
  'vaultWriteUncertain',
  'helperTimeout',
  'helperUnavailable',
  'hostUnavailable',
  'hostClosed',
  'invalidReply',
])

export function isUncertainMutationFailure(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : 'runtimeUnavailable'
  return UNCERTAIN.has(code)
}

export function createCredentialTransport(
  command: <T>(name: string, args: Record<string, unknown>) => Promise<T>,
  revision: () => number,
  fail: (code: string) => Error,
) {
  let channels = new Map<string, Channel>()
  let pending: Pending | undefined
  const identities = new WeakMap<object, string>()

  function identity(value: object): string {
    let id = identities.get(value)
    if (!id) {
      id = crypto.randomUUID()
      identities.set(value, id)
    }
    return id
  }

  function observe(channel: string, value: unknown): void {
    if (channel === 'channel:list' && Array.isArray(value)) {
      channels = new Map((value as Channel[]).map(item => [item.id, item]))
    }
  }

  function normalized(channel: string, args: unknown[]): {
    request: Request
    secret: string
    intent: string
  } {
    const mutation = {
      mutationId: crypto.randomUUID(),
      expectedRevision: revision(),
    }
    if (channel === 'channel:delete') {
      return {
        request: { version: 1, channel, args, mutation },
        secret: '',
        intent: `delete:${String(args[0])}`,
      }
    }
    const input = (channel === 'channel:create' ? args[0] : args[1]) as ChannelCreateInput | ChannelUpdateInput
    if (!input || typeof input !== 'object') throw fail('invalidParams')
    const old = channel === 'channel:update' ? channels.get(String(args[0])) : undefined
    if (channel === 'channel:update' && !old) throw fail('channelNotFound')
    const merged = { ...old, ...input }
    const protocol = merged.provider === 'custom-openai'
      ? 'openai-chat'
      : merged.provider === 'custom-anthropic' ? 'anthropic-messages' : undefined
    if (!protocol) throw fail('unsupportedProvider')
    const secret = input.apiKey ?? ''
    const bindingChanged = old && (
      merged.provider !== old.provider ||
      merged.baseUrl?.replace(/\/+$/, '') !== old.baseUrl.replace(/\/+$/, '')
    )
    if (!secret && bindingChanged) throw fail('credentialReplacementRequired')
    const spec = {
      id: old?.id ?? crypto.randomUUID(),
      name: merged.name,
      protocol,
      baseUrl: merged.baseUrl,
      enabled: merged.enabled,
      models: merged.models?.map(model => ({
        modelId: model.id,
        label: model.name,
        supportedEfforts: model.supportedEfforts ?? [],
        enabled: model.enabled,
      })),
    }
    return {
      request: {
        version: 1,
        channel,
        args: [{ channel: spec, credential: 'keep' }],
        mutation,
      },
      secret,
      intent: input.credentialIntentId ?? identity(input),
    }
  }

  async function commitPending(): Promise<Reply> {
    const operation = pending
    if (!operation?.staged) throw fail('stageUncertain')
    const request = operation.request
    try {
      const reply = await command<Reply>('invoke', {
        channel: request.channel,
        args: request.args,
        mutation: request.mutation,
      })
      // 只有明确回执才释放旧意图；恢复调用不需要旧表单仍然存在。
      pending = undefined
      if (request.channel === 'channel:delete') {
        channels.delete(String(request.args[0]))
      } else if (reply.value && typeof reply.value === 'object') {
        const item = reply.value as Channel
        channels.set(item.id, item)
      }
      return reply
    } catch (error) {
      if (!isUncertainMutationFailure(error)) pending = undefined
      throw error
    }
  }

  return {
    handles: (channel: string) => WRITES.has(channel),
    observe,
    guard(): void {
      if (pending) throw fail('mutationPending')
    },
    async reconcile(): Promise<Reply | undefined> {
      // 未知stage没有可重放引用，保持不确定；绝不重新导入或清除此意图。
      if (!pending?.staged) return undefined
      return commitPending()
    },
    async invoke(channel: string, args: unknown[]): Promise<Reply> {
      const candidate = normalized(channel, args)
      if (pending && (pending.intent !== candidate.intent || pending.request.channel !== channel)) {
        throw fail('mutationPending')
      }
      if (pending && !pending.staged) throw fail('stageUncertain')
      if (!pending) {
        pending = {
          intent: candidate.intent,
          request: candidate.request,
          staged: !candidate.secret,
        }
        if (candidate.secret) {
          try {
            const reply = await command<{ value: Request }>('invoke', {
              channel: 'channel:stage',
              args: [{ request: candidate.request, secret: candidate.secret }],
            })
            pending.request = reply.value
            pending.staged = true
          } catch (error) {
            if (!isUncertainMutationFailure(error)) pending = undefined
            throw error
          }
        }
      }
      return commitPending()
    },
    dispose(): void {
      channels.clear()
      pending = undefined
    },
  }
}
