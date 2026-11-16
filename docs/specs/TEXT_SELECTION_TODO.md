<a id="划词功能集成清单"></a>

# Text Selection Feature Integration Checklist

<a id="-已完成"></a>

## ✅ Completed

- [x] Create `TextSelectionToolbar` component
- [x] Create `SelectableMessageResponse` component
- [x] Create `useTextSelection` Hook
- [x] Create state-management atoms
- [x] Update `message.tsx` to export necessary types and components
- [x] Write usage documentation and example code

<a id="-待完成集成任务"></a>

## 📋 Pending Integration Tasks

<a id="任务-1-在输入框中处理引用-&#45;高优先级"></a>

### Task 1: Handle Quotes in the Input ⚡ High Priority

**File**: `apps/electron/src/renderer/components/ai-elements/rich-text-input.tsx`

**Code to add** (original code comments retained: import at file top, declare in the component, observe quotes with useEffect, format Markdown quotes, append to the editor, then clear state):

```tsx
// 1. 在文件顶部添加导入
import { useAtom } from 'jotai'
import { pendingQuoteAtom } from '@/atoms/text-selection-atoms'

// 2. 在组件函数内部添加
const [pendingQuote, setPendingQuote] = useAtom(pendingQuoteAtom)

// 3. 添加 useEffect 监听引用
React.useEffect(() => {
  if (!pendingQuote || !editor) return
  
  // 格式化为 Markdown 引用
  const quoteText = pendingQuote.text
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
  
  // 插入到编辑器末尾
  editor.commands.insertContent(`${quoteText}\n\n`)
  editor.commands.focus('end')
  
  // 清除状态
  setPendingQuote(null)
}, [pendingQuote, editor, setPendingQuote])
```

**Verification**: select text in an AI message and click “Add to chat”; the quoted content should appear in the input.

---

<a id="任务-2-找到并修改-ai-消息渲染组件-&#45;高优先级"></a>

### Task 2: Find and Update the AI Message Renderer ⚡ High Priority

**Steps**:

1. Search for uses of `MessageResponse`:
   ```bash
   cd /Users/simmonj/Desktop/Work\ Projects/ASCI-main-ui
   grep -r "MessageResponse" apps/electron/src/renderer/components --include="*.tsx" | grep -v "test"
   ```

2. Find the component rendering AI messages (usually under `agent/` or `conversation/`).

3. Replace this code:
   ```tsx
   <MessageResponse basePath={basePath}>
     {content}
   </MessageResponse>
   ```

   With:
   ```tsx
   <SelectableMessageResponse basePath={basePath}>
     {content}
   </SelectableMessageResponse>
   ```

4. Add the import:
   ```tsx
   import { SelectableMessageResponse } from '@/components/ai-elements/message'
   ```

**Verification**: selecting text in an AI message should display a floating toolbar.

---

<a id="任务-3-实现侧边栏集成-&#45;高优先级"></a>

### Task 3: Implement Sidebar Integration ⚡ High Priority

**Component to find**: sidebar or right-side panel component

**Search command**:
```bash
cd /Users/simmonj/Desktop/Work\ Projects/ASCI-main-ui
find apps/electron/src/renderer/components -name "*sidebar*" -o -name "*panel*" | grep -E "\.tsx$"
```

**Logic to add** (original comments describe adding this to the sidebar, opening it, formatting the quote, adapting input state to the actual sidebar, clearing state, and retaining the rest of the component; the literal input prefix means “Regarding the following content”):

```tsx
// 在侧边栏组件中添加
import { useAtom } from 'jotai'
import { sidebarQuoteAtom } from '@/atoms/text-selection-atoms'

function YourSidebarComponent() {
  const [sidebarQuote, setSidebarQuote] = useAtom(sidebarQuoteAtom)
  const [isOpen, setIsOpen] = React.useState(false)
  const [inputValue, setInputValue] = React.useState('')

  React.useEffect(() => {
    if (!sidebarQuote) return
    
    // 打开侧边栏
    setIsOpen(true)
    
    // 格式化引用
    const quoteText = sidebarQuote.text
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n')
    
    // 设置到输入框（根据实际侧边栏的状态管理调整）
    setInputValue(`关于以下内容：\n\n${quoteText}\n\n`)
    
    // 清除状态
    setSidebarQuote(null)
  }, [sidebarQuote, setSidebarQuote])
  
  // ... 组件其余部分
}
```

