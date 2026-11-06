import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
/** Called only for a fresh slim app copy. Never modifies user runtimes. */
export function stageOptionalPythonPayload(resources: string): void {
 const launcher=join(resources,'app/dist/resources/optional-python-launcher.cjs')
 const root=join(resources,'runtimes')
 if(!existsSync(launcher) || !existsSync(join(root,'node/bin/node'))) throw new Error('Slim Python staging requires built launcher and bundled Node')
 rmSync(join(root,'python'),{recursive:true,force:true});rmSync(join(root,'uv'),{force:true})
 cpSync(launcher,join(root,'optional-python-launcher.cjs'))
 const pyBin=join(root,'python/runtime/bin');mkdirSync(pyBin,{recursive:true})
 const wrapper=(depth:string,tool:string)=>`#!/bin/sh\nexec "$(dirname "$0")/${depth}node/bin/node" "$(dirname "$0")/${depth}optional-python-launcher.cjs" ${tool} "$@"\n`
 writeFileSync(join(root,'uv'),wrapper('','uv'),{mode:0o755})
 for(const name of ['python','python3','python3.12']) writeFileSync(join(pyBin,name),wrapper('../../../','python'),{mode:0o755})
 writeFileSync(join(root,'.optional-python'),'1\n')
}
