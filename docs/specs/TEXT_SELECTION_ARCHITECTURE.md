<a id="划词功能架构图"></a>

# Text Selection Feature Architecture

<a id="数据流向图"></a>

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         User interaction layer                    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
        ┌───────────────────────────────────────┐
        │   User selects text in an AI message   │
        └───────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SelectableMessageResponse                    │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  MessageResponse (original, renders Markdown)          │    │
│  └────────────────────────────────────────────────────────┘    │
│                                │                                 │
│                                ▼                                 │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  useTextSelection Hook                                  │    │
│  │  - Listen for mouseup/mousedown                         │    │
│  │  - Read selected text                                   │    │
│  │  - Calculate toolbar position                           │    │
│  └────────────────────────────────────────────────────────┘    │
│                                │                                 │
│                                ▼                                 │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  TextSelectionToolbar                                   │    │
│  │  ┌──────────────┐  ┌──────────────┐                   │    │
│  │  │ Ask in       │  │ Add to       │                   │    │
│  │  │ sidebar      │  │ chat         │                   │    │
│  │  └──────────────┘  └──────────────┘                   │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                    │                      │
                    │                      │
        ┌───────────┘                      └───────────┐
        │                                              │
        ▼                                              ▼
┌───────────────────┐                    ┌───────────────────┐
│ sidebarQuoteAtom  │                    │ pendingQuoteAtom  │
│ (Jotai Atom)      │                    │ (Jotai Atom)      │
└───────────────────┘                    └───────────────────┘
        │                                              │
        │                                              │
        ▼                                              ▼
┌───────────────────┐                    ┌───────────────────┐
│  Sidebar component │                    │  Input component │
│  - Observe atom    │                    │  - Observe atom   │
│  - Open sidebar    │                    │  - Insert quote   │
│  - Display quote   │                    │  - Focus editor   │
└───────────────────┘                    └───────────────────┘
```

<a id="组件层次结构"></a>

## Component Hierarchy

```
App
└── ConversationView
    ├── MessageList
    │   └── Message (role="assistant")
    │       └── SelectableMessageResponse ← enable selection here
    │           ├── MessageResponse (original)
    │           └── TextSelectionToolbar (conditional)
    │
    ├── InputBox
    │   └── RichTextInput ← observe pendingQuoteAtom
    │
    └── Sidebar ← observe sidebarQuoteAtom
```

<a id="状态管理流程"></a>

## State Management Flow

```
1. User action
   └─> Select text
       └─> useTextSelection captures
           └─> Show TextSelectionToolbar

2. Click "Add to chat"
   └─> setPendingQuote({ text, timestamp })
       └─> pendingQuoteAtom updates
           └─> RichTextInput useEffect triggers
               └─> editor.commands.insertContent(quote)
                   └─> setPendingQuote(null) clears

3. Click "Ask in sidebar"
   └─> setSidebarQuote({ text, timestamp })
       └─> sidebarQuoteAtom updates
           └─> Sidebar useEffect triggers
               └─> setIsOpen(true) + setInput(quote)
                   └─> setSidebarQuote(null) clears
```

<a id="文件关系图"></a>

## File Relationships

```
atoms/
└── text-selection-atoms.ts ─────┐
                                 │
                                 │ Imported
                                 │
components/ai-elements/          │
├── message.tsx ─────────────────┼─ exports SelectableMessageResponse
├── selectable-message-response.tsx ← uses atoms
├── text-selection-toolbar.tsx   │
└── text-selection-examples.tsx  │
                                 │
hooks/                           │
└── useTextSelection.ts          │
                                 │
                        ┌────────┴────────┐
                        │                 │
                        ▼                 ▼
          Input (pending integration)  Sidebar (pending integration)
          - Observe pendingQuoteAtom   - Observe sidebarQuoteAtom
          - Insert quote into editor   - Open/display quote
```

<a id="事件时序图"></a>

## Event Sequence Diagram

```
Timeline ────────────────────────────────────────────────────>

User      [Select text]          [Click button]
           │                    │
           ▼                    │
Hook    Captures selection      │
           │                    │
           ├─ Calculate position │
           │                    │
           ▼                    │
Toolbar   Displays             │
                               │
                               ▼
                          Set atom
                               │
                               ├─ pendingQuote or
                               │  sidebarQuote
                               │
                               ▼
Target component             Observes change
                               │
                               ├─ Perform action
                               │  (insert/open)
                               │
                               ▼
                          Clear atom
```

<a id="关键接口定义"></a>

## Key Interface Definitions

```typescript
// 选中的文本引用
interface SelectedTextQuote {
  text: string       // 选中的文本内容
  timestamp: number  // 引用时间戳
}

// 文本选择状态
interface TextSelectionState {
  selectedText: string              // 当前选中的文本
  position: { top: number; left: number }  // 工具栏位置
  visible: boolean                  // 是否显示工具栏
}

// Hook 返回值
interface UseTextSelectionReturn extends TextSelectionState {
  clearSelection: () => void        // 清除选择
}
```

<a id="样式层次"></a>

## Style Hierarchy

```
TextSelectionToolbar
├── Container layer
│   ├── fixed positioning (z-50)
│   ├── backdrop-blur
│   └── border + shadow
│
├── Content layer
│   ├── Selection indicator (1 selection)
│   ├── Separator
│   └── Action buttons
│       ├── Ask in sidebar button
│       └── Add to chat button
│
└── Animation layer
    ├── fade-in (opacity)
    ├── zoom-in (scale)
    └── transform (position)
```

<a id="性能优化点"></a>

## Performance Optimizations

1. **Event listeners**: listen only within the SelectableMessageResponse container
2. **Position calculation**: defer calculation with setTimeout to avoid frequent triggers
3. **State updates**: use Jotai atoms to avoid unnecessary rerenders
4. **Component memoization**: use React.memo for key components
5. **Outside-click detection**: use refs instead of global listeners

<a id="可扩展性"></a>

## Extensibility

Possible future extensions:

1. **More actions**:
   - Copy text
   - Translate selected content
   - Search related content
   - Highlight annotations

2. **Keyboard shortcuts**:
   - Cmd/Ctrl + K: quick question
   - Cmd/Ctrl + Shift + C: copy citation format

3. **Selection history**:
   - Record recent selections
   - Quickly access past quotations

4. **Smart suggestions**:
   - Suggest questions based on the selection
   - Recommend related knowledge
