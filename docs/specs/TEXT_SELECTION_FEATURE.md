<a id="文本选择功能使用指南"></a>

# Text Selection Feature Guide

<a id="概述"></a>

## Overview

Text selection has been added to AI-generated content, allowing users to select text and perform these actions:
- **Ask in sidebar**: Ask about the selected content in the sidebar
- **Add to chat**: Add the selected content as a quote in the current chat input

<a id="功能组件"></a>

## Feature Components

<a id="1-核心组件"></a>

### 1. Core Components

#### `TextSelectionToolbar`
A floating toolbar component displayed above selected text.

#### `SelectableMessageResponse`
A component wrapping `MessageResponse` to add text selection.

#### `useTextSelection` Hook
Handles text selection logic and toolbar position calculations.

<a id="2-状态管理"></a>

### 2. State Management

#### `text-selection-atoms.ts`
```typescript
// 待添加到输入框的引用文本
export const pendingQuoteAtom = atom<SelectedTextQuote | null>(null)

// 侧边栏提问的引用文本
export const sidebarQuoteAtom = atom<SelectedTextQuote | null>(null)
```

<a id="使用方法"></a>

## Usage

<a id="在-ai-消息中启用文本选择"></a>

### Enable Text Selection in AI Messages

Replace the original `MessageResponse` with `SelectableMessageResponse`:

```tsx
import { SelectableMessageResponse } from '@/components/ai-elements/message'

// 原来的用法
<MessageResponse basePath={basePath}>
  {content}
</MessageResponse>

// 新的用法 - 启用文本选择
<SelectableMessageResponse basePath={basePath}>
  {content}
</SelectableMessageResponse>
```

<a id="在输入框组件中处理引用"></a>

### Handle Quotes in the Input Component

Listen to `pendingQuoteAtom` and insert quotes into the input:

```tsx
import { useAtom } from 'jotai'
import { pendingQuoteAtom } from '@/atoms/text-selection-atoms'

function YourInputComponent() {
  const [pendingQuote, setPendingQuote] = useAtom(pendingQuoteAtom)

  React.useEffect(() => {
    if (pendingQuote) {
      // 将引用内容插入到编辑器
      const quoteText = `> ${pendingQuote.text}\n\n`
      // 使用你的编辑器 API 插入文本
      editor?.commands.insertContent(quoteText)
      
      // 清除状态
      setPendingQuote(null)
    }
  }, [pendingQuote, editor, setPendingQuote])

  return <YourEditor />
}
```

<a id="在侧边栏中处理引用"></a>

### Handle Quotes in the Sidebar

Listen to `sidebarQuoteAtom` and open the sidebar:

```tsx
import { useAtom } from 'jotai'
import { sidebarQuoteAtom } from '@/atoms/text-selection-atoms'

function YourSidebarComponent() {
  const [sidebarQuote, setSidebarQuote] = useAtom(sidebarQuoteAtom)

  React.useEffect(() => {
    if (sidebarQuote) {
      // 打开侧边栏
      setIsSidebarOpen(true)
      
      // 设置引用内容到侧边栏输入框
      setSidebarInput(`关于以下内容：\n> ${sidebarQuote.text}\n\n`)
      
      // 清除状态
      setSidebarQuote(null)
    }
  }, [sidebarQuote, setSidebarQuote])

  return <YourSidebar />
}
```

<a id="样式定制"></a>

## Style Customization

<a id="工具栏样式"></a>

### Toolbar Styles

The toolbar uses Tailwind CSS classes and can be customized by modifying the `TextSelectionToolbar` component:

```tsx
// 修改背景色
className="bg-background/95 backdrop-blur-sm"

// 修改边框
className="border border-border/60"

// 修改阴影
className="shadow-lg"
```

<a id="工具栏位置"></a>

### Toolbar Position

By default, the toolbar is centered above selected text. To adjust it:

```tsx
style={{
  top: `${position.top}px`,
  left: `${position.left}px`,
  transform: 'translate(-50%, -100%) translateY(-8px)', // 调整偏移量
}}
```

<a id="注意事项"></a>

## Notes

1. **Enable only for AI messages**: Text selection applies only to AI-generated content (`MessageResponse`); user messages do not need it.

2. **Performance optimization**: The `useTextSelection` Hook uses event delegation and throttling for good performance with large amounts of text.

3. **Automatic toolbar dismissal**:
   - Click outside the toolbar
   - Click a toolbar button
   - Start a new text selection

4. **Responsive behavior**: Toolbar positioning is dynamically calculated from the selected text position to accommodate different screen sizes.

<a id="文件结构"></a>

## File Structure

```
apps/electron/src/renderer/
├── atoms/
│   └── text-selection-atoms.ts          # State management
├── components/
│   └── ai-elements/
│       ├── message.tsx                  # Export SelectableMessageResponse
│       ├── selectable-message-response.tsx  # Selectable message response
│       └── text-selection-toolbar.tsx   # Text selection toolbar
└── hooks/
    └── useTextSelection.ts              # Text selection Hook
```

<a id="待实现功能"></a>

## Features Still to Implement

Complete these features during actual integration:

1. ✅ Text selection toolbar UI
2. ✅ Text selection logic and position calculations
3. ✅ State management atoms
4. ⏳ Input integration - modify `rich-text-input.tsx` to listen to `pendingQuoteAtom`
5. ⏳ Sidebar integration - create or modify sidebar components to listen to `sidebarQuoteAtom`
6. ⏳ Use `SelectableMessageResponse` in the actual Agent session component

<a id="示例截图"></a>

## Example Screenshots

```
┌─────────────────────────────────────┐
│  💬 1 selection                     │
│  ├─ Ask in sidebar  ├─ Add to chat │
└─────────────────────────────────────┘
        ↓ Displayed above selected text
```
