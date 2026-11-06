import React from 'react'
import {createRoot} from 'react-dom/client'
import {ThinkingOrb} from 'thinking-orbs'
createRoot(document.getElementById('root')!).render(<main style={{fontFamily:'system-ui',padding:60,color:'#555'}}><h2 style={{fontSize:18,fontWeight:500}}>Coding 生成状态 · 球形 Orb</h2><div style={{display:'flex',alignItems:'center',gap:12,marginTop:32}}><ThinkingOrb state="searching" size={32} speed={0.6} theme="light"/><span>正在生成…</span></div></main>)
