import * as React from 'react'
import { Check } from 'lucide-react'
import chevron from '@/assets/conversation/chevron-down.svg'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { ModelSelectorReasoning } from '@/components/common/ModelSelector'

/** 沿用模型菜单的真实推理深度状态；两种显示入口不会产生第二套配置。 */
export function ConversationReasoningSelector({ reasoning }: { reasoning: ModelSelectorReasoning }): React.ReactElement {
  const current = reasoning.options.find(option => option.value === reasoning.current)
  return <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" aria-label={reasoning.title} className="conversation-reasoning-selector">
    <span>{current?.label ?? reasoning.current}</span><img src={chevron} alt="" />
  </Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="max-w-[280px]">
    {reasoning.options.map(option => <DropdownMenuItem key={option.value} onSelect={() => reasoning.onSelect(option.value)}>
      <span className="min-w-0 flex-1"><span className="block">{option.label}</span>{option.desc && <span className="block text-xs text-muted-foreground">{option.desc}</span>}</span>
      {option.value === reasoning.current && <Check aria-hidden="true" className="size-4" />}
    </DropdownMenuItem>)}
  </DropdownMenuContent></DropdownMenu>
}
