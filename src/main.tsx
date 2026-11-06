import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
type Snapshot = {draft:string; messages:string[]};
type Invoke = <T>(command:string, args:Record<string,unknown>)=>Promise<T>;
const invoke = (window as unknown as {__TAURI__?:{core:{invoke:Invoke}}}).__TAURI__?.core.invoke;
const channels = [{id:'demo',name:'演示空间',detail:'无需密钥 · 离线体验'}, {id:'local',name:'本地模型',detail:'本机服务 · 尚未接入'}, {id:'compatible',name:'自定义渠道',detail:'兼容接口 · 尚未接入'}];
const empty = ():Snapshot=>({draft:'',messages:[]});
const preview:Record<string,Snapshot> = {demo:empty(),local:empty(),compatible:empty()};
function App(){
 const [active,setActive]=useState('demo'),[snap,setSnap]=useState(empty()),[error,setError]=useState(''),[busy,setBusy]=useState(false),[settings,setSettings]=useState(false),[secret,setSecret]=useState(''),[notice,setNotice]=useState('');
 const [configs,setConfigs]=useState<Record<string,{endpoint:string;model:string}>>({local:{endpoint:'http://127.0.0.1:11434',model:''},compatible:{endpoint:'',model:''}});
 const config=configs[active];
 async function act(action:string,value='',id=active){
  if(invoke)return invoke<Snapshot>('session',{action,value});
  if(action==='select')return {...preview[value]};
  if(action==='edit')preview[id].draft=value;
  if(action==='send'){
   if(!preview[id].draft.trim())throw new Error('请输入消息');
   if(id!=='demo')throw new Error('真实模型尚未接入；草稿已保留');
   preview[id].messages.push(preview[id].draft,'这是本地演示回复，未调用任何模型。你的对话流程已经连通。');preview[id].draft='';
  }
  return {...preview[id],messages:[...preview[id].messages]};
 }
 async function select(id:string){setBusy(true);setError('');setSecret('');setNotice('');try{setSnap(await act('select',id));setActive(id)}catch(e){setError(String(e))}finally{setBusy(false)}}
 async function send(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{setSnap(await act('send'))}catch(e){setError(String(e))}finally{setBusy(false)}}
 async function edit(value:string){setSnap(s=>({...s,draft:value}));try{await act('edit',value)}catch(e){setError(String(e))}}
 async function save(){if(!invoke)return;setBusy(true);setNotice('');try{await invoke('save_secret',{channel:active,secret});setSecret('');setNotice('已保存到系统钥匙串')}catch{setNotice('保存失败；请检查系统钥匙串权限')}finally{setBusy(false)}}
 return <div className="shell"><aside><div className="brand"><span className="mark">t</span>Tinker<span className="version">01</span></div><p className="label">你的工作空间</p><nav>{channels.map(c=><button disabled={busy} aria-pressed={active===c.id} className={active===c.id?'channel selected':'channel'} key={c.id} onClick={()=>select(c.id)}><span>{c.name}</span><small>{c.detail}</small></button>)}</nav><div className="sidefoot"><span className="dot"/> 本地优先<p>想法从这里开始。</p></div></aside><main><header><div><span className="label">WORKSPACE / </span>{channels.find(c=>c.id===active)?.name}</div><button disabled={active==='demo'||busy} onClick={()=>{setSettings(!settings);setSecret('');setNotice('')}}>渠道设置</button></header>{settings&&active!=='demo'&&<section className="settings"><h2>连接你的模型</h2><p>配置仅保留在当前会话，真实模型调用尚未接入。</p><label>服务地址<input value={config.endpoint} onChange={e=>setConfigs({...configs,[active]:{...config,endpoint:e.target.value}})} placeholder="http://127.0.0.1:11434"/></label><label>模型名称<input value={config.model} onChange={e=>setConfigs({...configs,[active]:{...config,model:e.target.value}})}/></label><label>API 密钥<input type="password" autoComplete="off" disabled={!invoke||busy} value={secret} onChange={e=>setSecret(e.target.value)} placeholder={invoke?'仅保存至系统钥匙串':'浏览器预览不接受密钥'}/></label><button disabled={!invoke||!secret.trim()||busy} onClick={save}>保存密钥</button><p role="status">{notice}</p></section>}<div className="conversation" aria-live="polite">{snap.messages.length===0?<div className="welcome"><div className="eyebrow">A LITTLE SPACE FOR BIG IDEAS</div><h1>让想法，<br/>慢慢成形。</h1><p>写下一个问题，或还没整理好的念头。<br/>Tinker 陪你从第一步开始。</p><div className="tags"><span>独立渠道草稿</span><span>本地工作空间</span></div></div>:snap.messages.map((m,i)=><article className={i%2===0?'message user':'message'} key={i}><small>{i%2===0?'你':'Tinker · 演示'}</small><p>{m}</p></article>)}</div><footer><p className="mode">{active==='demo'?'演示模式 · 不连接模型，不产生调用费用':'尚未接入真实模型 · 发送失败会保留草稿'}</p><form onSubmit={send}><textarea aria-label="消息草稿" disabled={busy} value={snap.draft} onChange={e=>void edit(e.target.value)} placeholder="有什么想一起琢磨的？"/><div className="composefoot"><span>切换渠道，草稿仍在</span><button disabled={busy||!snap.draft.trim()} type="submit">{busy?'处理中…':'发送 ↗'}</button></div></form>{error&&<p role="alert" className="error">{error}</p>}<p className="caption">Tinker · 第一阶段 {invoke?'桌面开发版':'浏览器预览'}</p></footer></main></div>
}
createRoot(document.getElementById('root')!).render(<App/>);
