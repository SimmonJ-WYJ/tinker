# Rust HTTP Chat Completions流式适配

状态：限定范围实现与自动化验证完成，独立审查4项P2均已关闭，准备安全分支Draft交付。真实模型与原生窗口验收不包含在本轮。基线b61ee1a8b7a04053643eb8da63dc43afee738459。仅隔离Rust Lab路径，不改变生产Electron/UI或现有QA验收数据。

## 协议及接线

依据现有packages/core/src/providers/openai-adapter.ts和apps/electron/src/main/lib/openai-bridge.ts，选择OpenAI-compatible POST chat/completions，model/messages/stream=true，SSE choices[0].delta.content，finish_reason与[DONE]。官方协议 https://developers.openai.com/api/reference/resources/chat 。只支持文本，工具/多模态明确不支持，不伪装完整MVP。

可复用HTTP provider实现RunProvider，真实host可用可信Rust配置构造后注入；端点、密钥、模型不由未验证前端参数选择。默认app仍离线，外部命令/DTO/旧日志兼容。当前生产/QA窗口均不切换；用真实Tauri handler+本地HTTP/SSE受控服务器端到端证明，不只parser/trait。

## 边界和验收

所有执行测试只允许numeric loopback服务，使用伪凭据与合成消息，无外部模型请求。HTTP客户端禁代理/重定向/自动重试。数字IP不解析DNS；HTTPS域名必须由可信宿主提供显式地址pin，拒绝系统resolver后备，保持原域名TLS验证。pin解析/更新不在本轮，所有执行测试仍只回环。配置拒绝URL用户信息/查询/fragment，敏感字段不实现泄漏性Debug。错误只返回固定码，不存响应错误body、URL/headers、密钥或reqwest异常原文。受控HTTP/协议/超时错误保留已提交partial。

增量解析跨网络分片/UTF8/SSE边界，忽略合法注释/空行/usage尾块，正常结束须有协议完成标记，断流不得当成功。接受可空文本元数据，支持流首BOM和LF/CRLF/CR行结束；实际工具输出拒绝。界定正文/单帧/总输出/总时长/连接时长资源预算；取消必须打断等待headers/body的网络I/O，释放连接，无晚到输出、不重试收费副作用。超过预算停止。网络deadline不宣称能抢占同步存储或任意阻塞宿主逻辑。

先行为红测，覆盖正常、分片/UTF8、断流/坏JSON、401/429/5xx及body脱敏、重定向/代理限制、取消/晚到/重复、超时清理、partial保留、真实IPC与日志/重启。保留之前96Rust及前端回归。最终fmt/test/clippy、类型/lint、全仓Bun、Vite/Electron/原生编译及独立审查，正常hook提交安全分支和Draft，不合并/安装/部署。

新增依赖仅复用缓存reqwest0.13.2/tokio1.51，若确需Cargo声明/锁变更只限Rust Lab，生产bun.lock/依赖不动。缓存复用且不并行争用，空间<4GiB停止新构建，不清理用户文件。

原生UI验收由主对话另行协调，本轮不操作或写其模拟数据。不声称本地HTTP证明真实线上接入、全部原生/产品验收或内存收益。实际线上冒烟另需明确服务、模型、一次性凭据使用、合成请求和费用上限批准。

回滚revert本批提交；旧默认fixture和草稿/历史/事件数据保持，不反向迁移或删除数据。

当前证据与恢复步骤见 [状态报告](../reports/2026-11-09-rust-chat-http-status.md)。
