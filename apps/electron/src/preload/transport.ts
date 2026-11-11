/** 平台边界：同步启动快照、异步请求、事件订阅和原生文件路径。 */
export interface PlatformTransport {
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>
  readSync<T>(channel: string, ...args: unknown[]): T
  subscribe<T>(channel: string, callback: (data: T) => void): () => void
  getPathForFile(file: File): string
}
