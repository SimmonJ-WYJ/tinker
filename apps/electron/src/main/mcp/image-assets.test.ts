import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, unlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImageAssets } from './image-assets.ts'
test('图片记录重建后仍可按 latest 和 ID 找到，删除后报错且拒绝越界', () => {
 const dir = mkdtempSync(join(tmpdir(), 'asci-assets-'))
 try {
  writeFileSync(join(dir, 'one.png'), 'image')
  const store = new ImageAssets(dir)
  store.add({ id: 'one', filename: 'one.png', model: 'm', channelId: 'c', prompt: 'original', referenceIds: [] })
  const restored = new ImageAssets(dir)
  expect(restored.get('latest').id).toBe('one')
  expect(restored.path('one')).toBe(realpathSync(join(dir, 'one.png')))
  expect(() => restored.add({id:'bad',filename:'../secret.png',model:'m',channelId:'c',prompt:'',referenceIds:[]})).toThrow()
  unlinkSync(join(dir, 'one.png'))
  expect(() => restored.get('latest')).toThrow()
 } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('图片 ID 不可改写，缺失文件在清单中明确标记；截断尾行不吞掉已有图片', () => {
 const dir=mkdtempSync(join(tmpdir(),'asci-assets-'))
 try {
  writeFileSync(join(dir,'one.png'),'image');writeFileSync(join(dir,'two.png'),'image')
  const store=new ImageAssets(dir);const original={id:'one',filename:'one.png',model:'m',channelId:'c',prompt:'original',referenceIds:[]}
  store.add(original);store.add(original);expect(store.list()).toHaveLength(1)
  expect(()=>store.add({...original,filename:'two.png'})).toThrow('immutable')
  unlinkSync(join(dir,'one.png'));expect(store.list()[0]?.available).toBe(false)
  writeFileSync(join(dir,'one.png'),'image')
  const index=join(dir,'image-assets.jsonl')
  writeFileSync(index,JSON.stringify(original));store.add({...original,id:'two',filename:'two.png'});expect(store.list()).toHaveLength(2)
  writeFileSync(index,JSON.stringify(original)+'\n{"id":')
  const restored=new ImageAssets(dir);expect(restored.get('one').id).toBe('one');expect(restored.warnings()).toHaveLength(1)
  expect(()=>restored.assertWritable()).toThrow('incomplete')
 } finally {rmSync(dir,{recursive:true,force:true})}
})
