/** Executed by the required Node runtime, only when Python/uv is invoked. */
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { ensurePythonRuntime, optionalPythonCacheName } from './runtime'
async function main() {
 const [tool,...args]=process.argv.slice(2)
 if(tool!=='python' && tool!=='uv') throw new Error('Unknown optional runtime entrypoint')
 const root=join(dirname(__filename),'..','optional-python',optionalPythonCacheName())
 const bins=await ensurePythonRuntime(root,{
  onProgress: message=>console.error(`[ASCI] ${message}`),
  ...(process.env.ASCI_OPTIONAL_RUNTIME_OFFLINE==='1'?{fetcher:async()=>{throw new Error('离线状态下组件尚未安装；请联网后重试')}}:{}),
 })
 const child=spawn(bins[tool],args,{stdio:'inherit',env:{...process.env,UV_PYTHON:process.env.UV_PYTHON??bins.python,PATH:[dirname(bins.python),dirname(bins.uv),process.env.PATH].filter(Boolean).join(':')}})
 for(const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>child.kill(signal))
 child.on('error',err=>{console.error(`[ASCI] Python/uv 启动失败：${err.message}`);process.exitCode=1})
 child.on('exit',(code,signal)=>{process.exitCode=code??(signal==='SIGINT'?130:143)})
}
main().catch(err=>{console.error(`[ASCI] Python 环境未就绪：${err instanceof Error?err.message:String(err)}。请重试。`);process.exitCode=1})
