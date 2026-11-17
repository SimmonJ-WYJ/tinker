/** 平台边界：同步启动快照、异步请求、事件订阅和原生文件路径。 */
/** 仅文档内取消排队探测，不跨 IPC，也不授予任何端点权限。 */
export interface ChannelProbeOptions { signal: AbortSignal }
export interface PlatformTransport {
  invokeWithSignal?<T>(signal: AbortSignal, channel: string, ...args: unknown[]): Promise<T>
  readonly credentialedChannels?: boolean
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>
  readSync<T>(channel: string, ...args: unknown[]): T
  subscribe<T>(channel: string, callback: (data: T) => void): () => void
  getPathForFile(file: File): string
}
