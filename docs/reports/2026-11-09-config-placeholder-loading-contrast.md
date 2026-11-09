# 配置占位与 loading 可见度验收

本报告对应首轮 f04afa7，后续用户复调与最终浅色方案见 [Codex 式扫光复调记录](./2026-11-09-codex-shimmer-placeholder-refinement.md)。

## 版本和范围

- 只读确认运行进程来自 `/Volumes/Tinker 0.1.615-arm64/Tinker.app`，包内记录为 main `d94a3f06ee9ea0bba2d017248a4e948e7a87dfad`。
- 两个常用 Applications 路径未发现 Tinker.app，不能把桌面 DMG 或挂载运行当作已完成安装。
- 沿用干净隔离工作区 `/tmp/tinker-chat-status-shimmer-20261109`，本地分支 `fix/config-placeholder-loading-contrast`，基线 main d94a3f0。
- 只改 Electron 配置表单、本地化与运行文字 CSS/tokens，未改真实凭据、数据、图片授权或 Rust。
- 原始用户截图由父任务查看，本任务未接收或保存含 Key 的原图。复现只用 fixture 假值。

## 诊断与改动

- 实际表单基线占位 rgb(115,115,115)、输入 rgb(10,10,10)，已有灰度差。裸 URL 示例、空值无说明以及先提示连接测试造成误解。
- Base URL 占位改为“例如：https://api.example.com”与“e.g. https://api.example.com”，始终不作为 value。
- 空值增加关联 aria-describedby 的说明，填写后仍显示真实端点预览。名称/Key 齐全而 URL 为空时，顶部先提示填写 URL。
- 其他配置项已有“例如”或输入动作提示，保留现有可读灰度，不批量调淡全局 Input 或禁用控件。
- 原流光窄带使用局部 foreground 的 .72→1 alpha，工作台覆盖前景色后，变化更弱。
- 新增双主题 running-text-base/sheen 语义 token，加宽扫光，背景尺寸 240%→200%，周期 2.6s→2.4s。浅色深字浅扫光，深色次级字亮扫光。
- Logo、文字几何位置、副文案、展开按钮、实际状态语义与 reduced-motion/forced-colors 回退保持。
- 独立复审发现浅灰承载面对比不足，已将浅色最亮端点从 45.1% 压至 42%，以保留可读性。

## 证据与结果

| 检查 | 结果 |
| --- | --- |
| 相关基线 | 6 pass，0 fail |
| 新回归红测 | en/zh 均因裸 URL 占位失败，符合缺失行为 |
| 新回归与相关绿测 | 8 pass，0 fail，74 assertions |
| 全仓最终 | 3459 pass，4 既有 skip，0 fail，3463 tests / 384 files |
| Typecheck | 6 workspace 退出 0 |
| Lint / Electron build | 均退出 0 |
| 独立复审 | 可读性边界已修正，无剩余阻塞 |
| 浏览器状态回归 | 62 项，errors=[]，覆盖双语、双主题、窄窗、启停、减少动态与强制颜色 |
| 表单与动态视觉 | 7 项，errors=[]，空值/填写/清空/按钮状态/预览与静态几何均通过 |
| FlowRow 与 muted 表面 | 4 项，浅色最小 4.75:1、深色最小 5.47:1 |

普通聊天表面的渐变端点红通道差由浅色 59.36→84、深色 55.72→97，五个时间采样的位置各不相同，文字范围不变。普通聊天表面端点最小对比分别为 5.19:1、5.82:1。上述是实际测试表面的计算结果，不是对所有用户显示器的视觉保证。

初次全仓测试受沙箱 localhost/子进程限制，15 个既有网络/运行时用例失败。未绕过测试，在正常授权权限下重跑全仓后全部通过。前次类型检查和 lint 同样通过，最终代码再次检查通过。

## 本机视觉证据与界限

- `/tmp/tinker-ux-contrast-qa-20261109/result.json`：62 项状态检查
- 同目录 `form-motion-result.json`、`capsule-result.json`：表单、运动、实际背景对比
- 同目录 `form-zh-light.png`、`form-en-dark.png`、`form-narrow.png` 与 `after-{light,dark}-{time}.png` 已实际查看
- 临时 ux-qa.html/tsx 已从渲染目录移除，夹具和合成截图只保留在 /tmp，没有进入生产提交或上传 Library
- 本次为本地代码验收，不代表现用 0.1.615 或 DMG 已更新。没有推送、合并、重新打包或安装。
- 未用真实账号、真实模型/付费生图，也未进行原生 Electron 手动交互或屏幕阅读器人工验收。
