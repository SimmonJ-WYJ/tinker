import { join } from 'node:path'
import manifest from '../optional-python-manifest.json'
import { installComponent, type Artifact, type InstallOptions } from '../optional-runtime/installer'
export function optionalPythonCacheName(): string {
 const python=manifest.artifacts.find(a=>a.name==='python')!
 const uv=manifest.artifacts.find(a=>a.name==='uv')!
 return `python-${python.version}-uv-${uv.version}-${manifest.platform}`
}
export async function ensurePythonRuntime(root: string, options: Pick<InstallOptions,'fetcher'|'onProgress'> = {}): Promise<{python:string;uv:string}> {
 if(`${process.platform}-${process.arch}`!==manifest.platform) throw new Error('此按需 Python 环境仅适用于 Apple Silicon，请使用对应平台完整版')
 const dir=await installComponent({root,artifacts:manifest.artifacts as Artifact[],...options})
 return {python:join(dir,'python','python','bin','python3.12'),uv:join(dir,'uv','uv-aarch64-apple-darwin','uv')}
}
