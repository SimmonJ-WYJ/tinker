<a id="划词功能实现总结"></a>

# Text Selection Implementation Summary

<a id="-已完成的工作"></a>

## ✅ Completed Work

<a id="1-核心组件"></a>

### 1. Core Components

<a id="textselectiontoolbar-文本选择工具栏"></a>

#### `TextSelectionToolbar` (Text Selection Toolbar)
- 📁 Location: `apps/electron/src/renderer/components/ai-elements/text-selection-toolbar.tsx`
- ✨ Features:
  - Floating toolbar above selected text
  - Selection count indicator "1 selection"
  - Two action buttons:
    - "Ask in sidebar" - Ask in the sidebar
    - "Add to chat" - Add to the current chat input
  - Automatically closes on outside clicks
  - Fade-in animation

<a id="selectablemessageresponse-可选择的消息响应"></a>

#### `SelectableMessageResponse` (Selectable Message Response)
- 📁 Location: `apps/electron/src/renderer/components/ai-elements/selectable-message-response.tsx`
- ✨ Features:
  - Wraps the `MessageResponse` component
  - Integrates text selection
  - Handles "Ask in sidebar" and "Add to chat" events
  - Manages toolbar visibility

<a id="2-自定义-hooks"></a>

### 2. Custom Hooks

#### `useTextSelection`
- 📁 Location: `apps/electron/src/renderer/hooks/useTextSelection.ts`
- ✨ Features:
  - Listens for text selection events
  - Positions the toolbar (above the center of the selection)
  - Validates that selection is inside the container
  - Provides a method to clear selection

<a id="3-状态管理"></a>

### 3. State Management

#### `text-selection-atoms.ts`
- 📁 Location: `apps/electron/src/renderer/atoms/text-selection-atoms.ts`
- ✨ Includes:
  - `pendingQuoteAtom` - Quote text pending insertion into the input
  - `sidebarQuoteAtom` - Quote text for a sidebar question
  - `SelectedTextQuote` interface definition

<a id="4-文档和示例"></a>

### 4. Documentation and Examples

- ✅ **Usage guide**: `TEXT_SELECTION_FEATURE.md`
- ✅ **Integration examples**: `text-selection-examples.tsx`
  - Agent message usage example
  - Input quote handling example
  - Sidebar quote handling example
  - Complete conversation component integration example

<a id="5-组件修改"></a>

### 5. Component Changes

#### `message.tsx`
- ✅ Changed `MessageResponseProps` from `interface` to `export interface`
- ✅ Exported the `SelectableMessageResponse` component

<a id="-下一步需要完成的工作"></a>

## 📋 Remaining Work

<a id="1-输入框集成高优先级"></a>

### 1. Input Integration (High Priority)

Modify `rich-text-input.tsx` to subscribe to `pendingQuoteAtom`:

```tsx
// 在 rich-text-input.tsx 中添加
import { useAtom } from 'jotai'
import { pendingQuoteAtom } from '@/atoms/text-selection-atoms'

// 在组件内部
const [pendingQuote, setPendingQuote] = useAtom(pendingQuoteAtom)

React.useEffect(() => {
  if (pendingQuote && editor) {
    // 格式化引用
    const quoteText = pendingQuote.text
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n')
    
    // 插入到编辑器
    editor.commands.insertContent(`${quoteText}\n\n`)
    editor.commands.focus('end')
    
    // 清除状态
    setPendingQuote(null)
  }
}, [pendingQuote, editor, setPendingQuote])
```

<a id="2-侧边栏集成高优先级"></a>

### 2. Sidebar Integration (High Priority)

Find or create the sidebar component and subscribe to `sidebarQuoteAtom`. The retained code's Chinese input prefix means “Regarding the following content.”

