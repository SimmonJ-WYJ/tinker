/** 有界 JSONL 传输；失联一次性结束全部请求，不重启或重放副作用。 */
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { DESKTOP_RUNTIME_MAX_FRAME_BYTES, DESKTOP_RUNTIME_MAX_PENDING } from '@asci/shared'
import type { DesktopMethod, DesktopParams, DesktopResults } from '@asci/shared'
import { decodeEnvelope, decodeResult } from './decode.ts'
import type { DesktopPreviewConfig } from './config.ts'
interface Pending { method: DesktopMethod; resolve: (value: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
export class DesktopClient {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly pending = new Map<string, Pending>()
  private buffer = Buffer.alloc(0)
  private serial = 0
  private dead = false
  constructor(config: DesktopPreviewConfig, private readonly timeoutMs = 10000) {
    this.child = spawn(config.binary, ['--root', config.root, '--profiles-file', config.profilesFile], {
      cwd: config.root, env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' }, stdio: 'pipe',
    })
    this.child.stdout.on('data', (chunk: Buffer) => this.read(chunk))
    this.child.stdout.once('end', () => this.fail())
    this.child.stdout.once('close', () => this.fail())
    this.child.stdout.once('error', () => this.fail())
    // stderr 只排空，不能将不可信子进程内容回显至 UI 或日志。
    this.child.stderr.resume()
    this.child.once('error', () => this.fail())
    this.child.once('exit', () => this.fail())
    this.child.stdin.on('error', () => this.fail())
  }
  request<M extends DesktopMethod>(method: M, params: DesktopParams[M]): Promise<DesktopResults[M]> {
    if (this.dead) return Promise.reject(new Error('DESKTOP_TRANSPORT'))
    if (this.pending.size >= DESKTOP_RUNTIME_MAX_PENDING) return Promise.reject(new Error('DESKTOP_BUSY'))
    const id = `host_${++this.serial}`
    const frame = JSON.stringify({ version: 1, id, method, params }) + '\n'
    if (Buffer.byteLength(frame) > DESKTOP_RUNTIME_MAX_FRAME_BYTES) return Promise.reject(new Error('DESKTOP_LIMIT'))
    return new Promise<DesktopResults[M]>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(), this.timeoutMs)
      this.pending.set(id, { method, resolve: value => resolve(value as DesktopResults[M]), reject, timer })
      this.child.stdin.write(frame)
    })
  }
  private read(chunk: Buffer): void {
    if (this.dead) return
    this.buffer = Buffer.concat([this.buffer, chunk])
    try {
      let boundary: number
      while ((boundary = this.buffer.indexOf(10)) !== -1) {
        if (boundary + 1 > DESKTOP_RUNTIME_MAX_FRAME_BYTES) throw new Error()
        const frame = this.buffer.subarray(0, boundary)
        this.buffer = this.buffer.subarray(boundary + 1)
        const json = new TextDecoder('utf-8', { fatal: true }).decode(frame)
        const reply = decodeEnvelope(JSON.parse(json))
        const pending = this.pending.get(reply.id)
        if (!pending) throw new Error()
        const result = reply.error ? undefined : decodeResult(pending.method, reply.result)
        clearTimeout(pending.timer)
        this.pending.delete(reply.id)
        if (reply.error) pending.reject(new Error(reply.error.code))
        else pending.resolve(result)
      }
      if (this.buffer.length >= DESKTOP_RUNTIME_MAX_FRAME_BYTES) throw new Error()
    } catch { this.fail() }
  }
  close(): void { this.fail() }
  private fail(): void {
    if (this.dead) return
    this.dead = true
    this.buffer = Buffer.alloc(0)
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('DESKTOP_TRANSPORT')) }
    this.pending.clear()
    this.child.stdin.destroy()
    this.child.kill()
  }
}
