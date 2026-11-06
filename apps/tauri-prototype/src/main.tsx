import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'
interface HostHealth { protocolVersion: number; host: string; architecture: string; modelExecution: boolean; shellExecution: boolean }
declare global { interface Window { __TAURI__?: { core: { invoke: <T>(command: string) => Promise<T> } } } }
function App() {
 const [health, setHealth] = useState<HostHealth>()
 const [error, setError] = useState('')
 useEffect(() => {
  const api = window.__TAURI__?.core
  if (!api) { setError('请从原生应用打开此原型。'); return }
  api.invoke<HostHealth>('host_health').then(setHealth).catch(() => setError('原生通信失败'))
 }, [])
 return <main><span className="badge">ASCI · 技术验证原型</span><h1>Rust 原生宿主</h1><p>React 界面通过 IPC 与独立的 Rust 宿主通信。</p><section aria-live="polite">{health ? <><h2>原生连接正常</h2><dl><dt>宿主</dt><dd>{health.host}</dd><dt>处理器</dt><dd>{health.architecture}</dd><dt>协议版本</dt><dd>{health.protocolVersion}</dd><dt>模型调用</dt><dd>{health.modelExecution ? '已接入' : '尚未接入'}</dd><dt>命令执行</dt><dd>{health.shellExecution ? '已启用' : '未开放'}</dd></dl></> : <p>{error || '正在连接原生宿主…'}</p>}</section><p className="note">仅验证桌面外壳与通信。没有接入现有聊天、Google 登录、模型或项目数据，不能与完整 ASCI 的功能和体积直接等同。</p></main>
}
createRoot(document.getElementById('root')!).render(<App />)
