import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readImageReferences } from './image-reference.ts'
test('参考图只读会话范围，保留顺序，拒绝伪图和越界链接', () => {
 const root = mkdtempSync(join(tmpdir(), 'asci-ref-')); const outside = mkdtempSync(join(tmpdir(), 'asci-out-'))
 try {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
  writeFileSync(join(root,'first.png'), png); writeFileSync(join(root,'second.png'), png)
  expect(readImageReferences([join(root,'second.png'),join(root,'first.png')],[root]).map(image=>image.name)).toEqual(['second.png','first.png'])
  writeFileSync(join(root,'fake.png'), '<html>'); expect(()=>readImageReferences([join(root,'fake.png')],[root])).toThrow('PNG')
  writeFileSync(join(outside,'secret.png'), png); symlinkSync(join(outside,'secret.png'),join(root,'link.png'))
  expect(()=>readImageReferences([join(root,'link.png')],[root])).toThrow('attached')
 } finally { rmSync(root,{recursive:true,force:true}); rmSync(outside,{recursive:true,force:true}) }
})
test('重复引用同一本地图片时只上传一次并保留首次顺序',()=>{
 const root=mkdtempSync(join(tmpdir(),'asci-ref-'))
 try {
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
  const path=join(root,'one.png');writeFileSync(path,png)
  expect(readImageReferences([path,path,path,path,path],[root])).toHaveLength(1)
 } finally {rmSync(root,{recursive:true,force:true})}
})
