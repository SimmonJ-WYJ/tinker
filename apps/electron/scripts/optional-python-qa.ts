import { mkdtempSync,existsSync,mkdirSync,writeFileSync,realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { RuntimeBootstrapper } from '../src/main/lib/runtime/runtime-bootstrapper'
import { RuntimeProvisioner } from '../src/main/lib/runtime/runtime-provisioner'
const exec=promisify(execFile)
async function main() {
 const app=process.env.ASCI_PYTHON_QA_APP
 if(!app) throw new Error('Set ASCI_PYTHON_QA_APP')
 const home=mkdtempSync(join(tmpdir(),'asci python cold '));process.env.ASCI_RUNTIMES_HOME=home;process.env.HOME=home;process.env.UV_CACHE_DIR=join(home,'uv-cache')
 const resources=join(app,'Contents/Resources')
 const status=await new RuntimeBootstrapper({resourcesPath:resources,asciVersion:'0.1.594'}).bootstrap()
 if(status.phase!=='ready') throw new Error(JSON.stringify(status))
 const rp=new RuntimeProvisioner({asciVersion:'0.1.594'})
 if((await rp.verify()).phase!=='ready') throw new Error('Core failed verification')
 if(existsSync(join(home,'optional-python'))) throw new Error('Startup downloaded Python')
 console.log('Cold bootstrap: Node ready; no Python download')
 try {await exec(rp.getUvBin(),['--version'],{env:{...process.env,ASCI_OPTIONAL_RUNTIME_OFFLINE:'1'},timeout:30_000});throw new Error('Expected offline failure')} catch(err) {
  if(!(err as {stderr?:string}).stderr?.includes('离线')) throw err
  console.log('Cold offline request: clear error; startup remains usable')
 }
 const project=join(home,'project with spaces');mkdirSync(project)
 const first=await exec(rp.getPythonInterpreter(),['-c','import ssl,sqlite3,json,os;print(json.dumps({"sum":sum(range(10)),"cwd":os.getcwd(),"ssl":bool(ssl.OPENSSL_VERSION),"sqlite":sqlite3.sqlite_version}))'],{cwd:project,env:process.env,timeout:240_000})
 console.error(first.stderr);console.log('First Python:',first.stdout.trim())
 if(JSON.parse(first.stdout).sum!==45 || realpathSync(JSON.parse(first.stdout).cwd)!==realpathSync(project)) throw new Error('Python result mismatch')
 const offline={...process.env,ASCI_OPTIONAL_RUNTIME_OFFLINE:'1'}
 const uv=await exec(rp.getUvBin(),['--version'],{env:offline,timeout:20_000});console.log('Cached offline uv:',uv.stdout.trim())
 const venv=join(project,'venv with spaces')
 await exec(rp.getUvBin(),['venv','--python',rp.getPythonInterpreter(),venv],{env:offline,timeout:30_000})
 const v=await exec(join(venv,'bin/python'),['-c','import sys;print(sys.prefix);print(6*7)'],{env:offline,timeout:20_000})
 if(!v.stdout.includes('42') || realpathSync(v.stdout.trim().split('\n')[0]!)!==realpathSync(venv)) throw new Error('Venv prefix mismatch')
 console.log('Offline venv:',v.stdout.trim())
 try {await exec(rp.getPythonInterpreter(),['-c','import sys;print(sys.argv[1]);sys.exit(7)','hello world'],{env:offline,timeout:20_000});throw new Error('Expected exit 7')} catch(err) {
  if((err as {code?:number}).code!==7 || !(err as {stdout?:string}).stdout?.includes('hello world')) throw err
  console.log('Python arguments and exit code: preserved')
 }
 const script=join(project,'hello script.py');writeFileSync(script,'print("cached script ok")')
 const result=await exec(rp.getPythonInterpreter(),[script],{env:offline,timeout:20_000});console.log(result.stdout.trim())
 console.log('QA_HOME',home)
}
main().catch(err=>{console.error(err);process.exitCode=1})
