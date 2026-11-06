/**
 * PastedBlock — 长文本粘贴折叠卡片的 tiptap atom 块节点。
 * - 完整原文存 node.attrs.text，序列化为 div[data-pasted-text]（encodeURIComponent）
 * - React NodeView 渲染卡片：预览 + PASTED 标签 + 字数 + ×删除 + 点击展开全文
 * - htmlToMarkdown 读取 data-pasted-text 还原完整原文（见 rich-text-input.tsx）
 */

import * as React from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { X } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { useT } from '@/hooks/useT'

export const PASTED_BLOCK_NAME = 'pastedBlock'

/** 解码 data-pasted-text 属性为完整原文（解码失败回退原值）。供节点 parseHTML 与 htmlToMarkdown 共用。 */
export function decodePastedText(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pastedBlock: {
      /** 在当前选区插入一个 PASTED 折叠卡片，承载完整原文 */
      insertPastedBlock: (text: string) => ReturnType
    }
  }
}

function PastedBlockView({ node, deleteNode }: NodeViewProps): React.ReactElement {
  const { t } = useT('conversation')
  const text: string = (node.attrs.text as string) ?? ''
  const preview = text.slice(0, 140)

  return (
    <NodeViewWrapper className="my-1" contentEditable={false} data-drag-handle>
      <Popover>
        <div className="group relative inline-block max-w-[260px] rounded-xl border border-border bg-muted/40 p-3 text-left shadow-sm">
          <PopoverTrigger asChild>
            <button type="button" className="block w-full cursor-pointer text-left">
              <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm leading-snug text-foreground/70">
                {preview}
              </p>
              <span className="mt-2 inline-flex items-center rounded-md border border-border bg-background px-2 py-0.5 text-badge font-normal tracking-wide text-foreground/80">
                {t('pastedBlock.label')}
              </span>
              <span className="ml-2 text-sm tabular-nums text-muted-foreground">
                {t('pastedBlock.chars', { count: text.length })}
              </span>
            </button>
          </PopoverTrigger>
          <button
            type="button"
            aria-label={t('pastedBlock.remove')}
            onClick={() => deleteNode()}
            className="absolute -right-2 -top-2 hidden size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-foreground group-hover:flex"
          >
            <X className="size-3" />
          </button>
        </div>
        <PopoverContent align="start" className="max-h-[50vh] w-80 overflow-auto p-3">
          <div className="mb-1 text-xs font-medium">{t('pastedBlock.expandTitle')}</div>
          <pre className="whitespace-pre-wrap break-words text-sm leading-snug text-foreground/80">
            {text}
          </pre>
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  )
}

export const PastedBlock = Node.create({
  name: PASTED_BLOCK_NAME,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      text: {
        default: '',
        parseHTML: (el: HTMLElement): string =>
          decodePastedText(el.getAttribute('data-pasted-text') ?? ''),
        renderHTML: (attrs: { text?: string }): Record<string, string> => ({
          'data-pasted-text': encodeURIComponent(attrs.text ?? ''),
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-pasted-text]' }]
  },

  renderHTML({ HTMLAttributes }) {
    // 完整原文仅由 data-pasted-text 承载；无可见子节点（卡片由 NodeView 渲染）
    return ['div', mergeAttributes(HTMLAttributes, { class: 'pasted-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PastedBlockView)
  },

  addCommands() {
    return {
      insertPastedBlock:
        (text: string) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { text } }),
    }
  },
})
