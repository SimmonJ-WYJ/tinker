/**
 * 文本选择功能集成示例
 *
 * 展示如何在 Agent 会话中集成划词选择功能
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { SelectableMessageResponse } from '@/components/ai-elements/message'
import { pendingQuoteAtom, sidebarQuoteAtom } from '@/atoms/text-selection-atoms'

// ========== 示例 1: 在 Agent 消息中使用 ==========

export function AgentMessageExample({ content, basePath }: { content: string; basePath?: string }) {
  return (
    <div className="flex flex-col gap-2">
      {/* AI 生成的消息 - 启用文本选择 */}
      <SelectableMessageResponse basePath={basePath}>
        {content}
      </SelectableMessageResponse>
    </div>
  )
}

// ========== 示例 2: 在输入框组件中处理引用 ==========

export function InputComponentExample({ editor }: { editor: any }) {
  const [pendingQuote, setPendingQuote] = useAtom(pendingQuoteAtom)

  React.useEffect(() => {
    if (!pendingQuote || !editor) return

    // 格式化引用文本（Markdown 引用格式）
    const quoteText = pendingQuote.text
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n')

    // 插入引用到编辑器
    // 在引用后添加两个换行，让用户可以继续输入
    editor.commands.insertContent(`${quoteText}\n\n`)

    // 聚焦编辑器
    editor.commands.focus('end')

    // 清除状态
    setPendingQuote(null)
  }, [pendingQuote, editor, setPendingQuote])

  return <div>{/* 你的编辑器组件 */}</div>
}

// ========== 示例 3: 在侧边栏中处理引用 ==========

export function SidebarExample() {
  const [sidebarQuote, setSidebarQuote] = useAtom(sidebarQuoteAtom)
  const [isOpen, setIsOpen] = React.useState(false)
  const [input, setInput] = React.useState('')

  React.useEffect(() => {
    if (!sidebarQuote) return

    // 打开侧边栏
    setIsOpen(true)

    // 格式化引用文本并设置到输入框
    const quoteText = sidebarQuote.text
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n')

    setInput(`关于以下内容：\n\n${quoteText}\n\n`)

    // 清除状态
    setSidebarQuote(null)
  }, [sidebarQuote, setSidebarQuote])

  if (!isOpen) return null

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-background border-l border-border">
      <div className="p-4">
        <h2 className="text-lg font-semibold mb-4">侧边栏提问</h2>
        <textarea
          className="w-full h-32 p-2 border border-border rounded"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入你的问题..."
        />
        <button
          className="mt-2 px-4 py-2 bg-primary text-primary-foreground rounded"
          onClick={() => {
            // 处理提交
            console.log('提交问题:', input)
          }}
        >
          提问
        </button>
      </div>
    </div>
  )
}

// ========== 示例 4: 完整的对话组件集成 ==========

export function ConversationExample() {
  const messages = [
    { id: '1', role: 'user', content: '请介绍一下量子计算' },
    {
      id: '2',
      role: 'assistant',
      content: '量子计算是一种基于量子力学原理的计算方式...\n\n它具有以下特点：\n1. 叠加态\n2. 量子纠缠\n3. 量子隧穿'
    },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.role === 'user' ? (
              <div className="text-right">
                <div className="inline-block bg-primary/10 rounded-lg px-4 py-2">
                  {msg.content}
                </div>
              </div>
            ) : (
              // AI 消息使用 SelectableMessageResponse 启用文本选择
              <SelectableMessageResponse>
                {msg.content}
              </SelectableMessageResponse>
            )}
          </div>
        ))}
      </div>

      {/* 输入框 */}
      <div className="border-t border-border p-4">
        <InputComponentExample editor={null} />
      </div>

      {/* 侧边栏 */}
      <SidebarExample />
    </div>
  )
}
