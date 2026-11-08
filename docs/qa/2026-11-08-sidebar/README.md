# Figma 侧栏同步验收 · 2026-11-08

- 目标仓库：SimmonJ-WYJ/tinker（私有）
- 基线：main 2006607
- 分支：fix/figma-sidebar-115-599
- 来源：[会话画板 115:599](https://www.figma.com/design/qNZ4GSgKdkHK51a5x79VF8/Tinker?node-id=115-599)，侧栏 115:645
- 规范：[可编辑 Figma Guide 119:187](https://www.figma.com/design/qNZ4GSgKdkHK51a5x79VF8/Tinker?node-id=119-187) 与 [docs/design.md §10.4](../../design.md#104-侧栏的文字几何与交互figma-1155992026-11-08)
- 本次交付为分支源码，不代表已安装应用或 main 已更新。

## 实际运行环境

使用该分支构建的 main/preload 与本地 Vite renderer，运行 Electron 39。原生资料目录、Chromium 用户目录和项目/会话数据均为独立的临时 QA 数据，没有读取用户资料或发送模型请求。截图为实际 Electron 应用，不是静态 HTML 或组件拼图。SQL 原生模块按仓库脚本取得对应 Electron ABI。

## 测量

| 项目 | Figma 目标 | 实际 Electron |
| --- | --- | --- |
| 侧栏 | 256px | 256px |
| 导航起点 / 行高 | y=56 / 36px | y=56 / 36px |
| 项目行 | y=166 / 30px | y=166 / 30px |
| Recent 标题 / 第一行 | y=304 / y=328 | y=304 / y=328 |
| Recent 行 / 文字 | 30px / 14px，22px 行高 | 30px / 14px，22px 行高 |
| 图标盒 | 14px | 14px |
| 账号行 | 40px | 40px |
| 侧栏底色 | #ECEDEF | rgb(236,237,239) |

[完整 DOM 与交互结果](verification.json)

## 图像证据

- [Figma 左、实际 Electron 右的侧栏对照](sidebar-comparison.png)
- [实际 Electron · 浅色英文](electron-light-en.png)
- [实际 Electron · 深色英文](electron-dark-en.png)
- [实际 Electron · 深色中文](electron-dark-zh.png)
- [实际 Electron · 900px 窄窗抽屉](electron-narrow.png)

主内容只是实际应用的空会话状态，本次验收范围是侧栏。Figma 为自定义项目名称，QA 的第四项显示应用默认项目名称。macOS 窗口态保留原生红绿灯区域，所以顶部控制从 108px 安全起点排布，不覆盖系统按钮。文件夹仍是实际展开/收起按钮；未把稿件中空的文件夹占位转换为不可见的应用控件。

## 行为验收

- [x] 原始 Figma 画板保留，Guide 为新建可编辑图层
- [x] 所有本地 SVG 均非空、成功加载，固有尺寸保持
- [x] 返回图标外层镜像，前进禁用状态由真实历史决定
- [x] 暗色项目加号保留前景与底色差异
- [x] 英文 / 中文主导航可见，无 raw key
- [x] Recent 聚焦显露操作，Enter / Space 打开会话
- [x] 显式 Enter 可立即保存重命名，不被防误触 blur 的 300ms 保护吞掉
- [x] 长标题截断，不撑破侧栏
- [x] 真实搜索对话框可打开和关闭
- [x] 项目文件夹独立展开/收起
- [x] 侧栏收起/展开正常
- [x] 900px 与 560px 窄窗无横向溢出
- [x] 在非当前项目点加号只新增一条草稿，workspaceId 正确；成功后抽屉关闭

## 机器检查与复审

- 全库 typecheck 通过
- 新增键盘与项目加号行为测试通过，涵盖工作区参数、草稿集合、重复点击与输入框事件边界
- docs/design.md ↔ tokens.css 双向 parity 通过
- renderer 构建通过
- 独立审阅者复跑相关三个测试文件：7 通过、0 失败、36 次断言
- 独立复审通过，无剩余实质问题。最初的抽屉疑问经 AppShell 的状态变化 effect 与实际运行结果排除
- 整库 bun test：3285 通过、4 跳过、0 失败，覆盖 370 个文件。使用允许本地 loopback 监听的环境运行服务器测试。键盘测试通过 React async act 刷新异步更新，不依赖定时轮询。

## 范围

没有改动模型、渠道、登录、权限、数据契约、Logo 或蓝球动效；没有合并 main 或发布安装包。原 MD Guide 同步在用户指定的 diagnostics 路径，仓库内规范随本分支保存。
