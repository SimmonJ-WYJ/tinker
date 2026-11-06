# 自定义模型中转站

在「设置 → 模型配置 → 添加配置」选择：

- **自定义中转站 · Anthropic**：中转站须支持 Anthropic Messages API（`/v1/messages`）。
- **自定义中转站 · OpenAI**：中转站须支持 OpenAI Chat Completions（`/v1/chat/completions`）。本版本不接 OpenAI Responses API。

填写名称、Base URL、API Key。Base URL 可填根地址、带版本路径的地址或完整 Messages / Chat Completions 地址；表单会预览实际请求地址。不要在 URL 中填写 Key、账号密码或查询参数。

先手动填写真实模型 ID 并启用，或点击「刷新」从 `/models` 拉取清单后启用模型；然后「测试连接」。测试会实际请求当前渠道所选模型（极少量 token，可能产生供应商用量）。中转站没有 `/models` 不影响手动添加模型。请求失败会保留模型输入供修改重试；创建必须通过连接测试，编辑配置在测试成功后自动保存。已有官方供应商配置继续可用。

OpenAI 渠道的 Agent 请求在本机转换协议，支持文本、图片、工具调用和工具结果、流式文本。工具参数完整后交给 Agent 执行。PDF document 内容块与供应商专有服务端工具不支持直接透传；PDF 能力默认关闭，可用应用 PDF 解析工具提取文本。不要为 OpenAI 渠道打开 PDF document 能力。实际能力仍取决于上游模型是否支持图片与工具。

已知 OpenAI 推理模型（o1/o3/o4、GPT-5 系列）使用 `max_completion_tokens`，其他兼容模型使用 `max_tokens`。自定义别名无法从名字识别模型能力时，请使用供应商提供的标准模型 ID。Token 预算为近似估算，不用于计费。

API Key 使用 Electron safeStorage 加密存储。OpenAI 桥接只监听本机随机端口，以随机凭据保护；桥接不向浏览器开放，上游 Key 不传给 Agent SDK 子进程。中转站模型列表、连接探针与 OpenAI 转发禁止重定向，避免凭据被转发到意外地址。真实中转站连通性需使用自己的有效配置验证。
