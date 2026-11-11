/** RPC/关闭等待具有上限；迟到的 Promise 不会再次进入调用方流程。 */
export async function withDeadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject({ code: 'transportTimeout' }), Math.max(0, milliseconds))
    })])
  } finally { clearTimeout(timer) }
}
