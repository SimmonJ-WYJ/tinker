# 聊天输入框排版修复验收

基线：main `3787f343c19985a85367592b69f6f5b0f07d6645`。本地分支 `fix/composer-placeholder-alignment`。本报告只证明本轮代码与本机验收，不代表新安装包已发布或用户应用已更新。

## 原因与改动

用户截图已通过 Library 在本机成功保存并查看。RichTextInput 轮播提示的固定 left/top、字号和行高没有随聊天页样式更新，编辑器实际使用零内边距与 16px 字号，提示仍保留 15px/9px 偏移和另一套排版。

- 新增 `rich-text-input-layout.css` 集中默认 padding、字号与行高变量，编辑器和轮播提示共同使用。
- `workspace-home.css`、`conversation-flow.css` 改为按场景设置同一组变量，编辑器的最小高度保持原值。
- 聊天输入文字由 16px 调为 14px，行高 22px。首页及独立输入仍为 15px/24px。
- 轮播后缀使用 block 行框，避免 inline-block 的额外基线。固定前缀不参与动画。
- 未更改外框、颜色、工具栏、输入/IME 事件、发送/停止回调或数据模型，没有 IPC、Rust 或新依赖改动。

## 实际浏览器红绿回归

独立、空白浏览器使用真实 RichTextInput、AttachmentPreviewItem 和正式 CSS，所有输入及附件均为合成数据，没有调用 Agent。

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| 提示相对真实文字 Range 的 X 差 | 15 CSS px | 0 CSS px |
| Y 差 | 9 CSS px | 0 CSS px |
| 提示与编辑文本字号 | 14px / 16px | 14px / 14px |
| 提示与编辑文本行高 | 21px / 22px | 22px / 22px |
| 坐标断言 | 预期失败 | 通过 |

25 项浏览器场景全部通过，无 pageerror。覆盖英文与中文、1440/390 宽度、CSS zoom 80%/100%/125%、空白聚焦和失焦、输入后清空、单行与多行、合成附件、多行内部滚动后清空、合成 IME 及发送防护、生成中静态提示/停止按钮布局、首页、独立输入、轮播前缀稳定性和深浅主题。各对齐断言误差均为 0px。

## 自动检查与复审

| 检查 | 结果 |
| --- | --- |
| 相关输入意图、粘贴分类/往返 | 15 pass、0 fail、22 assertions |
| 全仓 Bun | 3443 pass、4 既有 skip、0 fail、9107 assertions |
| Typecheck | 6 workspace 全部退出 0 |
| Lint | 退出 0 |
| Electron build | 退出 0，正常登录且保留 Candidate 配置隔离 |
| 独立只读复审 | CSS 覆盖、所有 RichTextInput 调用和行为差异无阻塞 |
| 简化检查 | 基础排版收口、场景只覆盖变量，无额外抽象 |
| 差异检查 | 通过 |

4 项 skip 为既有包内 rg 二进制集成测试，未增加跳过或隐藏失败。初次本机夹具从错误目录启动而未加载 Tailwind，修正启动目录后才记录坐标红测，不把加载失败作为产品回归证据。

## 本机证据与限制

运行日志、可复现夹具和合成截图保留在本机 `/tmp/tinker-composer-qa-20261109/`：`before.json`、`after.json`、`matrix-result.json`、`composer-light.png`、`composer-dark.png`、`composer-narrow.png`。已实际查看截图，文字起点统一，无窄窗裁切。临时 HTML/TSX 入口已从源码树移除，不进入正式构建或本次提交，截图没有上传 Library。

IME 验收为 Chromium CDP composition 与 DOM 事件，不包含 macOS/Windows 真实输入法候选窗。缩放为浏览器 CSS zoom，不是 Electron 菜单缩放验收。发送和停止使用合成回调，只证明 UI 输入及状态布局，没有触发真实模型或生成请求。本轮未运行生产账号端到端、未读取真实会话、未打包、未替换当前安装包或应用，也未自动合并。

GitHub UI 审阅使用 `docs/reports/assets/2026-11-09-composer-{light,dark,narrow}.png` 三张合成截图。仅包含输入组件和模拟内容，没有用户原始聊天或截图，未上传 Library。

实现提交及 GitHub 状态以交付消息为准。本次不修改 README/CLAUDE 或用户手工设计。
