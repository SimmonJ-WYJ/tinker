import {test,expect} from 'bun:test'
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {ImageTurnJournal} from './image-turn-journal.ts'
function journal(lines:unknown[],check:(value:ImageTurnJournal)=>void):void{
 const directory=mkdtempSync(join(tmpdir(),'image-journal-approval-'))
 try{writeFileSync(join(directory,'.image-consumed-turns.jsonl'),lines.map(value=>JSON.stringify(value)).join('\n'));check(new ImageTurnJournal(directory))}finally{rmSync(directory,{recursive:true,force:true})}
}
test('任务确认更新对应消费事实，不作为新消费重排顺序',()=>{
 journal([{id:'a',imageTask:false,queued:false},{id:'b',imageTask:false,queued:true},{kind:'image-task-confirmed',id:'a'},{kind:'image-task-confirmed',id:'a'}],value=>{
  expect(value.readable).toBe(true)
  expect(value.records).toEqual([{id:'a',imageTask:true,queued:false},{id:'b',imageTask:false,queued:true}])
 })
})
test('无消费证明或异常确认不能提供恢复语义',()=>{
 for(const event of [{kind:'image-task-confirmed',id:'unknown'},{kind:'image-task-confirmed',id:'a',approvedPaths:['/private.png']},{kind:'future-event',id:'a'}])journal([{id:'a',imageTask:false,queued:false},event],value=>{expect(value.readable).toBe(false);expect(value.records).toEqual([])})
})

test('重复确认只追加一次类别事件，不存批准参数，也不能确认未知回合',()=>{
 const directory=mkdtempSync(join(tmpdir(),'image-journal-confirm-'))
 try{
  const value=new ImageTurnJournal(directory)
  value.confirmImageTask('unknown')
  value.record('a',false,false);value.confirmImageTask('a');value.confirmImageTask('a')
  expect(new ImageTurnJournal(directory).records).toEqual([{id:'a',imageTask:true,queued:false}])
  const records=readFileSync(value.path,'utf8').trim().split('\n').filter(Boolean).map((line:string)=>JSON.parse(line))
  expect(records).toEqual([{id:'a',imageTask:false,queued:false},{kind:'image-task-confirmed',id:'a'}])
 }finally{rmSync(directory,{recursive:true,force:true})}
})