```tsx
// 在侧边栏组件中添加
import { useAtom } from 'jotai'
import { sidebarQuoteAtom } from '@/atoms/text-selection-atoms'

const [sidebarQuote, setSidebarQuote] = useAtom(sidebarQuoteAtom)

React.useEffect(() => {
  if (sidebarQuote) {
    // 打开侧边栏
    setIsSidebarOpen(true)
    
    // 设置引用内容
    const quoteText = sidebarQuote.text
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n')
    
    setSidebarInput(`关于以下内容：\n\n${quoteText}\n\n`)
    
    // 清除状态
    setSidebarQuote(null)
  }
}, [sidebarQuote, setSidebarQuote])
```

<a id="3-在实际会话中使用高优先级"></a>

### 3. Use in Actual Conversations (High Priority)

Find the component displaying Agent messages and replace `MessageResponse` with `SelectableMessageResponse`:

```tsx
// 找到类似这样的代码
<MessageResponse basePath={basePath}>
  {content}
</MessageResponse>

// 替换为
<SelectableMessageResponse basePath={basePath}>
  {content}
</SelectableMessageResponse>
```

Possible file locations:
- `apps/electron/src/renderer/components/agent/*.tsx`
- `apps/electron/src/renderer/components/ai-elements/*.tsx`

<a id="4-i18n-国际化中优先级"></a>

### 4. i18n Internationalization (Medium Priority)

Add text-selection translations:

**en.json**:
```json
{
  "textSelection": {
    "selection": "selection",
    "askInSidebar": "Ask in sidebar",
    "addToChat": "Add to chat"
  }
}
```

**zh.json** (the retained values mean “selections,” “Ask in sidebar,” and “Add to chat”):
```json
{
  "textSelection": {
    "selection": "个选择",
    "askInSidebar": "在侧边栏提问",
    "addToChat": "添加到对话"
  }
}
```

Then modify `text-selection-toolbar.tsx` to use the `useT` hook.

<a id="5-测试和优化中优先级"></a>

### 5. Testing and Optimization (Medium Priority)

- ✅ Test text selection with different content lengths.
- ✅ Test toolbar positioning at different scroll positions.
- ✅ Test performance during repeated rapid selections.
- ✅ Test mobile/small-screen behavior.
- ✅ Add keyboard shortcuts (such as Cmd+K to trigger quickly).

<a id="6-样式微调低优先级"></a>

### 6. Styling Refinements (Low Priority)

- Adjust toolbar radii, shadows, spacing, and other details.
- Add more animations (such as button hover effects).
- Adapt dark/light themes.

<a id="-需要查找的文件"></a>

## 🔍 Files to Locate

Find these files to complete integration:

1. **Input component**:
   - ✅ Found: `apps/electron/src/renderer/components/ai-elements/rich-text-input.tsx`

2. **Sidebar component**:
   - Locate the sidebar implementation.
   - Possibly under `apps/electron/src/renderer/components/app-shell/`.

3. **Agent conversation component**:
   - Locate the component displaying AI messages.
   - Possibly under `apps/electron/src/renderer/components/agent/`.

<a id="-快速启动指南"></a>

## 🎯 Quick Start Guide

The simplest steps to enable this feature:

1. **Find where AI messages are displayed**, and change:
   ```tsx
   <MessageResponse>{content}</MessageResponse>
   ```
   to:
   ```tsx
   <SelectableMessageResponse>{content}</SelectableMessageResponse>
   ```

2. **Add a subscription in the input component**, referring to the snippets above.

3. **Test**: Select AI-generated text; the toolbar should appear.

<a id="-技术栈"></a>

## 📊 Technology Stack

- **UI framework**: React 18 + TypeScript
- **State management**: Jotai
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Type safety**: Complete TypeScript type definitions

<a id="-已知限制"></a>

## 🐛 Known Limitations

1. Currently supports mouse selection only, not touch selection (mobile).
2. Toolbar positioning may require adjustment under extreme scrolling.
3. Keyboard shortcuts are not yet implemented.

<a id="-更新日志"></a>

## 📝 Changelog

- 2026-09-03: Initial implementation, core features and documentation complete.
