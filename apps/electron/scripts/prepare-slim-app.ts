/** Produce a slim darwin-arm64 app from a built full app; never touch user data. */
import { stageOptionalPythonPayload } from './lib/optional-python-payload'
import { cpSync, existsSync, lstatSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
const [inputArg,outputArg]=process.argv.slice(2)
if(!inputArg || !outputArg) throw new Error('Usage: bun scripts/prepare-slim-app.ts <full.app> <slim.app>')
if(process.platform!=='darwin' || process.arch!=='arm64') throw new Error('Slim packaging currently supports darwin-arm64 only')
const input=resolve(inputArg),output=resolve(outputArg)
if(input===output || !relative(input,output).startsWith('..') || !relative(output,input).startsWith('..')) throw new Error('Source and output must be separate directories')
if(existsSync(output)) throw new Error('Output exists; use a new directory')
const appRoot=join(input,'Contents/Resources/app')
for(const f of ['dist/main.cjs','dist/renderer/index.html','node_modules/@anthropic-ai/claude-agent-sdk/package.json']) if(!existsSync(join(appRoot,f))) throw new Error(`Full app missing ${f}`)
cpSync(input,output,{recursive:true,dereference:false})
const modules=join(output,'Contents/Resources/app/node_modules')
const removed:string[]=[]
for(const name of readdirSync(modules)) {
 if(['onnxruntime-node','onnxruntime-common','ffmpeg-static','sherpa-onnx-node'].includes(name) || name.startsWith('sherpa-onnx-')) {
  rmSync(join(modules,name),{recursive:true,force:true});removed.push(name)
 }
}
let metadataBytes=0
function prune(dir:string) {
 for(const name of readdirSync(dir)) {
  const path=join(dir,name),info=lstatSync(path)
  if(info.isSymbolicLink()) continue
  if(info.isDirectory()) prune(path)
  else if(name.endsWith('.map') || name.endsWith('.d.ts') || name==='.DS_Store') {metadataBytes+=info.size;rmSync(path)}
 }
}
prune(modules)
stageOptionalPythonPayload(join(output,'Contents/Resources'))
writeFileSync(join(output,'Contents/Resources/slim-components.json'),JSON.stringify({schema:1,target:'darwin-arm64',removed:[...removed,'bundled-python','bundled-uv'],metadataBytes,download:'First use; pinned upstream artifacts; no lifecycle scripts'},null,2))
console.log(JSON.stringify({output,removed,metadataBytes}))
console.log('Re-sign the output app after slimming, then build and verify its DMG.')
