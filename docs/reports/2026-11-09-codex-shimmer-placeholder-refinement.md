# 用户复调：浅色占位与 Codex 式扫光

本轮在本地分支 fix/config-placeholder-loading-contrast 继续调整，承接 f04afa7。用户明确要求占位文字更浅、运行状态默认字色与光感参考 Codex，随后再次要求只将框内示例调浅。

## 最终改动

- 新 channel-form.css 仅选中模型配置里的 input::placeholder 和空 Base URL 说明。
- 浅色占位从 #737373 经 #999999 调至 #B4B4B4，辅助说明 #8F8F8F。深色占位 #858585，辅助说明 #999999。
- 真实输入、标签与必填反馈保留原色，URL 示例前缀、空值门控及实际端点预览沿用上一提交。
- 运行文字基色改为浅色 #5D5D5D、深色 #CDCDCD 的 55% 透明字色，窄白色扫光为 75%，不再是持续偏黑的主标题。
- .6s 进入等待、1s 扫过、48 steps、4s 周期，其余时间保持底字。用单份文字的 CSS 背景裁切实现，不复制可访问文字、不新增 JS 定时器。
- reduced-motion 与 forced-colors 恢复普通文字；配置占位在 forced-colors 使用系统 GrayText。

## 参考与边界

只读检查了本机 `/Applications/ChatGPT.app/Contents/Resources/app.asar` 的 Codex CadencedLoadingShimmer 样式与节奏。参考包含 55% 基色、75% 高光、半文字宽度渐变、600ms 初次等待、1s/48 steps 扫过、4s 调度。源 CSS/JS 留在 /tmp 作为核对资料，不提交到项目。没有读取聊天、认证、截图中 Key 或其他个人数据。

GPT 不同输入场景使用不同占位 token。本轮根据用户指定的浅灰观感采用 #B4B4B4，不声称所有 GPT 表单都使用同一颜色。Tinker 的字体、字号和布局保留，未复制 Codex 的可见性调度实现。

本次用户选择覆盖上一轮“所有扫光端点至少 4.5:1”的视觉目标，旧报告的对比数字只描述 f04afa7，不代表这次更浅的视觉方案。

## 验证

- 全仓最终：3459 pass、4 既有 skip、0 fail，3463 tests / 384 files。
- Typecheck：6 workspace 通过；lint 与 Electron build 通过。
- 首次并行全仓运行有一个既有 runtime-provisioner 测试 5s 超时，未改运行时代码，结束并发后完整重跑通过。
- 实际浏览器检查浅深色占位、辅助说明与真实输入各自颜色，中文/英文、390px、停止/重新开始、减少动态与强制颜色。
- 时间采样验证 .6s 等待、1s 扫过、循环留白与重置，文字范围固定，单份标题可访问语义保留。
- 精确循环边界的浮点采样曾失败，改为边界后 10ms 的采样通过。深色输入检查等待既有 300ms 主题过渡后通过，无生产代码绕过。
- `/tmp/tinker-ux-contrast-qa-20261109/preview-v3-result.json` 为最终预览核验，原生模型请求为 0。
- 临时预览入口未进入生产提交，独立静态预览留在 `/tmp/tinker-ux-view-20261109`，由本机 127.0.0.1:5204 提供。

没有 push、合并、安装或替换桌面 DMG。现用 0.1.615 不会自动更新；本地源码仍为提交钩子维护的 0.1.616。
