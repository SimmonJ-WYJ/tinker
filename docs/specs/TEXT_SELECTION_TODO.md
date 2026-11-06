# 划词功能集成清单

## ✅ 已完成

- [x] 创建 `TextSelectionToolbar` 组件
- [x] 创建 `SelectableMessageResponse` 组件  
- [x] 创建 `useTextSelection` Hook
- [x] 创建状态管理 atoms
- [x] 修改 `message.tsx` 导出必要的类型和组件
- [x] 编写使用文档和示例代码

## 📋 待完成集成任务

### 任务 1: 在输入框中处理引用 ⚡ 高优先级

**文件**: `apps/electron/src/renderer/components/ai-elements/rich-text-input.tsx`

**需要添加的代码**:

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

**验证**: 选中 AI 消息中的文本，点击 "Add to chat"，应该看到引用内容出现在输入框中。

---

### 任务 2: 找到并修改 AI 消息渲染组件 ⚡ 高优先级

**步骤**:

1. 搜索使用 `MessageResponse` 的地方：
   ```bash
   cd /Users/simmonj/Desktop/Work\ Projects/ASCI-main-ui
   grep -r "MessageResponse" apps/electron/src/renderer/components --include="*.tsx" | grep -v "test"
   ```

2. 找到渲染 AI 消息的组件（通常在 `agent/` 或 `conversation/` 目录下）

3. 将以下代码：
   ```tsx
   <MessageResponse basePath={basePath}>
     {content}
   </MessageResponse>
   ```
   
   替换为：
   ```tsx
   <SelectableMessageResponse basePath={basePath}>
     {content}
   </SelectableMessageResponse>
   ```

4. 添加导入：
   ```tsx
   import { SelectableMessageResponse } from '@/components/ai-elements/message'
   ```

**验证**: 在 AI 消息中选择文本，应该看到浮动工具栏出现。

---

### 任务 3: 实现侧边栏集成 ⚡ 高优先级

**需要找到的组件**: 侧边栏或右侧面板组件

**搜索命令**:
```bash
cd /Users/simmonj/Desktop/Work\ Projects/ASCI-main-ui
find apps/electron/src/renderer/components -name "*sidebar*" -o -name "*panel*" | grep -E "\.tsx$"
```

**需要添加的逻辑**:

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

**验证**: 选中 AI 消息中的文本，点击 "Ask in sidebar"，侧边栏应该打开并显示引用内容。

---

### 任务 4: 添加国际化支持 📝 中优先级

**文件位置**: `apps/electron/src/renderer/locales/`

**英文** (`en/common.json` 或新建 `en/text-selection.json`):
```json
{
  "textSelection": {
    "selection": "selection",
    "askInSidebar": "Ask in sidebar",
    "addToChat": "Add to chat"
  }
}
```

**中文** (`zh/common.json` 或新建 `zh/text-selection.json`):
```json
{
  "textSelection": {
    "selection": "个选择",
    "askInSidebar": "在侧边栏提问",
    "addToChat": "添加到对话"
  }
}
```

**修改 `TextSelectionToolbar` 组件**:
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

### 任务 5: 测试 🧪 中优先级

**测试场景**:

- [ ] 选中短文本（一行）
- [ ] 选中长文本（多行）
- [ ] 选中包含代码块的文本
- [ ] 选中包含列表的文本
- [ ] 在滚动的情况下选中文本
- [ ] 快速连续选中多次
- [ ] 点击工具栏外部关闭
- [ ] 点击按钮后工具栏关闭
- [ ] 引用正确插入到输入框
- [ ] 侧边栏正确打开并显示引用

---

### 任务 6: 样式优化 🎨 低优先级

**可选的样式改进**:

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

## 🚀 快速启动

完成核心集成只需 3 步：

1. **修改输入框组件** (任务 1)
2. **找到并修改 AI 消息组件** (任务 2)  
3. **测试** (任务 5 的基本场景)

侧边栏集成（任务 3）可以稍后完成。

## 🔧 调试技巧

如果功能不工作，检查：

1. **工具栏不显示**:
   - 检查是否使用了 `SelectableMessageResponse` 而不是 `MessageResponse`
   - 打开浏览器开发者工具，检查是否有 JavaScript 错误
   - 确认选择的文本在正确的容器内

2. **点击按钮无反应**:
   - 检查 atoms 是否正确导入
   - 在 `useEffect` 中添加 `console.log` 查看状态变化
   - 确认输入框组件正在监听对应的 atom

3. **引用格式不正确**:
   - 检查 `split('\n').map(line => > ${line})` 的逻辑
   - 确认编辑器的 `insertContent` API 使用正确

## 📞 需要帮助？

如果遇到问题：

1. 查看 `TEXT_SELECTION_FEATURE.md` 中的详细文档
2. 参考 `text-selection-examples.tsx` 中的示例代码
3. 检查浏览器控制台的错误信息

## 🎉 完成标志

当以下都能正常工作时，功能就完成了：

- ✅ 选中 AI 消息中的文本时显示工具栏
- ✅ 点击 "Add to chat" 后引用出现在输入框
- ✅ 点击 "Ask in sidebar" 后侧边栏打开并显示引用
- ✅ 工具栏样式美观，动画流畅
- ✅ 支持中英文切换
