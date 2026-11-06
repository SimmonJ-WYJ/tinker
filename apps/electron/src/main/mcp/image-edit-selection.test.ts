import { test, expect } from 'bun:test'
import { bindImageEditSelection } from './image-edit-selection.ts'
test('选择确定版本后不能被 latest 或另一图片替换',()=>{
 expect(bindImageEditSelection('version-a',undefined)).toBe('version-a')
 expect(bindImageEditSelection('version-a','version-a')).toBe('version-a')
 expect(()=>bindImageEditSelection('version-a','latest')).toThrow('mismatch')
 expect(()=>bindImageEditSelection('version-a','version-b')).toThrow('mismatch')
 expect(bindImageEditSelection(undefined,'latest')).toBe('latest')
})
test('宿主预检拒绝非确定版本、其他会话和已删除文件',()=>{
 const {mkdtempSync,writeFileSync,unlinkSync,rmSync}=require('node:fs') as typeof import('node:fs')
 const {tmpdir}=require('node:os') as typeof import('node:os')
 const {join}=require('node:path') as typeof import('node:path')
 const {ImageAssets}=require('./image-assets.ts') as typeof import('./image-assets.ts')
 const {validateImageEditSelection}=require('./image-edit-selection.ts') as typeof import('./image-edit-selection.ts')
 const directory=mkdtempSync(join(tmpdir(),'asci-select-'));const another=mkdtempSync(join(tmpdir(),'asci-select-other-'))
 try {
  writeFileSync(join(directory,'image.png'),'fixture')
  new ImageAssets(directory).add({id:'chosen',filename:'image.png',model:'m',channelId:'c',prompt:'p',referenceIds:[]})
  expect(()=>validateImageEditSelection(directory,'chosen')).not.toThrow()
  expect(()=>validateImageEditSelection(directory,'latest')).toThrow()
  expect(()=>validateImageEditSelection(another,'chosen')).toThrow()
  unlinkSync(join(directory,'image.png'));expect(()=>validateImageEditSelection(directory,'chosen')).toThrow()
 } finally {rmSync(directory,{recursive:true,force:true});rmSync(another,{recursive:true,force:true})}
})
