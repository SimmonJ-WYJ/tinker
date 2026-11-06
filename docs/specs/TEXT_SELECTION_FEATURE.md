# 文本选择功能使用指南

## 概述

为 AI 生成的内容添加了划词选择功能，用户可以选中文本后执行以下操作：
- **Ask in sidebar**: 在侧边栏中对选中内容提问
- **Add to chat**: 将选中内容作为引用添加到当前对话框

## 功能组件

### 1. 核心组件

#### `TextSelectionToolbar`
浮动工具栏组件，显示在选中文本上方。

#### `SelectableMessageResponse`
包装了 `MessageResponse` 的组件，添加了文本选择功能。

#### `useTextSelection` Hook
处理文本选择逻辑和工具栏位置计算。

### 2. 状态管理

#### `text-selection-atoms.ts`
```typescript
// 待添加到输入框的引用文本
export const pendingQuoteAtom = atom<SelectedTextQuote | null>(null)

// 侧边栏提问的引用文本
export const sidebarQuoteAtom = atom<SelectedTextQuote | null>(null)
```

## 使用方法

### 在 AI 消息中启用文本选择

将原来的 `MessageResponse` 替换为 `SelectableMessageResponse`：

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

### 在输入框组件中处理引用

监听 `pendingQuoteAtom` 并将引用插入到输入框：

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

### 在侧边栏中处理引用

监听 `sidebarQuoteAtom` 并打开侧边栏：

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

## 样式定制

### 工具栏样式

工具栏使用 Tailwind CSS 类名，可以通过修改 `TextSelectionToolbar` 组件来定制：

```tsx
// 修改背景色
className="bg-background/95 backdrop-blur-sm"

// 修改边框
className="border border-border/60"

// 修改阴影
className="shadow-lg"
```

### 工具栏位置

工具栏默认显示在选中文本上方居中位置。如需调整：

```tsx
style={{
  top: `${position.top}px`,
  left: `${position.left}px`,
  transform: 'translate(-50%, -100%) translateY(-8px)', // 调整偏移量
}}
```

## 注意事项

1. **仅对 AI 消息启用**: 文本选择功能仅应用于 AI 生成的内容（`MessageResponse`），用户消息不需要此功能。

2. **性能优化**: `useTextSelection` Hook 使用事件委托和节流，确保在大量文本时性能良好。

3. **工具栏自动关闭**: 
   - 点击工具栏外部区域
   - 点击工具栏按钮
   - 开始新的文本选择

4. **响应式**: 工具栏位置会根据选中文本的位置动态计算，适配不同屏幕尺寸。

## 文件结构

```
apps/electron/src/renderer/
├── atoms/
│   └── text-selection-atoms.ts          # 状态管理
├── components/
│   └── ai-elements/
│       ├── message.tsx                  # 导出 SelectableMessageResponse
│       ├── selectable-message-response.tsx  # 可选择的消息响应
│       └── text-selection-toolbar.tsx   # 文本选择工具栏
└── hooks/
    └── useTextSelection.ts              # 文本选择 Hook
```

## 待实现功能

以下功能需要在实际集成时完成：

1. ✅ 文本选择工具栏 UI
2. ✅ 文本选择逻辑和位置计算
3. ✅ 状态管理 atoms
4. ⏳ 输入框集成 - 需要修改 `rich-text-input.tsx` 监听 `pendingQuoteAtom`
5. ⏳ 侧边栏集成 - 需要创建或修改侧边栏组件监听 `sidebarQuoteAtom`
6. ⏳ 在实际的 Agent 会话组件中使用 `SelectableMessageResponse`

## 示例截图

```
┌─────────────────────────────────────┐
│  💬 1 selection                     │
│  ├─ Ask in sidebar  ├─ Add to chat │
└─────────────────────────────────────┘
        ↓ 显示在选中文本上方
```
