# 图像编辑静默失败修复

状态：实施中。用户已同意先修复收费后静默失败，再完善尺寸和费用提示。

设计：OpenAI兼容转换拒绝无正文和工具的响应，包括纯空白；桥接返回可识别且脱敏的错误，429保留状态、限流分类与受限的Retry-After。编排流结束必须有终态，空成功必须报错；用户中止、watchdog保持既有流程。不自动重放图片操作。错误沿用现有持久化、事件和恢复通路，中英文文案同步。

图片卡片读取实际自然尺寸，提示文字不能保证原尺寸；本地没有可信报价或账单，不显示伪造费用，以中转账单为准。单次生成审批时展示计费提示，不更改权限策略。

实施计划：
1. openai-compat、openai-bridge新增空正文、空流、429、脱敏测试；观察失败，再实现转换守门与错误分类。运行`bun test packages/core/src/providers/openai-compat.test.ts apps/electron/src/main/lib/openai-bridge.test.ts`。
2. agent-turn-outcome新增无result、空成功、文本、工具、replay、子任务、中止测试。先失败再接入编排收尾。agent-response-failure验证中英恢复文案。
3. GeneratedImage测试load事件显示实际尺寸及费用说明，中英文切换不漏键；不加载时不显示虚构尺寸。PermissionBanner验证仅生图审批展示计费提示。
4. 运行typecheck、全量bun test、electron:build；独立源码副本验证，不部署或覆盖正式包，提供补丁和验证日志。

约束：保留正式目录所有改动；Git查询阻塞时不写正式目录。在已验收源码副本修复。账单先前今日总额¥1.4717，含用户自测；本次先本地模拟，不产生真实计费。
