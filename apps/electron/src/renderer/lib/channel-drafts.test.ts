import { expect, test } from 'bun:test'
import { addQuickModels } from './channel-drafts.ts'
test('多个精确模型 ID 一次添加，保留已有名字与启用选择',()=>{
 const current=[{id:'m1',name:'custom name',enabled:false},{id:'untouched',name:'Other',enabled:false}]
 const result=addQuickModels(current,'m1, vendor/m2; m3，vendor/m2','')
 expect(result.map(x=>x.id)).toEqual(['m1','untouched','vendor/m2','m3'])
 expect(result[0]).toEqual({id:'m1',name:'custom name',enabled:true})
 expect(result[1]?.enabled).toBe(false)
 expect(current[0]?.enabled).toBe(false)
})
test('整批校验拒绝密钥、无效 ID 和过大列表，原清单不变',()=>{
 for(const input of ['m1,sk-sensitive-fixture','m1,Bearer fixture','m1,<script>',Array.from({length:51},(_,i)=>`m${i}`).join(',')]){
  expect(()=>addQuickModels([],input,'')).toThrow()
 }
})
