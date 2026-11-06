# 划词功能架构图

## 数据流向图

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户交互层                                 │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
        ┌───────────────────────────────────────┐
        │   用户在 AI 消息中选中文本              │
        └───────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SelectableMessageResponse                    │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  MessageResponse (原组件，渲染 Markdown 内容)           │    │
│  └────────────────────────────────────────────────────────┘    │
│                                │                                 │
│                                ▼                                 │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  useTextSelection Hook                                  │    │
│  │  - 监听 mouseup/mousedown 事件                          │    │
│  │  - 获取选中文本                                          │    │
│  │  - 计算工具栏位置                                        │    │
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
│  侧边栏组件         │                    │  输入框组件        │
│  - 监听 atom       │                    │  - 监听 atom      │
│  - 打开侧边栏       │                    │  - 插入引用       │
│  - 显示引用内容     │                    │  - 聚焦编辑器      │
└───────────────────┘                    └───────────────────┘
```

## 组件层次结构

```
App
└── ConversationView
    ├── MessageList
    │   └── Message (role="assistant")
    │       └── SelectableMessageResponse ← 在这里启用文本选择
    │           ├── MessageResponse (原组件)
    │           └── TextSelectionToolbar (条件渲染)
    │
    ├── InputBox
    │   └── RichTextInput ← 监听 pendingQuoteAtom
    │
    └── Sidebar ← 监听 sidebarQuoteAtom
```

## 状态管理流程

```
1. 用户操作
   └─> 选中文本
       └─> useTextSelection 捕获
           └─> 显示 TextSelectionToolbar

2. 点击 "Add to chat"
   └─> setPendingQuote({ text, timestamp })
       └─> pendingQuoteAtom 更新
           └─> RichTextInput 的 useEffect 触发
               └─> editor.commands.insertContent(引用)
                   └─> setPendingQuote(null) 清除

3. 点击 "Ask in sidebar"  
   └─> setSidebarQuote({ text, timestamp })
       └─> sidebarQuoteAtom 更新
           └─> Sidebar 的 useEffect 触发
               └─> setIsOpen(true) + setInput(引用)
                   └─> setSidebarQuote(null) 清除
```

## 文件关系图

```
atoms/
└── text-selection-atoms.ts ─────┐
                                 │
                                 │ 被导入
                                 │
components/ai-elements/          │
├── message.tsx ─────────────────┼─ 导出 SelectableMessageResponse
├── selectable-message-response.tsx ← 使用 atoms
├── text-selection-toolbar.tsx   │
└── text-selection-examples.tsx  │
                                 │
hooks/                           │
└── useTextSelection.ts          │
                                 │
                        ┌────────┴────────┐
                        │                 │
                        ▼                 ▼
          输入框组件 (待集成)    侧边栏组件 (待集成)
          - 监听 pendingQuoteAtom  - 监听 sidebarQuoteAtom
          - 插入引用到编辑器        - 打开并显示引用
```

## 事件时序图

```
时间轴 ─────────────────────────────────────────────────────>

用户      [选中文本]          [点击按钮]
           │                    │
           ▼                    │
Hook    捕获选择                │
           │                    │
           ├─ 计算位置            │
           │                    │
           ▼                    │
工具栏   显示                   │
                               │
                               ▼
                          设置 atom
                               │
                               ├─ pendingQuote 或
                               │  sidebarQuote
                               │
                               ▼
目标组件                    监听到变化
                               │
                               ├─ 执行操作
                               │  (插入/打开)
                               │
                               ▼
                          清除 atom
```

## 关键接口定义

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

## 样式层次

```
TextSelectionToolbar
├── 容器层
│   ├── fixed positioning (z-50)
│   ├── backdrop-blur
│   └── border + shadow
│
├── 内容层
│   ├── 选择指示器 (1 selection)
│   ├── 分隔线
│   └── 操作按钮区
│       ├── Ask in sidebar 按钮
│       └── Add to chat 按钮
│
└── 动画层
    ├── fade-in (透明度)
    ├── zoom-in (缩放)
    └── transform (位置)
```

## 性能优化点

1. **事件监听**：只在 SelectableMessageResponse 容器内监听
2. **位置计算**：使用 setTimeout 延迟计算，避免频繁触发
3. **状态更新**：使用 Jotai atom 避免不必要的重渲染
4. **组件记忆化**：关键组件使用 React.memo
5. **外部点击检测**：使用 ref 而不是全局监听

## 可扩展性

未来可以扩展的功能：

1. **更多操作**：
   - 复制文本
   - 翻译选中内容
   - 搜索相关内容
   - 高亮标记

2. **键盘快捷键**：
   - Cmd/Ctrl + K: 快速提问
   - Cmd/Ctrl + Shift + C: 复制引用格式

3. **选择历史**：
   - 记录最近的选择
   - 快速访问历史引用

4. **智能建议**：
   - 根据选中内容推荐问题
   - 相关知识推荐
