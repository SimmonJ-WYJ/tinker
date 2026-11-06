# Coding Smart Approval
状态：实现中；关联 issue/PR：未创建。

## 行为
- Coding + acceptEdits 使用 SDK 的操作系统隔离，项目内 Bash 自动运行。
- failIfUnavailable 开启，禁止无限制命令回退；命令禁止外网及本地绑定。
- 项目普通文件可写，保护 .git/.agents/.codex/.aws，拒绝读取本机渠道凭据和 SSH/AWS 凭据。
- HTML 验证工具支持有界 fill / press / click 顺序，保留隔离 iframe 和网络限制。
- 不扩展 Full auto，不按 Python/Node 字符串无条件放行。

## 验收
- 真实 SDK + 本地模型夹具：项目文件写入成功、项目外写入失败、人工审批零次。
- 真实 Chromium：输入、Enter 添加、勾选、删除成功，捕获脚本异常，拒绝项目外文件。
- 类型检查、全量测试、主进程构建。
- 上游真实模型回复与桌面显示单独验证，不将模拟模型作为上游可用性证明。
