# Tab Strip Unification Spec

状态: implementing
关联 issue: N/A
关联 PR: N/A
领域语言事实源: `CONTEXT.md`, `docs/specs/right-panel-tab-bar-chrome-spec.md`, `docs/specs/workspace-scoped-tabs-spec.md`

## 背景

主对话流顶部和右侧栏顶部原先都使用 tab 形态，但信息架构并不相同。主对话流顶部当前只展示当前会话，与左侧会话列表共同承担全局会话导航；右侧栏顶部展示当前会话内的上下文 tab（会话文件、检索论文、论文/文件详情等），这些 tab 有明确的局部工作区价值。

## 目标

1. 主对话流顶部采用 Codex 式单行 header，只显示当前会话标题与更多入口，不显示会话类型 icon 或关闭按钮，降低与左侧会话列表的重复，并避免单项内容伪装成 tab。
2. 右侧栏顶部继续显示多个上下文 tab，保留文件/论文详情的累积模型。
3. 主顶部标题栏与右侧栏 tab 复用同一套基础 primitive，统一图标、关闭按钮和文字截断；只有右侧多菜单继续使用 tab chip 激活态。

## 非目标

1. 不改 tab 状态存储结构。
2. 不移除多会话状态；仅改变主顶部可视呈现。
3. 不改右侧栏动态 tab 的打开/关闭语义。

## 行为

- 主顶部从当前工作区可见 tab 中选择 active tab；若 active 不可见，则回退到第一个可见 tab。
- 主顶部不再横向展示其他会话 tab，也不使用圆角/浮起的 tab chip 视觉；它是一条单行 header，左侧为当前会话标题，旁边是更多入口。切换会话继续通过左侧会话列表完成。
- 主顶部更多入口点击后打开功能菜单，至少包含重命名当前会话和打开会话文件夹两个动作。
- 主内容区不再额外渲染第二行会话标题，避免标题重复。
- 右侧栏仍展示当前会话的所有 right panel tabs。
- 右侧栏 tab chip 共享 `tabStripChipClassNames()` 等样式生成函数；主顶部使用 `currentConversationStripClassNames()` 生成 Codex 式单行标题入口。

## 验证

- 单测覆盖主顶部 tab 选择逻辑。
- 单测覆盖右侧栏 tab chip 的 active/inactive class，以及主顶部 flat strip 不包含 tab chip 激活态 class。
- 运行 `bun run typecheck`。
- 运行 `bun test`。
- UI 需通过 `bun run dev` 或 `bun run electron:start` 目检主顶部与右侧栏 tab。
