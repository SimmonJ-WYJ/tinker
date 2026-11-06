/** Lazy native components. No download happens at import or MCP ListTools time. */
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { installComponent, type Artifact } from './installer'
import manifest from '../optional-runtime-manifest.json'

const bundledRequire = createRequire(typeof __filename === 'string' ? __filename : join(process.cwd(),'package.json'))
export class OptionalRuntimeError extends Error {
 readonly retryable = true
 constructor(cause: unknown) { super(`本机组件未就绪：${cause instanceof Error ? cause.message : String(cause)}。请重试；已安装的组件会保留。`); this.name='OptionalRuntimeError' }
}
export type ComponentProgress = (message: string) => void
function root(component: string): string {
 const home=process.env.ASCI_CONFIG_HOME ?? homedir()
 return join(home,process.env.ASCI_DEV==='1'?'.asci-dev':'.asci','optional-runtimes','v1',`${manifest.platform}-${component}`)
}
function bundled(name: string): string | undefined {
 if(process.env.ASCI_OPTIONAL_RUNTIME_ONLY==='1') return undefined
 try {return bundledRequire.resolve(name)} catch {return undefined}
}
async function component(name: 'onnx'|'speech'|'ffmpeg', onProgress?: ComponentProgress): Promise<string> {
 if(`${process.platform}-${process.arch}`!==manifest.platform) throw new Error('当前精简版尚不支持此平台的本机组件，请使用完整版')
 const names=name==='onnx'?['onnxruntime-node','onnxruntime-common']:name==='speech'?['sherpa-onnx-node','sherpa-onnx-darwin-arm64']:['ffmpeg']
 const artifacts=manifest.artifacts.filter(a=>names.includes(a.name)) as Artifact[]
 try { return await installComponent({root:root(name),artifacts,onProgress}) } catch(err) { throw new OptionalRuntimeError(err) }
}
export async function loadOnnxRuntime(onProgress?: ComponentProgress): Promise<typeof import('onnxruntime-node')> {
 const installed=bundled('onnxruntime-node')
 if(installed) return bundledRequire(installed) as typeof import('onnxruntime-node')
 const dir=await component('onnx',onProgress)
 return createRequire(join(dir,'entry.cjs'))('onnxruntime-node') as typeof import('onnxruntime-node')
}
export async function loadSpeechRuntime(onProgress?: ComponentProgress): Promise<unknown> {
 const installed=bundled('sherpa-onnx-node')
 if(installed) return bundledRequire(installed)
 const dir=await component('speech',onProgress)
 return createRequire(join(dir,'entry.cjs'))('sherpa-onnx-node')
}
export async function getFfmpegPath(onProgress?: ComponentProgress): Promise<string> {
 const installed=bundled('ffmpeg-static')
 if(installed) {
  const path=bundledRequire(installed) as string | null
  if(path && existsSync(path)) return path
 }
 return join(await component('ffmpeg',onProgress),'ffmpeg')
}
