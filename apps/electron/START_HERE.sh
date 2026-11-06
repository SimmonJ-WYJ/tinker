#!/bin/bash

cat << 'EOF'

╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║           🎉 划词功能实现完成！                                ║
║                                                               ║
║           现在只需 3 步即可启用此功能                          ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝


┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  📖 第一步: 阅读文档 (2 分钟)                                  │
│                                                               │
└───────────────────────────────────────────────────────────────┘

   打开并阅读:
   📄 apps/electron/TEXT_SELECTION_QUICKREF.md

   这个文件包含:
   • 3 步启用指南
   • 核心代码示例
   • 常见问题解答


┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  🔧 第二步: 修改代码 (40 分钟)                                 │
│                                                               │
└───────────────────────────────────────────────────────────────┘

   2.1 替换 AI 消息组件 (5 分钟)
   ──────────────────────────────────────────────────────

   查找使用 MessageResponse 的地方:
   $ grep -r "MessageResponse" apps/electron/src/renderer/components --include="*.tsx"

   将:
   <MessageResponse>{content}</MessageResponse>

   替换为:
   <SelectableMessageResponse>{content}</SelectableMessageResponse>

   添加导入:
   import { SelectableMessageResponse } from '@/components/ai-elements/message'


   2.2 集成到输入框 (15 分钟)
   ──────────────────────────────────────────────────────

   文件: apps/electron/src/renderer/components/ai-elements/rich-text-input.tsx

   在文件顶部添加:
   ┌─────────────────────────────────────────────────────┐
   │ import { useAtom } from 'jotai'                     │
   │ import { pendingQuoteAtom }                         │
   │   from '@/atoms/text-selection-atoms'               │
   └─────────────────────────────────────────────────────┘

   在组件内部添加:
   ┌─────────────────────────────────────────────────────┐
   │ const [pendingQuote, setPendingQuote] =             │
   │   useAtom(pendingQuoteAtom)                         │
   │                                                     │
   │ React.useEffect(() => {                             │
   │   if (!pendingQuote || !editor) return              │
   │                                                     │
   │   const quoteText = pendingQuote.text               │
   │     .split('\n')                                    │
   │     .map(line => `> ${line}`)                       │
   │     .join('\n')                                     │
   │                                                     │
   │   editor.commands.insertContent(`${quoteText}\n\n`) │
   │   editor.commands.focus('end')                      │
   │   setPendingQuote(null)                             │
   │ }, [pendingQuote, editor, setPendingQuote])         │
   └─────────────────────────────────────────────────────┘


   2.3 集成到侧边栏 (20 分钟)
   ──────────────────────────────────────────────────────

   查找侧边栏组件:
   $ find apps/electron/src/renderer -name "*sidebar*.tsx" -o -name "*panel*.tsx"

   在侧边栏组件中添加类似逻辑:
   ┌─────────────────────────────────────────────────────┐
   │ import { useAtom } from 'jotai'                     │
   │ import { sidebarQuoteAtom }                         │
   │   from '@/atoms/text-selection-atoms'               │
   │                                                     │
   │ const [sidebarQuote, setSidebarQuote] =             │
   │   useAtom(sidebarQuoteAtom)                         │
   │                                                     │
   │ React.useEffect(() => {                             │
   │   if (!sidebarQuote) return                         │
   │                                                     │
   │   setIsSidebarOpen(true)                            │
   │   const quote = sidebarQuote.text                   │
   │     .split('\n')                                    │
   │     .map(l => `> ${l}`)                             │
   │     .join('\n')                                     │
   │   setSidebarInput(`关于:\n\n${quote}\n\n`)          │
   │   setSidebarQuote(null)                             │
   │ }, [sidebarQuote, setSidebarQuote])                 │
   └─────────────────────────────────────────────────────┘


┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  ✅ 第三步: 测试功能 (10 分钟)                                 │
│                                                               │
└───────────────────────────────────────────────────────────────┘

   3.1 启动开发服务器
   ──────────────────────────────────────────────────────

   $ bun run dev


   3.2 测试基本功能
   ──────────────────────────────────────────────────────

   ✓ 在 AI 消息中选中文本
   ✓ 工具栏是否出现在选中文本上方
   ✓ 点击 "Add to chat"，引用是否插入到输入框
   ✓ 点击 "Ask in sidebar"，侧边栏是否打开并显示引用
   ✓ 点击外部或按钮后工具栏是否关闭


┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  📚 更多资源                                                   │
│                                                               │
└───────────────────────────────────────────────────────────────┘

   文档索引:        TEXT_SELECTION_INDEX.md
   快速参考:        TEXT_SELECTION_QUICKREF.md
   详细清单:        TEXT_SELECTION_TODO.md
   使用指南:        TEXT_SELECTION_FEATURE.md
   架构设计:        TEXT_SELECTION_ARCHITECTURE.md
   演示脚本:        TEXT_SELECTION_DEMO.md
   完成报告:        TEXT_SELECTION_REPORT.md

   示例代码:        text-selection-examples.tsx


┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  🐛 遇到问题？                                                 │
│                                                               │
└───────────────────────────────────────────────────────────────┘

   1. 查看 TEXT_SELECTION_TODO.md 的"调试技巧"部分
   2. 检查浏览器控制台是否有错误
   3. 确认所有导入路径正确
   4. 验证 atoms 是否正确导入和使用


┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  ✨ 功能特性                                                   │
│                                                               │
└───────────────────────────────────────────────────────────────┘

   ✅ 智能定位: 工具栏自动显示在选中文本上方
   ✅ 流畅动画: 淡入淡出、缩放效果
   ✅ 类型安全: 完整的 TypeScript 支持
   ✅ 状态管理: 使用 Jotai atoms
   ✅ 性能优化: 事件委托、节流
   ✅ 响应式: 适配不同屏幕尺寸


┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  🎉 开始使用！                                                 │
│                                                               │
└───────────────────────────────────────────────────────────────┘

   现在你已经了解了所有必要的信息，可以开始集成了！

   推荐流程:

   1. 阅读 TEXT_SELECTION_QUICKREF.md (2 分钟)
   2. 按照上面的步骤修改代码 (40 分钟)
   3. 启动项目并测试功能 (10 分钟)

   总计: 约 1 小时即可完成！


   祝你集成顺利！🚀

EOF
