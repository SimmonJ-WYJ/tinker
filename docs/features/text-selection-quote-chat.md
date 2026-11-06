# 文本选择与引用对话功能

## 功能概述

用户可以在 AI 生成的消息中选择文本，会出现一个浮动工具栏，提供两个操作：

1. **Ask in sidebar** - 在右侧面板打开一个新的对话 tab，显示选中的文本
2. **Add to chat** - 将选中的文本作为引用插入到当前聊天输入框

## 实现文件

### 核心组件
- `apps/electron/src/renderer/components/ai-elements/text-selection-toolbar.tsx` - 浮动工具栏 UI
- `apps/electron/src/renderer/components/ai-elements/selectable-message-response.tsx` - 可选择文本的消息包装器
- `apps/electron/src/renderer/components/agent/QuoteChatView.tsx` - 右侧面板的引用对话视图

### Hooks
- `apps/electron/src/renderer/hooks/useTextSelection.ts` - 文本选择逻辑
- `apps/electron/src/renderer/hooks/useQuoteChatTab.ts` - 监听侧边栏引用并自动打开 tab

### 状态管理
- `apps/electron/src/renderer/atoms/text-selection-atoms.ts` - 文本选择状态
  - `pendingQuoteAtom` - 待插入聊天框的引用
  - `sidebarQuoteAtom` - 待显示在侧边栏的引用

### 集成点
- `apps/electron/src/renderer/components/agent/AgentMessages.tsx` - 使用 SelectableMessageResponse
- `apps/electron/src/renderer/components/agent/ContentBlock.tsx` - 使用 SelectableMessageResponse
- `apps/electron/src/renderer/components/ai-elements/rich-text-input.tsx` - 监听 pendingQuoteAtom 并插入引用
- `apps/electron/src/renderer/main.tsx` - 在 AgentListenersInitializer 中调用 useQuoteChatTab

### 右侧面板集成
- `apps/electron/src/renderer/atoms/right-panel-tabs.ts` - 添加 'quote-chat' TabKind
- `apps/electron/src/renderer/components/app-shell/RightPanelTabContent.tsx` - 渲染 QuoteChatView
- `apps/electron/src/renderer/components/app-shell/RightPanelTabBar.tsx` - 添加图标和标题

### i18n
- `apps/electron/src/renderer/locales/en/conversation/panels.json` - 英文翻译
- `apps/electron/src/renderer/locales/zh/conversation/panels.json` - 中文翻译

## 使用流程

### Add to chat
1. 用户在 AI 消息中选择文本
2. 点击工具栏的 "Add to chat" 按钮
3. `pendingQuoteAtom` 被设置
4. `rich-text-input.tsx` 中的 useEffect 监听到变化
5. 将文本格式化为 markdown 引用（每行前加 `> `）
6. 插入到编辑器并聚焦到末尾

### Ask in sidebar
1. 用户在 AI 消息中选择文本
2. 点击工具栏的 "Ask in sidebar" 按钮
3. `sidebarQuoteAtom` 被设置
4. `useQuoteChatTab` hook 监听到变化
5. 调用 `upsertTab` 创建或切换到 'quote-chat' tab
6. 右侧面板显示 QuoteChatView 组件
7. 组件读取 `sidebarQuoteAtom` 并显示选中的文本

## 测试要点

- 在开发模式下选择 AI 生成的文本
- 验证工具栏出现在选中文本上方
- 测试 "Add to chat" 是否正确插入引用格式
- 测试 "Ask in sidebar" 是否打开右侧 tab
- 切换语言验证翻译
