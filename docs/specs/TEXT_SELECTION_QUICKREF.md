# 📌 划词功能快速参考卡

## 🚀 3 步启用功能

### 1️⃣ 替换 AI 消息组件
```tsx
// 找到显示 AI 消息的地方
import { SelectableMessageResponse } from '@/components/ai-elements/message'

// 替换
<MessageResponse>{content}</MessageResponse>
// 为
<SelectableMessageResponse>{content}</SelectableMessageResponse>
```

### 2️⃣ 输入框集成
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

### 3️⃣ 侧边栏集成
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

## 📁 文件位置

```
核心代码:
├─ atoms/text-selection-atoms.ts
├─ components/ai-elements/
│  ├─ text-selection-toolbar.tsx
│  ├─ selectable-message-response.tsx
│  └─ message.tsx (已修改)
└─ hooks/useTextSelection.ts

文档:
├─ TEXT_SELECTION_TODO.md        ← 集成清单
├─ TEXT_SELECTION_FEATURE.md     ← 使用指南
├─ TEXT_SELECTION_ARCHITECTURE.md ← 架构图
├─ TEXT_SELECTION_DEMO.md        ← 演示脚本
└─ TEXT_SELECTION_REPORT.md      ← 完成报告
```

---

## 🔍 查找需要修改的文件

```bash
# 查找使用 MessageResponse 的地方
grep -r "MessageResponse" apps/electron/src/renderer/components --include="*.tsx"

# 查找输入框组件
find apps/electron/src/renderer -name "*input*.tsx" -o -name "*composer*.tsx"

# 查找侧边栏组件
find apps/electron/src/renderer -name "*sidebar*.tsx" -o -name "*panel*.tsx"
```

---

## 🎨 效果预览

```
用户选中文本后:

┌─────────────────────────────────────┐
│  💬 1 selection                     │
│  ├─ Ask in sidebar  ├─ Add to chat │ ← 浮动工具栏
└─────────────────────────────────────┘
        ↓ 悬浮在选中文本上方
┌────────────────────────────────────────┐
│ AI: 量子计算是[选中的文本内容]...      │
└────────────────────────────────────────┘
```

---

## 🐛 调试检查点

### 工具栏不显示？
- ✓ 检查是否使用 `SelectableMessageResponse`
- ✓ 查看控制台是否有错误
- ✓ 确认文本选择在正确容器内

### 点击按钮无反应？
- ✓ 检查 atoms 导入是否正确
- ✓ 确认输入框/侧边栏组件正在监听 atom
- ✓ 添加 console.log 查看状态变化

### 引用格式不对？
- ✓ 检查 `.split('\n').map(...)` 逻辑
- ✓ 确认编辑器 API 使用正确
- ✓ 查看实际插入的文本内容

---

## 💡 关键概念

**组件**: `SelectableMessageResponse` = `MessageResponse` + 文本选择
**状态**: `pendingQuoteAtom` (添加到对话) + `sidebarQuoteAtom` (侧边栏)
**Hook**: `useTextSelection` 处理选择逻辑和位置计算
**UI**: `TextSelectionToolbar` 浮动工具栏组件

---

## 📊 性能提示

- ✅ 只在 AI 消息中启用（不用于用户消息）
- ✅ 事件监听仅限于容器内
- ✅ 使用 Jotai atoms 避免不必要的重渲染
- ✅ 组件卸载时自动清理

---

## 🎯 下一步

1. [ ] 完成输入框集成 (15 分钟)
2. [ ] 完成侧边栏集成 (20 分钟)
3. [ ] 替换 MessageResponse (5 分钟)
4. [ ] 测试基本功能 (10 分钟)
5. [ ] 添加 i18n (可选，15 分钟)

**总时间**: 约 1 小时即可完成基础集成

---

## 📞 获取帮助

- 详细文档: `TEXT_SELECTION_FEATURE.md`
- 集成步骤: `TEXT_SELECTION_TODO.md`
- 架构说明: `TEXT_SELECTION_ARCHITECTURE.md`
- 示例代码: `text-selection-examples.tsx`

---

## ✅ 验证清单

完成后验证以下功能：

- [ ] 选中 AI 消息中的文本时工具栏出现
- [ ] 点击 "Add to chat" 引用插入到输入框
- [ ] 点击 "Ask in sidebar" 侧边栏打开并显示引用
- [ ] 工具栏位置正确（文本上方居中）
- [ ] 点击外部或按钮后工具栏关闭
- [ ] 支持中英文切换（如果已添加 i18n）

---

**快速链接**: 
- 📝 TODO: `TEXT_SELECTION_TODO.md`
- 📚 文档: `TEXT_SELECTION_FEATURE.md`
- 🏗️ 架构: `TEXT_SELECTION_ARCHITECTURE.md`
- 🎬 演示: `TEXT_SELECTION_DEMO.md`
- 📊 报告: `TEXT_SELECTION_REPORT.md`
