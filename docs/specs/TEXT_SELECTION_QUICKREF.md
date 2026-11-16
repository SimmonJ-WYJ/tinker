<a id="-划词功能快速参考卡"></a>

# 📌 Text Selection Quick Reference Card

<a id="-3-步启用功能"></a>

## 🚀 Enable in 3 Steps

<a id="1️⃣-替换-ai-消息组件"></a>

### 1️⃣ Replace the AI Message Component
```tsx
// 找到显示 AI 消息的地方
import { SelectableMessageResponse } from '@/components/ai-elements/message'

// 替换
<MessageResponse>{content}</MessageResponse>
// 为
<SelectableMessageResponse>{content}</SelectableMessageResponse>
```

<a id="2️⃣-输入框集成"></a>

### 2️⃣ Integrate the Input
```tsx
// 在 rich-text-input.tsx 中添加
import { useAtom } from 'jotai'
import { pendingQuoteAtom } from '@/atoms/text-selection-atoms'

const [pendingQuote, setPendingQuote] = useAtom(pendingQuoteAtom)

useEffect(() => {
  if (pendingQuote && editor) {
    const quote = pendingQuote.text.split('\n').map(l => `> ${l}`).join('\n')
    editor.commands.insertContent(`${quote}\n\n`)
    setPendingQuote(null)
  }
}, [pendingQuote, editor, setPendingQuote])
```

<a id="3️⃣-侧边栏集成"></a>

### 3️⃣ Integrate the Sidebar
```tsx
// 在侧边栏组件中添加
import { useAtom } from 'jotai'
import { sidebarQuoteAtom } from '@/atoms/text-selection-atoms'

const [sidebarQuote, setSidebarQuote] = useAtom(sidebarQuoteAtom)

useEffect(() => {
  if (sidebarQuote) {
    setOpen(true)
    setInput(`> ${sidebarQuote.text}\n\n`)
    setSidebarQuote(null)
  }
}, [sidebarQuote, setSidebarQuote])
```

---

<a id="-文件位置"></a>

## 📁 File Locations

The original tree below labels core code, modified exports, documentation, integration checklist, usage guide, architecture diagram, demonstration script, and completion report.

```
Core code:
├─ atoms/text-selection-atoms.ts
├─ components/ai-elements/
│  ├─ text-selection-toolbar.tsx
│  ├─ selectable-message-response.tsx
│  └─ message.tsx (modified)
└─ hooks/useTextSelection.ts

Documentation:
├─ TEXT_SELECTION_TODO.md        ← Integration checklist
├─ TEXT_SELECTION_FEATURE.md     ← Usage guide
├─ TEXT_SELECTION_ARCHITECTURE.md ← Architecture diagram
├─ TEXT_SELECTION_DEMO.md        ← Demo script
└─ TEXT_SELECTION_REPORT.md      ← Completion report
```

---

<a id="-查找需要修改的文件"></a>

## 🔍 Find Files to Modify

```bash
# 查找使用 MessageResponse 的地方
grep -r "MessageResponse" apps/electron/src/renderer/components --include="*.tsx"

# 查找输入框组件
find apps/electron/src/renderer -name "*input*.tsx" -o -name "*composer*.tsx"

# 查找侧边栏组件
find apps/electron/src/renderer -name "*sidebar*.tsx" -o -name "*panel*.tsx"
```

---

<a id="-效果预览"></a>

## 🎨 Preview

The original diagram shows a floating toolbar centered above selected AI text, with sidebar and chat actions.

```
After user selects text:

┌─────────────────────────────────────┐
│  💬 1 selection                     │
│  ├─ Ask in sidebar  ├─ Add to chat │ ← floating toolbar
└─────────────────────────────────────┘
        ↓ floats above selected text
┌────────────────────────────────────────┐
│ AI: Quantum computing is [selected text]...      │
└────────────────────────────────────────┘
```

---

<a id="-调试检查点"></a>

## 🐛 Debugging Checkpoints

<a id="工具栏不显示"></a>

### Toolbar Not Appearing?
- ✓ Check that `SelectableMessageResponse` is used.
- ✓ Check the console for errors.
- ✓ Confirm the text selection is inside the correct container.

<a id="点击按钮无反应"></a>

### Buttons Not Responding?
- ✓ Check atom imports.
- ✓ Confirm input/sidebar components subscribe to the atom.
- ✓ Add console.log to inspect state changes.

<a id="引用格式不对"></a>

### Incorrect Quote Formatting?
- ✓ Check `.split('\n').map(...)` logic.
- ✓ Confirm correct editor API usage.
- ✓ Inspect the text actually inserted.

---

<a id="-关键概念"></a>

## 💡 Key Concepts

**Component**: `SelectableMessageResponse` = `MessageResponse` + text selection
**State**: `pendingQuoteAtom` (add to chat) + `sidebarQuoteAtom` (sidebar)
**Hook**: `useTextSelection` handles selection logic and positioning
**UI**: `TextSelectionToolbar` floating toolbar component

---

<a id="-性能提示"></a>

## 📊 Performance Tips

- ✅ Enable only in AI messages (not user messages).
- ✅ Restrict event listeners to the container.
- ✅ Use Jotai atoms to avoid unnecessary rerenders.
- ✅ Clean up automatically on unmount.

---

<a id="-下一步"></a>

## 🎯 Next Steps

1. [ ] Complete input integration (15 minutes).
2. [ ] Complete sidebar integration (20 minutes).
3. [ ] Replace MessageResponse (5 minutes).
4. [ ] Test basic functionality (10 minutes).
5. [ ] Add i18n (optional, 15 minutes).

**Total time**: Approximately 1 hour for basic integration.

---

<a id="-获取帮助"></a>

## 📞 Get Help

- Detailed documentation: `TEXT_SELECTION_FEATURE.md`
- Integration steps: `TEXT_SELECTION_TODO.md`
- Architecture: `TEXT_SELECTION_ARCHITECTURE.md`
- Example code: `text-selection-examples.tsx`

---

<a id="-验证清单"></a>

## ✅ Verification Checklist

Verify these features after completion:

- [ ] Selecting text in an AI message shows the toolbar.
- [ ] Clicking "Add to chat" inserts a quote in the input.
- [ ] Clicking "Ask in sidebar" opens the sidebar with the quote.
- [ ] The toolbar is correctly positioned (centered above the text).
- [ ] Clicking outside or a button closes the toolbar.
- [ ] Chinese/English switching works (if i18n was added).

---

**Quick links**:
- 📝 TODO: `TEXT_SELECTION_TODO.md`
- 📚 Documentation: `TEXT_SELECTION_FEATURE.md`
- 🏗️ Architecture: `TEXT_SELECTION_ARCHITECTURE.md`
- 🎬 Demo: `TEXT_SELECTION_DEMO.md`
- 📊 Report: `TEXT_SELECTION_REPORT.md`
