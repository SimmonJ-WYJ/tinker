# Custom Models and Google Login Implementation Plan

**Goal:** 自定义中转站能实际服务模型与 Agent；直接 Google 登录替换 OPENSCI 入口。
**Architecture:** 复用 Channel 与认证编排，新增 OpenAI 协议纯转换及本地桥接；Google client 单独实现并注入现有 AuthService。
**Tech Stack:** Bun、Electron、TypeScript、React、Jotai、Node HTTP/crypto、既有 safeStorage。

## Global Constraints
- 不新增依赖，不写 any。UI 文案 en/zh 同步，语义颜色 token。
- 保留原渠道与本地研究数据；Google token 不流向 OPENSCI。
- Google 真实授权缺配置时必须显式提示；测试不得假装实际 Google 登录。

## Task 1: 自定义模型（主代理）
- [x] 先写 URL/模型协议/工具往返/流式测试，运行确认缺实现失败。
- [x] 扩 ProviderType、profile/adapter 注册表与默认能力，新增自定义 Anthropic/OpenAI。
- [x] 纯转换模块承接 Anthropic ↔ OpenAI Chat Completions，原生 HTTP bridge 仅绑定 loopback 并验证随机 token；Agent env 与 scoring 同源。
- [x] 表单增加协议明确的自定义选项、手填模型、Base URL、准确请求预览、严格测试结果。同步中英。
- [x] 定向测试后全库 typecheck。

## Task 2: Google 登录（独立实现）
- [x] 先写授权 URL、state/取消/缺配置、令牌刷新、会话目的地测试并确认失败。
- [x] 新建 Google client：官方固定端点、PKCE、随机 loopback、超时与取消、userinfo profile 验证、refresh 保留 refresh token、safeStorage。
- [x] AuthService 注入 Google client，生产入口只接 Google；旧 OPENSCI 会话不能恢复，Google token 不提供给 journal；退出/断开语义一致。
- [x] 登录页改 Google、配置缺失提示与中英翻译、账户断开语义、配置指南。
- [x] 定向测试与 typecheck，提交具体改动清单供集成审查。

## Task 3: 集成与交付
- [x] 审查两个实现的数据流和失败路径，修复发现的问题。
- [x] bun run typecheck、bun test、bun run electron:build，记录结果。
- [x] 独立开发目录启动检查登录页/模型表单；说明真实 Google 与真实中转站尚需用户配置验证。

## 验证记录
- 全库 typecheck 与 Electron build 成功。
- 最终全库回归（20s 限时）：2983 pass / 3 fail。其中两项浮层样式断言在未修改 HEAD 的独立 /tmp 副本重复失败，确认为基线问题；能力包注册测试在全库运行时 hook 超时，单独复跑该文件 3 pass / 0 fail。全库测试尚未全绿。
- 协议、桥接、Google、模型表单定向回归成功；SDK 子进程到模拟中转站的真实 Bash 工具往返成功。
- 原生 UI 检查：Google 按钮与配置缺失提示；自定义 Anthropic/OpenAI 选项、手动模型、请求 URL 预览；en/zh 切换与表单截图无溢出。
- 未验证真实 Google 授权（尚无有效 Desktop OAuth 配置）及真实中转站（尚无用户测试凭据）。
- 改动保留于 codex/custom-models-google-login，未推送/合并，旧安装包未替换。

- 最后修正：Google 断开优先撤销 refresh token；独立回归通过。自定义渠道列表中英名称回归通过。最终 typecheck、Electron build、改动代码 ESLint 均成功。
