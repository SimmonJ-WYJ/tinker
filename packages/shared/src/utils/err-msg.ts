/**
 * 把任意 unknown 错误规整成字符串消息。
 *
 * 主进程模块（runtime-bootstrapper / runtime-provisioner 等）多次复制此函数，
 * 抽到 shared 单源，避免漂移。
 */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
