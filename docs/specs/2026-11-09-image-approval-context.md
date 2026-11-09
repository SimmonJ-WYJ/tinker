# 自然图片编辑与批准后续作修复

状态：实现与本地验证完成，已无冲突整合 main `915d3ae`，重新验证后交付 Draft PR。分支 `fix/image-edit-approval-context`。

## 目标与边界

“你看看加入这个女生 三个人一起”在宿主已验证选图/上传时应识别为本回合图片编辑。显式批准合法图片调用后，任务语义可用于下一轮明确的“再次生成”，但批准参数、额外文件、数量和调用身份不可继承。缺少上下文、讨论/分析/询问、否定、代码/数据库/群聊等非视觉动作仍保守询问；跨会话引用和取消后调用仍拒绝。

只改 Electron 图片宿主与 shared 授权。保留敏感工具审批、计划模式和执行守卫。本轮相对 main 不修改 Rust、README/CLAUDE、用户真实 JSONL 或运行的安装包。交付仅推送修复分支并创建 Draft PR，不合并 main、不开 auto-merge、不发布、不打包、不付费生图。磁盘保留 4 GiB 停止线。

## 已复核根因

1. `requestsImage` 将视觉编辑写成单个固定语序正则，并且请求前缀不包含“你看看”。有有效选图/上传也会误判动作在前、宾语在后的表达；不能为整句增加特例。
2. `ImageRequestAuthorization.isImageTask()` 始终返回构造时的 automatic。手动 approve 只更改精确参数集合，后续工厂仍保留 false；侧车只在消费时写一次 false，重启后同样无法恢复。

## 实现计划（本线程串行执行）

### 1. 自然编辑边界

Files：`packages/shared/src/agent/image-request-authorization.ts` 及其测试；按需独立 `image-edit-intent.ts`。

- [x] 先为原句和同义的动作先行/把字句/代词/多人同框写红测，限定真实上下文。
- [x] 将视觉动作和视觉对象组合识别，去除礼貌引导词；讨论/否定/非视觉目的地先阻断。保留附件/引文/代码去授权处理。
- [x] 回归局部画面约束、人数与输出张数、额外文件、选图身份、跨会话和取消。明确输出两张仍只放行两次，三个人不放行三张。

Run：`bun test packages/shared/src/agent/image-request-authorization.test.ts`。新增授权用例先失败为 ask，再观察通过，现有安全用例不得退化。

### 2. 批准语义、持久化及消费顺序

Files：shared 授权对象；`image-turn-journal.ts`、`image-turn-factory.ts` 及测试；真实 `image-approval-context.test.ts`、`image-generation-handler.fixture.ts`。

- [x] 先复现 approve 后 isImageTask false、live 续作 ask、重启恢复 ask。
- [x] 合法显式批准使本对象图片任务语义单向确立；取消后晚到批准不改变状态。
- [x] 宿主收到语义确立通知，只追加 `{kind:'image-task-confirmed',id}`，不保存参数、文件、提示词、次数或批准令牌。确认事件更新原消费记录，不重排消费顺序；未知 ID/损坏记录保守恢复。
- [x] 工厂只在创建实际新消费回合时读取上一个授权对象的任务语义，新对象重新计算限额和文件范围。
- [x] 验证正常/live/restart、已排队未消费、真实 now/next 消费、取消/晚到批准、确认旧回合不覆盖较新普通任务、损坏日志与写入失败。
- [x] 使用真实 PermissionService hook/canUseTool/ExecutionGuard 和假网络 handler 做闭环，确认不重复弹卡，同时额外文件/危险终端/计划模式仍被拦截。

Run：相关授权、factory/controller/journal、permission-flow、execution-guard、handler 测试。观察红测后再实现。

### 3. 验证与交付

- [x] 全仓 typecheck / Bun tests / lint，Electron build；不做 DMG，不争用 Cargo 缓存。
- [x] 独立只读复审并修正确认问题；复核数据/授权不扩大、Rust零差异、无真实用户资料。
- [x] `git diff --check`，正常版本/提交钩子，本地 Conventional Commit。记录根因、测试、SHA和未跑项目到 `docs/reports/2026-11-09-image-approval-validation.md`。

- [x] 合并最新 main，保留 Rust 主干变更，重新执行全量检查。
交付流程：推送已验证修复分支、创建 Draft PR、核对远端 head 与 CI 并回帖复审。远端状态以 PR 和交付消息为准。

## 设计判断

继承的是用户已明确确认的任务类别，不是许可。新 confirmation 事件属于宿主消费侧车，历史 user 文本或模型输出不能生成此事件。有效旧消费记录仍可读取；新增确认遇到旧读者时会保守失去续作上下文，不能扩大许可。旧版本丢失的批准事实不能回填或推测。本轮无需读取或修复用户已成功生成的真实会话。

## 升级恢复

旧 false 消费记录仅按实际消费顺序重算。当条有效选图或上传可提供视觉编辑证据；没有当条证据时移除现存引用集合，避免用后来才出现的文件推断旧编辑。未知普通输入在任意中间缺口均是继承屏障，用前缀计数检查；未知队列和尾部普通输入仍阻断恢复。旧记录不回写。

只留泛泛文本、false 记录且丢失批准事实的旧会话不能凭模型自述恢复；需要用户再明确一次图片请求或确认合法调用。额外文件、数量、失效来源仍按原边界确认或拒绝。复审发现的撤回、完整目的地、消费缺口和多人非视觉活动误判已补红测修复。
