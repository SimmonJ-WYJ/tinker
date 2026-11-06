/** 会话内生成图片的持久索引；版本不可改写，缺失文件和截断记录显式暴露。 */
import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
export interface ImageAsset {
 id: string
 filename: string
 model: string
 channelId: string
 prompt: string
 referenceIds: string[]
 baseImageId?: string
}
export class ImageAssets {
 constructor(private readonly directory: string) {}
 private entries(): { assets: ImageAsset[]; warnings: string[] } {
  const file=join(this.directory,'image-assets.jsonl')
  if(!existsSync(file)) return {assets:[],warnings:[]}
  const raw=readFileSync(file,'utf8');const lines=raw.split('\n');const assets:ImageAsset[]=[];const warnings:string[]=[]
  for(let index=0;index<lines.length;index++) {
   const line=lines[index]!;if(!line.trim()) continue
   let item:ImageAsset
   try {item=JSON.parse(line) as ImageAsset}
   catch(error) {
    if(index===lines.length-1 && !raw.endsWith('\n')) {warnings.push('Image index has an incomplete final record. Existing versions remain readable.');continue}
    throw error
   }
   if(typeof item.id!=='string' || typeof item.filename!=='string' || typeof item.channelId!=='string' || typeof item.model!=='string' || !Array.isArray(item.referenceIds)) throw new Error('Invalid image asset index')
   assets.push(item)
  }
  return {assets,warnings}
 }
 warnings(): string[] {return this.entries().warnings}
 assertWritable(): void {if(this.warnings().length) throw new Error('Image index is incomplete. Existing images remain readable; repair the index before a new paid request.')}
 list(): (ImageAsset & {available:boolean})[] {
  return this.entries().assets.map(asset=>{
   try {this.checkedPath(asset.filename);return {...asset,available:true}}
   catch {return {...asset,available:false}}
  })
 }
 add(asset:ImageAsset):void {
  this.assertWritable();this.checkedPath(asset.filename)
  const existing=this.entries().assets.find(item=>item.id===asset.id)
  if(existing) {
   if(JSON.stringify(existing)===JSON.stringify(asset)) return
   throw new Error('Image version IDs are immutable')
  }
  const file=join(this.directory,'image-assets.jsonl')
  const separator=existsSync(file) && readFileSync(file,'utf8').length>0 && !readFileSync(file,'utf8').endsWith('\n')?'\n':''
  appendFileSync(file,separator+JSON.stringify(asset)+'\n',{mode:0o600})
 }
 private checkedPath(filename:string):string {
  if(!filename || filename!==basename(filename) || !/^[\w-]+\.(png|jpeg|webp)$/.test(filename)) throw new Error('Invalid image asset filename')
  const path=realpathSync(join(this.directory,filename))
  if(relative(realpathSync(this.directory),path)!==filename) throw new Error('Image asset is outside this session')
  return path
 }
 get(id:string):ImageAsset {
  const entries=this.entries().assets
  const asset=id==='latest'?entries.at(-1):entries.find(item=>item.id===id)
  if(!asset) throw new Error('Image asset not found in this session; use list_images to inspect available images')
  this.checkedPath(asset.filename);return asset
 }
 path(id:string):string {return this.checkedPath(this.get(id).filename)}
}
