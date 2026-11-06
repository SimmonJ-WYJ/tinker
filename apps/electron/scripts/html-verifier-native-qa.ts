import {appendFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
const trace=(s:string)=>appendFileSync('/private/tmp/asci-native-qa-trace.log',s+'\n')
trace('main loaded')
import {app} from 'electron'
import {verifyProjectHtml} from '../src/main/lib/html-preview/verify'
import {htmlPreviewServer} from '../src/main/lib/html-preview/server'
import {strict as assert} from 'node:assert'
app.setPath('userData',mkdtempSync(join(tmpdir(),'asci-html-native-user-')))
app.on('window-all-closed',()=>{})
app.whenReady().then(async()=>{
 trace('app ready')
 try{
  const root=process.env.ASCI_HTML_QA_PROJECT_ROOT
  if(!root)throw new Error('Set ASCI_HTML_QA_PROJECT_ROOT to a test counter project')
  trace('before verify')
  const result=await verifyProjectHtml(root,{path:'index.html',actions:[{selector:'#inc',count:3},{selector:'#dec'},{selector:'#reset'}],observe:['#value','#hint']})
  trace(JSON.stringify(result))
  assert.equal(result.before.observations[0].text,'0')
  assert.deepEqual(result.steps.map(s=>s.after.observations[0].text),['3','2','0'])
  assert.deepEqual(result.errors,[])
  const errorRoot=mkdtempSync(join(tmpdir(),'asci-script-error-'))
  try {
   writeFileSync(join(errorRoot,'index.html'),'<html><body>Test<script>throw new Error("QA_SCRIPT_FAILURE")</script></body></html>')
   const failed=await verifyProjectHtml(errorRoot,{path:'index.html'})
   trace(JSON.stringify({errorFixture:failed.errors}))
   assert.ok(failed.errors.some(e=>e.includes('QA_SCRIPT_FAILURE')))
  } finally {rmSync(errorRoot,{recursive:true,force:true})}
  const todoRoot=mkdtempSync(join(tmpdir(),'asci-todo-qa-'))
  try {
   writeFileSync(join(todoRoot,'index.html'),`<input id="task"><button id="add">Add</button><ul id="list"></ul><script>
   const task=document.querySelector('#task'),list=document.querySelector('#list');
   function add(){if(!task.value)return;const li=document.createElement('li');li.textContent=task.value;li.innerHTML+='<input type="checkbox"><button>Delete</button>';li.querySelector('input').onchange=e=>li.dataset.done=e.target.checked;li.querySelector('button').onclick=()=>li.remove();list.append(li);task.value='';}
   document.querySelector('#add').onclick=add;task.onkeydown=e=>{if(e.key==='Enter')add()};</script>`)
   const todo=await verifyProjectHtml(todoRoot,{path:'index.html',actions:[{type:'fill',selector:'#task',value:'First task'},{type:'press',selector:'#task',key:'Enter'},{selector:'li input'},{selector:'li button'}],observe:['#list','li input'],screenshot:true})
   assert.equal(todo.steps[1].after.observations[0].text,'First taskDelete')
   assert.equal(todo.steps[3].after.observations[0].text,'')
   assert.equal(todo.steps[2].after.observations[1].checked,true)
   assert.ok(todo.screenshot && Buffer.from(todo.screenshot,'base64').length>1000)
   writeFileSync('/private/tmp/asci-todo-verifier.png',Buffer.from(todo.screenshot!,'base64'))
   assert.deepEqual(todo.errors,[])
   console.log('Todo input / Enter / checkbox / delete: passed')
  } finally {rmSync(todoRoot,{recursive:true,force:true})}
  await assert.rejects(()=>verifyProjectHtml(root,{path:'/etc/hosts'}))
  console.log(JSON.stringify({actualChromiumClicks:result.steps.map(s=>s.after.observations[0].text),scriptErrors:result.errors,outsideProjectRejected:true,errorFixtureDetected:true}))
  await htmlPreviewServer.close();app.exit(0)
 }catch(error){trace(String(error));console.error(error);app.exit(1)}
})
