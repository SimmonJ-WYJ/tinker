<a id="文本选择与引用对话功能"></a>

# Text selection and quote chat feature

<a id="功能概述"></a>

## Feature overview

Selecting text in an AI-generated message displays a floating toolbar with two actions:

1. **Ask in sidebar** - Open a new conversation tab in the right panel showing the selected text
2. **Add to chat** - Insert the selected text as a quote into the current chat input

<a id="实现文件"></a>

## Implementation files

<a id="核心组件"></a>

### Core components
- `apps/electron/src/renderer/components/ai-elements/text-selection-toolbar.tsx` - Floating toolbar UI
- `apps/electron/src/renderer/components/ai-elements/selectable-message-response.tsx` - Selectable message wrapper
- `apps/electron/src/renderer/components/agent/QuoteChatView.tsx` - Quote chat view in the right panel

### Hooks
- `apps/electron/src/renderer/hooks/useTextSelection.ts` - Text selection logic
- `apps/electron/src/renderer/hooks/useQuoteChatTab.ts` - Listen for sidebar quotes and automatically open a tab

<a id="状态管理"></a>

### State management
- `apps/electron/src/renderer/atoms/text-selection-atoms.ts` - Text selection state
  - `pendingQuoteAtom` - Quote pending insertion into the chat input
  - `sidebarQuoteAtom` - Quote pending display in the sidebar

<a id="集成点"></a>

### Integration points
- `apps/electron/src/renderer/components/agent/AgentMessages.tsx` - Use SelectableMessageResponse
- `apps/electron/src/renderer/components/agent/ContentBlock.tsx` - Use SelectableMessageResponse
- `apps/electron/src/renderer/components/ai-elements/rich-text-input.tsx` - Listen to pendingQuoteAtom and insert the quote
- `apps/electron/src/renderer/main.tsx` - Call useQuoteChatTab in AgentListenersInitializer

<a id="右侧面板集成"></a>

### Right-panel integration
- `apps/electron/src/renderer/atoms/right-panel-tabs.ts` - Add 'quote-chat' TabKind
- `apps/electron/src/renderer/components/app-shell/RightPanelTabContent.tsx` - Render QuoteChatView
- `apps/electron/src/renderer/components/app-shell/RightPanelTabBar.tsx` - Add icon and title

### i18n
- `apps/electron/src/renderer/locales/en/conversation/panels.json` - English translations
- `apps/electron/src/renderer/locales/zh/conversation/panels.json` - Chinese translations

<a id="使用流程"></a>

## Usage flow

### Add to chat
1. User selects text in an AI message
2. Clicks “Add to chat” in the toolbar
3. `pendingQuoteAtom` is set
4. useEffect in `rich-text-input.tsx` observes the change
5. Format text as a markdown quote (prefix each line with `> `)
6. Insert into the editor and focus the end

### Ask in sidebar
1. User selects text in an AI message
2. Clicks “Ask in sidebar” in the toolbar
3. `sidebarQuoteAtom` is set
4. `useQuoteChatTab` hook observes the change
5. Call `upsertTab` to create or switch to the 'quote-chat' tab
6. The right panel displays the QuoteChatView component
7. The component reads `sidebarQuoteAtom` and displays the selected text

<a id="测试要点"></a>

## Test points

- Select AI-generated text in development mode
- Verify the toolbar appears above the selected text
- Test that “Add to chat” correctly inserts quote formatting
- Test that “Ask in sidebar” opens the right-side tab
- Switch languages to verify translations
