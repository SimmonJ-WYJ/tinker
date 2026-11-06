// 临时本地验收入口，不进入正式构建；无密钥、无网络模型。
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ChannelSettings } from './components/settings/ChannelSettings'
import { MessageMoreActions } from './components/agent/MessageMoreActions'
import { RichTextInput } from './components/ai-elements/rich-text-input'
import { TooltipProvider } from './components/ui/tooltip'
import { Button } from './components/ui/button'
import { setAppLanguage } from './lib/i18n'
import { Plus, ArrowUp } from 'lucide-react'
import './styles/globals.css'
import './components/welcome/workspace-home.css'
const channels = [{id:'qa',name:'Design QA Relay',provider:'custom-image',baseUrl:'https://example.invalid',apiKey:'',models:[{id:'qa-image',name:'QA image',enabled:true}],enabled:true,createdAt:0,updatedAt:0}]
window.electronAPI = {listChannels:async()=>channels,decryptApiKey:async()=>'',getSettings:async()=>({}),listSkills:async()=>[],listMcpServers:async()=>[]} as unknown as Window['electronAPI']
function Preview() {
 const [text,setText]=React.useState(''); const [lang,setLang]=React.useState('en'); const [theme,setTheme]=React.useState(false)
 return <TooltipProvider><main className="workspace-shell min-h-screen bg-background p-6 text-foreground"><header className="mb-6 flex gap-3"><strong>ASCI · Local design fixtures</strong><Button onClick={()=>{const next=lang==='en'?'zh':'en';setLang(next);void setAppLanguage(next)}}>中文 / English</Button><Button onClick={()=>{document.documentElement.classList.toggle('dark');setTheme(!theme)}}>{theme?'Light':'Dark'}</Button></header><section className="mx-auto max-w-3xl"><ChannelSettings /></section><section className="conversation-column mx-auto mt-8 w-full max-w-[716px]"><p className="mb-3">A sample response. Copy, evidence and feedback remain accessible; less frequent actions are in the menu.</p><div className="mb-6 flex items-center gap-2 text-muted-foreground"><span className="text-xs">18s · 12:30</span><MessageMoreActions onFork={()=>alert('Fork reached')} onRewind={()=>alert('Rewind reached')}/></div><div className="agent-composer-surface rounded-[17px] border border-border bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring/20"><RichTextInput value={text} onChange={setText} onSubmit={()=>{}} placeholder="Describe the next change…"/><div className="agent-composer-toolbar flex min-h-[44px] flex-wrap items-center justify-between gap-2 px-2 py-1"><Button variant="ghost" size="icon-sm" aria-label="Attach file"><Plus/></Button><div className="ml-auto flex items-center gap-2"><Button variant="ghost">QA model · Balanced</Button><Button size="icon" className="size-8 rounded-full" disabled={!text} aria-label="Send"><ArrowUp/></Button></div></div></div></section></main></TooltipProvider>
}
createRoot(document.getElementById('root')!).render(<Preview />)
