import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImageAssets } from './image-assets.ts'
import { readSessionImageScope } from './image-turn-context.ts'

test('只收集当前会话真实图片，拒绝项目文件、逃逸链接、伪装和其他会话', () => {
 const root=mkdtempSync(join(tmpdir(),'image-scope-'))
 const directory=join(root,'session'); const other=join(root,'other.png')
 const {mkdirSync}=require('node:fs') as typeof import('node:fs')
 mkdirSync(directory)
 const png=Buffer.from([137,80,78,71,13,10,26,10])
 try {
  writeFileSync(other,png)
  writeFileSync(join(directory,'attached.png'),png)
  writeFileSync(join(directory,'generated.png'),png)
  writeFileSync(join(directory,'fake.png'),'not an image')
  symlinkSync(other,join(directory,'escape.png'))
  new ImageAssets(directory).add({id:'generated',filename:'generated.png',prompt:'p',channelId:'c',model:'m',referenceIds:[]})
  const scope=readSessionImageScope('s',directory)
  expect(scope.referenceImageIds).toEqual(['generated'])
  expect(scope.referenceImagePaths).toContain(join(directory,'attached.png'))
  expect(scope.referenceImagePaths).toContain('s/attached.png')
  expect(scope.referenceImagePaths).not.toContain(other)
  expect(scope.referenceImagePaths).not.toContain(join(directory,'escape.png'))
  expect(scope.referenceImagePaths).not.toContain(join(directory,'fake.png'))
 }finally{rmSync(root,{recursive:true,force:true})}
})

 test('用户真实上传到本会话cwd的图片可引用，历史附件继续可用；任意项目文件不扩权',()=>{
 const root=mkdtempSync(join(tmpdir(),'image-session-upload-'))
 const {mkdirSync}=require('node:fs') as typeof import('node:fs')
 const directory=join(root,'attachments'); const cwd=join(root,'session'); const other=join(root,'other')
 mkdirSync(directory);mkdirSync(cwd);mkdirSync(other)
 const png=Buffer.from([137,80,78,71,13,10,26,10])
 try {
  const uploaded=join(cwd,'uploaded.png'); const arbitrary=join(cwd,'arbitrary.png'); const foreign=join(other,'foreign.png')
  for(const file of [uploaded,arbitrary,foreign])writeFileSync(file,png)
  const messages=[`<attached_files>\n- uploaded.png: ${uploaded}\n- foreign.png: ${foreign}\n</attached_files>\n生成图片`]
  const scope=readSessionImageScope('s',directory,{sessionDirectory:cwd,userMessages:messages})
  expect(scope.referenceImagePaths).toContain(uploaded)
  expect(scope.referenceImagePaths).not.toContain(arbitrary)
  expect(scope.referenceImagePaths).not.toContain(foreign)
 }finally{rmSync(root,{recursive:true,force:true})}
 })
