# 聊天思考与生成文字流光验收

基线 main `842c89e1ad2cbbbb230340b67e6a71989d1816f3`。本地分支 `fix/chat-status-shimmer`。两张用户截图已通过 Library 物化到本机并实际查看，未使用用户真实会话做测试。本轮不发布、打包或替换应用。

## 实际改动

- 等待行移除颗粒球，复用既有静态 ConversationSymbol，与标准回复 Logo 列对齐。
- RunningStatusText 只渲染单份可访问文字，2.6s 纯 CSS 渐变扫光，不位移、不脉冲、不表示真实推理进度，没有 JS 动画定时器。
- SDK 过程主标题、生图标题及当前思考/执行标题共用组件。生图副文案、步数、展开控件和实际结果含义保留。历史标题不高光。
- 聊天滚动按钮去掉球体，保留上下箭头、到最新与返回原阅读点、按钮文案和键盘操作。独立上下文用量/压缩徽章不在本次范围。
- reduced-motion 与 forced-colors 时移除渐变/动画并恢复普通文字，无渐变支持时也有可读文字。
- 没有新增 UI 文案或依赖，没有修改 Rust、IPC、数据格式、后端调度或图片授权。

## 状态与去重边界

- 开始等待、SDK 只有空文本/空白/思考块、转入生图：当前回合只有一个主运行标题及一个对应 Logo。
- 纯正文流式输出保留原尾部运行提示，沿用已有 Logo 列缩进，不重复绘制 Logo。
- 宿主停止、running=false 或重试终态优先于延迟 streaming 标记。未完成图片调用明确停止后不会继续生成高光。
- 只读既有 queuedMessageUuidsAtom，未处理的乐观用户消息不切换当前工具状态。沿用现有 complete 清队列语义，不新增消费推断或写队列。
- 已接手用户输入及 compact_boundary/compacting 划分当前尾回合，之前完成回合不会因仍位于累积 live 列表而高光。
- 图片成功、部分成功、失败、停止与不完整结果继续保持各自文案，不把停止前的成功结果改成失败。

## 红绿、最终检查与独立复审

| 检查 | 最终结果 |
| --- | --- |
| 相关六文件回归 | 50 pass、0 fail、161 assertions |
| 全仓 Bun | 3457 pass、4 既有 skip、0 fail，3461 tests / 383 files |
| Typecheck | 6 workspace 全部退出 0 |
| Lint | 退出 0 |
| Electron build | 退出 0，正常登录且保留 Candidate 配置隔离 |
| 独立复审 | 发现的纯正文漏态、旧 live 回合、FIFO 和压缩边界均红测复现后修正，无剩余阻塞 |
| 独立增量测试 | AgentMessages 11 pass、0 fail、38 assertions |
| 差异检查 | 通过，未修改 README/CLAUDE、Rust 或锁文件 |

红测复现过无 Logo/无流光、停止优先级、空 text 双 Logo、纯正文缺失运行提示、旧 live 双高光、乐观 FIFO 误终态、压缩前旧状态。早期类型检查发现 SDK text 是 unknown，最终用显式 string 检查通过，没有 any。合成完成态图片读取用局部 mock 并在每个测试后恢复，不读取本机附件。冗长的失败 DOM 转储仅保留了本机前部诊断摘要。

## 实际视觉验证

浏览器挂载真实 AgentMessages、SDK 渲染器、生图状态与正式 CSS，使用隔离存储、模拟附件与无模型回调，62 项检查通过且无 pageerror。

- 中英文 × 深浅主题覆盖等待、空/空白首 token、思考、纯正文、生图、完成、取消、失败、迟到停止、重试失败、排队多回合与下一回合等待。
- 实测背景位置从 91.0231% 移到 47.4385%，文字范围始终为 x364/y242、131.375×22 CSS px，transform=none，Logo 无动画。
- 生图展开与收起仍可用，副文案没有高光。
- reduced-motion 与 forced-colors 的 animation/background 均为 none，文字填色非透明。
- 390px 窄窗中文思考标题无裁切，完成/取消/失败后没有残留 agent-status-shimmer 动画。

本机证据：`/tmp/tinker-status-shimmer-qa-20261109/result.json`、`generating-light.png`、`generating-dark.png`、`thinking-narrow.png`。已实际查看三图。外部 Vite 夹具最初未正确转换模块，改用已验证的本机渲染目录后完成验收，临时入口随后移除。临时夹具和原始用户图片不进入提交。三张合成数据验收截图保存到 `docs/reports/assets/2026-11-09-status-{light,dark,narrow}.png`，仅用于 GitHub UI 复核，未上传 Library。

## 限制与交付

没有运行真实模型、付费生图或生产账号端到端，没有安装/打包/替换当前应用或桌面 DMG。视觉验收在真实独立浏览器中完成，不代表 Electron 安装包已更新或完成屏幕阅读器人工审计。实现提交为 `9a6522e`。用户随后明确要求提交到 main，本次按该授权进行 GitHub PR 审查与合并，不更新安装包。
