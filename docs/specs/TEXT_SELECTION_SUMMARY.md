# 划词功能实现总结

## ✅ 已完成的工作

### 1. 核心组件

#### `TextSelectionToolbar` (文本选择工具栏)
- 📁 位置：`apps/electron/src/renderer/components/ai-elements/text-selection-toolbar.tsx`
- ✨ 功能：
  - 浮动工具栏，显示在选中文本上方
  - 显示选择数量指示器 "1 selection"
  - 两个操作按钮：
    - "Ask in sidebar" - 在侧边栏中提问
    - "Add to chat" - 添加到当前对话框
  - 点击外部自动关闭
  - 带淡入动画效果

#### `SelectableMessageResponse` (可选择的消息响应)
- 📁 位置：`apps/electron/src/renderer/components/ai-elements/selectable-message-response.tsx`
- ✨ 功能：
  - 包装 `MessageResponse` 组件
  - 集成文本选择功能
  - 处理 "Ask in sidebar" 和 "Add to chat" 事件
  - 管理工具栏的显示和隐藏

### 2. 自定义 Hooks

#### `useTextSelection`
- 📁 位置：`apps/electron/src/renderer/hooks/useTextSelection.ts`
- ✨ 功能：
  - 监听文本选择事件
  - 计算工具栏位置（选中区域中心上方）
  - 验证选择是否在容器内
  - 提供清除选择的方法

### 3. 状态管理

#### `text-selection-atoms.ts`
- 📁 位置：`apps/electron/src/renderer/atoms/text-selection-atoms.ts`
- ✨ 包含：
  - `pendingQuoteAtom` - 待添加到输入框的引用文本
  - `sidebarQuoteAtom` - 侧边栏提问的引用文本
  - `SelectedTextQuote` 接口定义

### 4. 文档和示例

- ✅ **使用指南**：`TEXT_SELECTION_FEATURE.md`
- ✅ **集成示例**：`text-selection-examples.tsx`
  - Agent 消息中使用示例
  - 输入框处理引用示例
  - 侧边栏处理引用示例
  - 完整对话组件集成示例

### 5. 组件修改

#### `message.tsx` 
- ✅ 将 `MessageResponseProps` 从 `interface` 改为 `export interface`
- ✅ 导出 `SelectableMessageResponse` 组件

## 📋 下一步需要完成的工作

### 1. 输入框集成（高优先级）

需要修改 `rich-text-input.tsx`，添加监听 `pendingQuoteAtom` 的逻辑：

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

### 2. 侧边栏集成（高优先级）

需要找到或创建侧边栏组件，添加监听 `sidebarQuoteAtom` 的逻辑：

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

### 3. 在实际会话中使用（高优先级）

找到显示 Agent 消息的组件，将 `MessageResponse` 替换为 `SelectableMessageResponse`：

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

可能的文件位置：
- `apps/electron/src/renderer/components/agent/*.tsx`
- `apps/electron/src/renderer/components/ai-elements/*.tsx`

### 4. i18n 国际化（中优先级）

需要添加文本选择相关的翻译：

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

**zh.json**:
```json
{
  "textSelection": {
    "selection": "个选择",
    "askInSidebar": "在侧边栏提问",
    "addToChat": "添加到对话"
  }
}
```

然后修改 `text-selection-toolbar.tsx` 使用 `useT` hook。

### 5. 测试和优化（中优先级）

- ✅ 测试文本选择在不同内容长度下的表现
- ✅ 测试工具栏位置在不同滚动位置下的准确性
- ✅ 测试多次快速选择的性能
- ✅ 测试在移动端/小屏幕上的表现
- ✅ 添加键盘快捷键支持（如 Cmd+K 快速触发）

### 6. 样式微调（低优先级）

- 调整工具栏的圆角、阴影、间距等细节
- 添加更多的动画效果（如按钮 hover 效果）
- 适配深色/浅色主题

## 🔍 需要查找的文件

为了完成集成，需要找到以下文件：

1. **输入框组件**：
   - ✅ 已找到：`apps/electron/src/renderer/components/ai-elements/rich-text-input.tsx`

2. **侧边栏组件**：
   - 需要查找侧边栏的实现
   - 可能在 `apps/electron/src/renderer/components/app-shell/` 下

3. **Agent 会话组件**：
   - 需要找到显示 AI 消息的组件
   - 可能在 `apps/electron/src/renderer/components/agent/` 下

## 🎯 快速启动指南

要启用这个功能，最简单的步骤：

1. **找到显示 AI 消息的地方**，将：
   ```tsx
   <MessageResponse>{content}</MessageResponse>
   ```
   改为：
   ```tsx
   <SelectableMessageResponse>{content}</SelectableMessageResponse>
   ```

2. **在输入框组件中添加监听**，参考上面的代码片段

3. **测试**：选中 AI 生成的文本，应该会看到工具栏弹出

## 📊 技术栈

- **UI 框架**：React 18 + TypeScript
- **状态管理**：Jotai
- **样式**：Tailwind CSS
- **图标**：Lucide React
- **类型安全**：完整的 TypeScript 类型定义

## 🐛 已知限制

1. 目前仅支持鼠标选择，不支持触摸选择（移动端）
2. 工具栏位置在极端滚动情况下可能需要调整
3. 暂未实现键盘快捷键

## 📝 更新日志

- 2026-09-03: 初始实现，完成核心功能和文档
