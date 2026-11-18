import {expect,test} from 'bun:test'
import {readFileSync} from 'node:fs'
import ordinary from '../src-tauri/tauri.channels.conf.json'
import qa from '../src-tauri/tauri.channels-qa.conf.json'
const read=(name:string)=>readFileSync(new URL(name,import.meta.url),'utf8')
test('credentialed assemblies preserve original UI, separate identities and explicit no-default feature selection',()=>{
 expect(ordinary.identifier).toBe('com.tinker.channels-preview');expect(qa.identifier).toBe('com.tinker.channels-native-qa');expect(qa.identifier).not.toBe(ordinary.identifier)
 const build=read('./build-channels-common.ts');expect(build).toContain("'vite.formal.config.ts'");expect(build).not.toContain('vite.native-qa.config.ts');expect(build).toContain("'--no-default-features'");expect(build).toContain('custom-protocol,formal-native-qa');expect(build).toContain('custom-protocol,formal-preview');expect(build).toContain('tinker-tauri-channels-package-');expect(build).toContain('bavail * disk.bsize < 4 * 1024 ** 3');expect(build).not.toContain('rmSync(');expect(build).not.toContain('/Applications');expect(build).toContain("'--verify', '--deep', '--strict'")
 expect(read('./build-channels.ts')).toContain('buildChannels(false)');expect(read('./build-channels-native-qa.ts')).toContain('buildChannels(true)')
})