**Verification**: select text in an AI message and click “Ask in sidebar”; the sidebar should open with the quote.

---

<a id="任务-4-添加国际化支持-&#45;中优先级"></a>

### Task 4: Add Internationalization Support 📝 Medium Priority

**File location**: `apps/electron/src/renderer/locales/`

**English** (`en/common.json` or new `en/text-selection.json`):
```json
{
  "textSelection": {
    "selection": "selection",
    "askInSidebar": "Ask in sidebar",
    "addToChat": "Add to chat"
  }
}
```

**Chinese** (`zh/common.json` or new `zh/text-selection.json`; original localized literals mean “selection,” “Ask in sidebar,” and “Add to chat”):
```json
{
  "textSelection": {
    "selection": "个选择",
    "askInSidebar": "在侧边栏提问",
    "addToChat": "添加到对话"
  }
}
```

**Update `TextSelectionToolbar`** (the original comment permits the alternative textSelection namespace):
```tsx
import { useT } from '@/hooks/useT'

export function TextSelectionToolbar({ ... }) {
  const { t } = useT('common') // 或 'textSelection'
  
  return (
    <div>
      <span>{t('textSelection.selection', '1 selection')}</span>
      <Button>
        {t('textSelection.askInSidebar', 'Ask in sidebar')}
      </Button>
      <Button>
        {t('textSelection.addToChat', 'Add to chat')}
      </Button>
    </div>
  )
}
```

---

<a id="任务-5-测试-&#45;中优先级"></a>

### Task 5: Testing 🧪 Medium Priority

**Test scenarios**:

- [ ] Select short text (one line)
- [ ] Select long text (multiple lines)
- [ ] Select text containing code blocks
- [ ] Select text containing lists
- [ ] Select text while scrolling
- [ ] Make several selections in quick succession
- [ ] Click outside the toolbar to close it
- [ ] Toolbar closes after clicking a button
- [ ] Quote inserts correctly into the input
- [ ] Sidebar opens correctly and displays the quote

---

<a id="任务-6-样式优化-&#45;低优先级"></a>

### Task 6: Style Improvements 🎨 Low Priority

**Optional style improvements** (original comments describe toolbar style adjustments: stronger blur and shadow, padding adjustments, and slide-in animation):

```tsx
// 在 TextSelectionToolbar 中调整样式
className={cn(
  'fixed z-50 flex items-center gap-1',
  'rounded-xl bg-background/95 backdrop-blur-md', // 增加模糊度
  'border border-border/60 shadow-xl', // 增强阴影
  'px-2.5 py-2', // 调整内边距
  'animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200' // 添加滑入动画
)}
```

---

<a id="-快速启动"></a>

## 🚀 Quick Start

Core integration takes only 3 steps:

1. **Update the input component** (Task 1)
2. **Find and update the AI message component** (Task 2)
3. **Test** (basic scenarios in Task 5)

Sidebar integration (Task 3) can follow later.

<a id="-调试技巧"></a>

## 🔧 Debugging Tips

If the feature does not work, check:

1. **Toolbar does not appear**:
   - Check that `SelectableMessageResponse` replaces `MessageResponse`
   - Open browser developer tools and check for JavaScript errors
   - Confirm the selected text is inside the correct container

2. **Buttons do nothing**:
   - Check atoms are imported correctly
   - Add `console.log` in `useEffect` to inspect state changes
   - Confirm the input component observes the corresponding atom

3. **Incorrect quote formatting**:
   - Check the `split('\n').map(line => > ${line})` logic
   - Confirm correct use of the editor's `insertContent` API

<a id="-需要帮助"></a>

## 📞 Need Help?

If you encounter problems:

1. Read detailed documentation in `TEXT_SELECTION_FEATURE.md`
2. Refer to example code in `text-selection-examples.tsx`
3. Check browser console errors

<a id="-完成标志"></a>

## 🎉 Completion Criteria

The feature is complete when all of the following work:

- ✅ Selecting text in an AI message displays the toolbar
- ✅ Clicking “Add to chat” inserts the quote into the input
- ✅ Clicking “Ask in sidebar” opens the sidebar with the quote
- ✅ Toolbar styling is attractive and animation is smooth
- ✅ Chinese/English switching is supported
