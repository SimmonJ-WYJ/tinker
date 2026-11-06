# 自定义中转站与 Google 登录

用户已批准方案。目标是本地桌面版可配置第三方中转站，并直接通过 Google 登录，移除 OPENSCI 登录入口。

## 模型渠道
增加 custom-anthropic、custom-openai 两类自定义渠道，分别对应 Anthropic Messages 与 OpenAI Chat Completions。复用名称、加密 API Key、Base URL、手填模型、模型拉取与连接测试。用户必须能看到实际协议与请求地址；自定义渠道不因 sk-ant 前缀自动切回官方站点。连接测试必须检查所填模型请求成功，不能把任意 HTTP 响应当成功。

Agent SDK 仍使用 Anthropic 协议。OpenAI 渠道通过仅监听 127.0.0.1、随机凭据保护的本地桥接服务转换文本、图片、工具调用及结果、流式输出；不支持的内容明确报错。桥接只向该渠道配置的 URL 转发，禁止浏览器跨域访问，不记录凭据。

## 登录
系统浏览器 + Authorization Code + PKCE，Google 固定端点、随机 loopback 端口、state 校验、超时取消，主进程持有 token。复用 safeStorage（macOS 钥匙串保护的文件加密），用户 profile 单独缓存。缺少配置时显示可操作的配置说明，不进行模拟登录。Google token 绝不转发给 OPENSCI 服务。旧 OPENSCI 会话不恢复为 Google 会话。退出只清本地登录态；断开账户撤销应用授权而非删除 Google 账户，界面明确说明。本地研究库保持。

配置使用本地文件或构建时默认配置；不提交真实凭据。提供 Google Cloud Desktop OAuth 创建与测试用户配置指南。真实浏览器授权需要用户创建的有效 OAuth 配置，未具备前不声称端到端登录通过。

## 验证
测试先行：协议 URL、模型获取、工具往返与流、桥接鉴权、授权 URL/PKCE/state、取消超时、refresh、旧账户隔离及 token 目的地。全库 typecheck、bun test、Electron build；用独立开发数据目录验证新界面。无需修改 README/CLAUDE。
