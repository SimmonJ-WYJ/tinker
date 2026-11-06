import React from 'react'
import {createRoot} from 'react-dom/client'
import {ChannelForm} from './components/settings/ChannelForm'
import {setAppLanguage} from './lib/i18n'
import './styles/globals.css'
window.electronAPI={decryptApiKey:async()=>'',listChannels:async()=>[],updateChannel:async()=>({})} as unknown as Window['electronAPI']
await setAppLanguage('zh')
createRoot(document.getElementById('root')!).render(<main className="min-h-screen bg-background text-foreground p-8"><p className="mb-6 text-sm text-muted-foreground">生图渠道界面预览 · 示例配置，无真实密钥，不发送上游请求</p><ChannelForm channel={{id:'preview',name:'图片生成',provider:'custom-image',baseUrl:'https://siliconfission.com',apiKey:'',models:[{id:'gpt-image-2.5-flare',name:'gpt-image-2.5-flare',enabled:true},{id:'gpt-image-2.5-sunburst',name:'gpt-image-2.5-sunburst',enabled:true},{id:'gpt-image-2-o',name:'gpt-image-2-o',enabled:true}],enabled:true,createdAt:0,updatedAt:0}} onSaved={()=>{}} onCancel={()=>{}}/></main>)
