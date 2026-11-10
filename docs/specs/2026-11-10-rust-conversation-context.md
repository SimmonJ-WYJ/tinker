# Rust Lab：持久化父执行链与真实 HTTP 多轮上下文

状态：核心实现及本机自动验证完成，2026-11-10。基线 main `4ca339592668581c1dc36abc9097fc9bf0aa1650`，隔离分支 `feat/rust-conversation-context-audit`。按用户继续下一阶段迁移要求实施，正式 UI、功能和数据不变，只使用合成回环服务，不读取真实凭据或调用线上模型。采用同一 RunStore 锁与 context-v2 子目录，降级混写的排序限制见下文。精确 Started/fsync 故障注入与专用多轮 panic 等未测项见阶段报告，不把设计验收清单全部写成已实测。

## 推荐的一个完整批次

增加一个真实 Tauri 命令 `continue_lab_run(requestId, parentRunId, input, scenario)`，复用现有 `RunController`、`RunStore` 和 `ChatHttpProvider`，将一个已成功完成的执行作为不可变父节点。控制器从父链 JSONL 重建经过验证的 `user/assistant` 消息，追加当前 user，传入现有 HTTP/SSE 生命周期；结果仍由既有 JSONL、分页 read、cancel 和重启恢复管理。默认桌面仍是离线 fixture，HTTP 只通过可信宿主注入，自动化验收只用合成数据及 numeric loopback。

首轮仍使用原 `start_lab_run`；继续和分支必须显式指定 parentRunId，绝不使用“当前/latest run”推断上下文。现有三个命令的参数、公开 RunSnapshot/RunRecord/RunEventPage 形状、旧 v1 日志内容与读写路径均保留。此次新增 command 在真实 `main.rs` generate_handler 注册，通过真实 InvokeRequest + MockRuntime + loopback HTTP 串通；不制作只被单测调用的旁路库，也不改造实验 UI，更不接生产 Electron。

推荐布局经父任务补充约束修正：旧 v1 仍在 runs-v1/<id>.jsonl；新 continuation放 runs-v1/context-v2/<id>.jsonl，使用同一个 RunStore与根 writer.lock。旧 reader仅扫描根直接 *.jsonl，所以旧日志继续可用，新continuation在降级版本暂不可见，不删除数据。新版在两个layout中统一ID查找/去重/createdOrder分配；不引入第二会话库或第二controller。

## 已核验的代码事实

- `run_commands.rs`：可信宿主 `RunHostState::with_chat_http` 已接 HTTP；renderer 只能选 requestId/input/scenario。`main.rs` 默认 `RunHostState::new` 离线。
- `run_controller.rs`：单活动执行；worker 锁串行化 start；inner 锁保护 store/current；创建 header 和 Started 成功持久化后才 spawn provider。runId=requestId，重复请求比较 input/scenario。drop 取消并 join；open 把未终态写成 interrupted，不重放 provider。
- `run_store.rs`：唯一事实源 `runs-v1/<id>.jsonl`；`<id>.json` 只是可丢弃缓存。私有 RunHeader 与公开 DTO 都 deny_unknown_fields；header 和事件现用 protocolVersion=1。header 限512KiB，日志4MiB；目录单 writer 文件锁。直接 symlink/hardlink、损坏中段和未来版本被拒绝；截断尾部 recoveryRequired。
- `chat_http.rs`：`RunProvider::execute(&str, ...)` 当前固定构造一个 user message；HTTP 防重试/代理/重定向、超时、取消、SSE 解析、输出预算和 key 反射拦截已经独立验证，不应重新实现。
- `tests/run_invoke.rs` 已有真实 handler、HTTP 进程退出/重启、取消/去重、敏感信息不落 JSONL 证据；`tests/support/http.rs` 请求读取目前上限16KiB，新增大上下文测试需独立有界 helper 或参数化上限，不能无界读取。

## 三种设计及结论

| 方案 | 好处 | 代价/问题 | 结论 |
|---|---|---|---|
| 同一 RunStore/原 writer.lock 管理根目录旧 v1 与 context-v2 子目录的新 v2 私有 header，持久化 parentRunId/parentSequence/contextPolicyVersion，正文来自已有记录 | 同一事实源及锁，一次 header 创建包含完整启动意图；复用现有崩溃恢复/去重；旧 reader忽略子目录且仍可打开旧日志；无需复制历史正文或新库 | 要将 header版本、layout定位与事件/IPC版本分开；旧二进制看不到新continuation；跨版本混写须明确ID碰撞和order平局行为 | **推荐**，最小且有完整不变量的一批 |
| v1 header 完全不变，加 `<id>.context.json` sidecar | 旧程序通常忽略 sidecar、能读 JSONL；父正文可从现有记录重建 | 两文件无原子事务；必须处理 context-only / log-only / fsync 不确定。更根本：sidecar 缺失后 context run 与真正旧 standalone run 不可区分，静默失去祖先上下文。若不复制 input，孤立 intent 还不能完整确定同 requestId 请求 | 不推荐以“零 schema 变更且完全安全”为名实施 |
| 新 conversation store/manifest 存完整消息快照，独立管理 run 引用或复制历史 | 上下文快照自足、容易展示会话 | 两套去重/锁/恢复/额度/生命周期；跨库事务和复制数据；超出一批最小接线 | 后续完整会话/迁移阶段再考虑 |

sidecar 可以设计成严格 fail-closed，但前提是有不会被缺失 sidecar 抹掉的 durable discriminator：例如改变 header、增加旧 reader 不认识的记录，或保留新的 runId 命名空间并让所有旧/新写者共同拒绝该空间。前两项仍改变 schema；第三项改变旧 ID 接受语义、要解决既有碰撞及降级旧写者。不能靠“先写 sidecar，再写 JSONL”本身证明安全；它只解决一个提交窗口，不能证明缺失 metadata 的检测。禁止把 lineage 塞入 input、scenario、createdOrder 的隐式编码。

## 语义与精确数据形状

新增 `run_context.rs`：

- `ParentRunRef { run_id: String, sequence: u64 }`，serde camelCase + deny_unknown_fields。
- `RunLineage`：内部 `Standalone` 或 `Continuation { parent: ParentRunRef, policy_version: u32 }`；StoredRun 增加 lineage 与 created_order 两个内部字段，不加入公开 RunSnapshot。
- `ChatRole { User, Assistant }`，wire 小写，仅序列化这两个角色。
- `ChatMessage { role: ChatRole, content: String }`。
- `RunContext { messages: Vec<ChatMessage> }`：私有字段及受控构造/只读访问；单条根请求 `[user(input)]`；延续为 `[ancestor user, ancestor assistant, ..., parent user, parent assistant, current user]`。不接受 renderer 提供 messages/role/system prompt。
- 固定 `CONTEXT_POLICY_VERSION=1`，`MAX_CONTEXT_ANCESTORS=16`，`MAX_CONTEXT_BYTES=512*1024`（所有 content 的 UTF-8 字节总和，含当前 input），`MAX_HTTP_REQUEST_BYTES=4*1024*1024`（序列化完整 JSON 请求字节数）。这些是实验策略，不是 tokenizer/model token limit，不宣称适合任意模型。最坏 JSON 控制字符六倍膨胀也在请求上限内；序列化后仍显式检查。

本批**不做自动裁剪/摘要**。整个父链超过16个已完成轮次或512KiB就返回 `contextLimitExceeded`，不创建新日志、不发网络、不改变父节点；不能保留 assistant 而丢 user、切 UTF-8、静默跳过旧祖先。精确达界允许，多1字节/多1祖先拒绝。当前 input 的65536字节原边界保持。该有限但明确策略使一批可验证，不需持久化裁剪算法或 token 计费估算。后续可定义 policyVersion2 的完整轮次后缀裁剪，而非修改既有 policy1 语义。

`RunError` 增加固定码 `ContextParentNotCompleted`→`contextParentNotCompleted`、`ContextLimitExceeded`→`contextLimitExceeded`、`ContextUnsupported`→`contextUnsupported`。缺父节点复用 `runNotFound`；非法 ID 复用原映射 `runInvalidOptions`；corrupt/future/symlink/io 原码不包含路径或内容。

继续命令 parent 必填。parent==requestId 拒绝 `requestConflict`（未存在时也禁止自环）；加载父记录必须 Completed、!recoveryRequired、终态 sequence 正确。Running/Queued、Failed、Cancelled、Interrupted 一律拒绝作为父，不只是丢弃它们的 assistant。未成功的 user 也不进入新请求。要在失败/取消后重试，客户端创建新 requestId，指向原先成功的父；原失败 run 和部分输出照常可读。同 requestId 是查询/去重，绝不表示重试。

两个不同 requestId 可先后指向同一父形成分支。继承只沿显式父链，绝不混入兄弟、latest run、相同 input 的其他 run。父节点 completed 后现有生命周期禁止追加，已存 parentSequence 是明确终态锚；装载时核验 sequence 精确相等与 createdOrder 严格递减，再加 visited ID 检测循环。无新增 hash 依赖；不宣称防御同用户恶意原地改写内容但保持 sequence 的攻击，此边界与现有 store 的 symlink 检查一致。

## 持久化与原子性

保留现有 `RunHeaderV1` 原字段与序列化值。新增严格 `RunHeaderV2`，共同字段相同但 header `protocolVersion=2`，并有 required `parent: ParentRunRef`、required `contextPolicyVersion=1`。本批 v2 只用于 continuation；root 均 v1。事件依然 protocolVersion=1，公开 snapshot/page 依然1。禁止把全局 PROTOCOL_VERSION 改为2导致旧事件/DTO改变。

把 `check_version` 拆为 header dispatch（只接受1/2）和原事件检查（只接受1）。`entries` 与 `load` 在各自layout使用同一 header decoder，避免目录扫描接受而 load 拒绝的分叉；`snapshot_from_header` 使用归一化私有 header，而不是传播存储版本到 IPC。v2 缺 parent/坏父引用/未知字段为 corruptLog；未来 header版本或 contextPolicyVersion 为 unsupportedVersion。旧 v1 的 lineage=Standalone。

`RunStore::create_continuation(id,input,scenario,parent_ref)` 与原 create 共用 header写入、createdOrder、预算、路径检查；不能另建 writer lock 或第二存储引擎。

**精确布局实现：** RunStore继续在 `parent/runs-v1/writer.lock` 取得唯一锁（旧程序也锁它），增加 `context_root = root.join("context-v2")`。新版目录扫描只检查根v1和该固定子目录v2；禁止递归遍历其他内容。context_root经ensure_dir/canonicalize及直接symlink检查。v1 path只能header1，context-v2 path只能header2，错layout为corruptLog。`find_location(id)`对两处safe_file，均存在为corruptLog，均无为runNotFound；不能任选一个。StoredRun持有内部layout字段，append/cache_snapshot始终在自身layout目录，cache名字仍<id>.json；目录fsync针对实际父目录。两个layout同ID时open及查重均fail-closed，不覆盖或自动修复。新写者分配两个layout最大createdOrder+1，原start仍落根v1，新continue落context-v2。

**降级混写边界：** 旧程序忽略context-v2，仍能读写根v1，但它无法承诺对不可见continuation ID去重。若旧版复用了隐藏ID，重新升级时明确corruptLog，不删除任何一份。旧版写新v1还可能与隐藏v2出现相同createdOrder。因此新版保留各layout内部order唯一校验，跨layout同order允许，按 `(createdOrder, layoutRank)` 排序（v1=0，v2=1）；这是确定性的读取顺序，不能称降级混写场景严格实际启动时间。新版正常运行下全局order仍严格递增。父链新写入时必然 parent.createdOrder < child.createdOrder；v2校验保持该约束。避免为了隐藏平局而扫描mtime、改写旧header或新建global manifest。测试要显式覆盖旧版样式写入后的平局与两个layout重ID。该限定不影响新版本内的多轮上下文/重启去重，且满足旧日志降级仍可用。实际开始顺序：

1. 验证 ID/input/scenario；获取已有 worker/inner 锁。
2. **先查 requestId 并判去重/冲突**。旧 start 与已存在 continuation 冲突，即使 input/scenario 相同；continue 与已存在 standalone 冲突。继续请求比较 input、scenario、parentRunId；parentSequence 是第一次创建时宿主冻结的值，重发不重新解析父来改变意图。
3. 已存在且匹配：返回该 run 当前/持久化 snapshot，不重新调用 provider；包括 completed/failed/cancelled/interrupted，重启后同样如此。即使宿主换了 provider/model也不重新执行；provider身份不在本批请求身份中，沿用旧行为。
4. 不存在：确认未 blocked、无活动 run。join 旧 worker 后在既有锁下从**磁盘事实源**验证并重建父链，不用可能标记 storage failure 的 current 缓存；校验累计预算，形成不可变 RunContext。
5. 在单个 v2 header 中持久化 input/scenario/parent/policy/createdOrder；write_all + sync_all + 目录sync，沿用原 create_new 不覆盖语义。然后 Started append + sync_data。
6. 只有以上成功才 spawn provider；worker 捕获本次冻结的 RunContext，发送过程不再查询 latest/磁盘祖先。

不是声称 header 写入在任意断电下天然 atomic：沿用当前单文件可检测不完整写入语义。完整 header-only 崩溃恢复为 Interrupted；Started之后崩溃恢复为 Interrupted；部分/坏 header fail-closed；任何 io/fsync 不确定在该控制器设 blocked，不自动重试 provider。重要保证是 lineage 与 input 在**同一事实记录**中，没出现“确认启动但 parent intent 尚未持久化”的跨文件窗口。已恢复 interrupted 的同 requestId只返回既有状态，不能重发付费副作用。

父历史缺失/损坏/未来版本/路径异常时，不把该节点当root或空上下文。`open` 应先验证所有日志（原本逐个恢复可能在后续损坏被发现前写了前项），对于本批 lineage 至少确保 v2 静态字段/父引用图有效再允许执行新请求；可用两遍校验+恢复，不引入索引库。非终态 v2 自身可正常恢复 interrupted；它的父必须原本成功。链验证使用有界逐项 load，最多17个祖先检查，逐项释放 events，不一次保留每个4MiB事件集合；超深本身返回 contextLimitExceeded。启动全库扫描现有无全局 run数预算的局限不借此宣称已解决。

## Provider 和 HTTP 接入

最小兼容扩展：保留 `RunProvider::execute(&str,...)`，新增对象安全 `execute_context(&RunContext, token, emit)` 默认实现。默认只接受单一 user 然后委托 execute；多条返回 ContextUnsupported，禁止默认取最后一个 user 静默丢历史。控制器执行统一走 execute_context；旧 provider 注入测试无需批量改签名。

`ChatHttpProvider` override execute_context，旧 execute 用单条构造复用同一路 stream。stream 将已验证 messages 序列化为 model/messages/stream:true，检查完整请求字节预算再发起 request，保留所有现有网络安全/SSE/取消/SecretGuard/分片逻辑。不能把 role/content 用字符串拼接成一条 user 来模拟多轮。

`OfflineFixture` 不新增多轮支持，沿用 trait 默认安全拒绝。默认离线宿主的 continue 持久化失败 `contextUnsupported`，绝不以固定输出伪装理解了历史。真正上下文能力由可信 HTTP 宿主和支持 context 的测试 provider 验证。仅实现旧 execute 的 provider 对多轮明确拒绝，不能隐式丢弃历史。

在新 `continue_lab_run` handler 重用原 scenario解析、空输入判断、可信provider选择、spawn_blocking与固定码映射；共享小 helper 可减少重复，但不重构三个旧命令行为。`main.rs` 只增加 handler 注册。现有 read/cancel 对 v2 同样返回严格旧 DTO。暂不新增历史编辑、会话列表、自动选择父或新 UI；如需展示 lineage，后续加单独查询 DTO，不能把新字段混入旧严格 RunSnapshot。

## 明确文件边界和实施顺序

1. tracked spec：由主任务写 `docs/specs/2026-11-10-rust-conversation-context.md`，说明 schema兼容和默认离线边界；遵守仓库 specs 位置，不修改 README/CLAUDE。
2. `src/run_context.rs`：types、形状与字节预算验证；`lib.rs` 导出；`run_types.rs` 仅新增错误码。
3. `src/run_store.rs`：v1/v2 header解析归一化、StoredRun内部lineage/order、create_continuation、父链读取；如体积增长明显将 header codec/上下文组装拆同级模块，由同一 RunStore调用，禁止复制存储实现。
4. `src/run_controller.rs`：旧 start委托共同内部start，新增 continue_with_provider，mode+parent去重，创建前冻结 context；取消/finish逻辑原样复用。
5. `src/run_provider.rs`、`src/chat_http.rs`：context trait默认安全拒绝、fixture明确override、HTTP messages及出站字节预算。
6. `src/run_commands.rs`、`src/main.rs`：新真实 handler注册。前端源码/契约/样式、生产源码和依赖不变。
7. `src/run_context_tests.rs`（模块单测）、`src/run_store_tests.rs`、`src/run_provider_tests.rs`：边界/持久化/生命周期。新 `tests/context_invoke.rs` 做真实IPC+HTTP，两轮/三轮/分支/重启。尽量不要继续把已有650行 run_invoke塞大；可从 support抽现有fixture/Invoke helper，保持改动聚焦。
8. 状态报告记录真实执行检查、源码范围、仍未完成项目和回退约束。正常项目全套验证由主任务执行；本设计任务不运行。

## 必须通过的验收（行为先行）

### 真实竖切面

- 旧 start首轮 A，loopback server收到精确 `[user:u1]`，返回分片Unicode `a1`；continue B(parent=A) 收到精确 `[user:u1, assistant:a1, user:u2]`，完成输出进入原分页JSONL。不是仅capture trait测试。
- 销毁/重开同fixture根与可信HTTP host后继续 C(parent=B)，body精确5条、顺序/UTF8完全相同；读A/B/C old DTO通过原严格解码，cancel已终态幂等。
- A另分支D；D只有A+新user，不含B/C。随后以B继续不受D是latest影响。
- active时并发重复B两次只产生一个HTTP socket；相同requestId/input/scenario/parent重启重发也0新socket。更改input、scenario或parent分别requestConflict；旧start冒用continuation ID、continue冒用legacy ID均冲突，原日志字节不变。

### 故障与恢复

- B流出部分后cancel，晚到片段/finish不变更终态；B部分输出可读但不能作为父。新C指向A并重发相同user可以执行，body排除B user及partial。failed/timeout/transport failure各至少一个同样验证，panicked使用已有capture/provider路径。
- 子进程在B Started且部分delta后非正常退出；重启B interrupted，不调用provider；重复B返回interrupted；C从A继续，历史不包含B。header-only v2同样恢复，parent仍保留。
- 存储故障在创建header/Started及delta阶段：没有持久化确认前没有socket；后续失败保留已确认partial，recoveryRequired/block状态沿用；不自动重试。父加载失败发生在任何新子日志写入前。
- 合成日志未来header3、contextPolicyVersion99、缺parent、坏parent ID/self/cycle、非递减order、父sequence错、父缺失、父Cancelled、Completed但截断尾/recoveryRequired都fail-closed；无更改原件/无HTTP。完整中段损坏不跳过。symlink/hardlink只用隔离fixture，检查外部目标原字节未变。
- 新版统一两个layout查重；旧版样式的仅根目录扫描忽略context-v2并可读取v1；模拟降级v1写入的跨layout order平局按规定排序；两个layout同ID即corruptLog且双方字节不变。
- 所有既有v1 fixtures仍可open/read/start/cancel；旧header原字段集合不变，事件协议1不变；新v2不会被当作事件协议2发给前端。副缓存损坏依然可重建；本批不引入缓存为事实源。

### 有界性与安全

- ancestors16可接受、17拒绝；512KiB content总量精确达界可接受，+1拒绝；当前input65536边界旧测试保持。历史预算含当前user及完整assistant，UTF8按字节而非字符。
- 控制字符、引号、中文导致JSON转义膨胀时完整请求预算有效，服务器helper自身也有明确上限；role数组正确而不是字符串prompt。预算拒绝在HTTP之前且新子日志不创建（完整出站序列化预算若只在HTTP层检查，会已有failed子run；推荐context预算在控制器保证最坏情况，HTTP层做防御性上限检查并写明两层差别）。
- 以第二轮消息为输入的key反射仍被旧SecretGuard阻止，整个fixture JSONL不出现伪key；HTTP错误body/URL/header不出现在固定错误或日志中。不会保存HTTP请求正文副本。
- 不支持context的旧自定义provider显式contextUnsupported失败，绝不执行最后user掩盖丢历史。root旧execute注入测试保持。

本批自动化完成标准：真实Tauri handler注册与loopback两轮/重启/分支全部通过；原Rust/TS回归、fmt/clippy、既有构建门槛均按根任务流程通过；生产目录/依赖/前端零差异。MockRuntime并非原生WebView验收，loopback并非外部TLS/真实模型/账户/费用验收，不作这些声称。

## 回退与明确不做的内容

不读写 Electron/.asci/另一路QA数据、不引入真实凭据/外部网络/模型调用、不自动迁移/清理数据、不加依赖、不改变生产入口、无工具/图片/项目/权限/完整会话UI。基于祖先run的文本continuation是下一可测执行能力，不是完整产品替换。

功能回退可以撤掉新增command/调用入口；整批revert到旧binary时，它只扫描根v1、仍能打开旧日志，context-v2保持原位但不可见。再次使用新版即可读回。降级混写发生ID碰撞时新版fail-closed，不擅自删除/迁移任何一份；跨layout order平局按上述确定性排序。生产Electron原本未改，继续使用无需动这些Lab数据。

本批选择固定子目录兼容，不需要专用context宿主或额外read/cancel API；同一个RunHostState中的原read/cancel可访问两个layout，真实main接线保持清晰。若实现时间受限，削减可选fixture展示/查询API，不能删去持久parent绑定、请求冲突、实际HTTP body断言或重启测试。

## 自审结论

推荐方案无需并行会话库：同一RunStore/锁下新增固定context-v2 layout与私有header2。明确parent选择、失败排除、分支、重复请求、预算失败与崩溃恢复；跨线程冻结context，跨重启按持久父链重建。旧binary依然读根v1，新continuation暂不可见；降级混写的ID碰撞/排序限制已明确。其他未覆盖的全产品能力不扩入本批。

## 实施计划与检查点

本规格为一个完整纵向实现任务，由同一实施者处理 Rust 文件，审计任务只新增独立报告，不并行编辑源码。

- [x] 在 `tests/context_invoke.rs` 写真实 handler 多轮 HTTP 行为红测并确认失败，再实现新命令。
- [x] 实现 `run_context.rs`，扩展同一 RunStore 的严格私有 header、布局与父链校验，保留原 v1 序列化。
- [x] 将 controller、typed provider、HTTP messages 及 Tauri 注册连成真实链路，不增加生产入口或依赖。
- [x] 覆盖主要边界、分支、重复、取消、失败、重启、损坏、路径、实际权限/delta 存储故障和兼容形状，未注入窗口单独披露。
- [x] 运行 `cargo fmt --check`、`cargo test --offline --locked`、`cargo clippy --offline --locked --all-targets -- -D warnings` 与原生 binary build，统一使用 `apps/tinker-rust/src-tauri/Cargo.toml`。
- [x] 全仓 `bun run typecheck`、`bun run lint`、`bun test`、Rust Lab Vite 与 Electron build，隔离测试配置及合成数据。
- [x] 独立规格/质量审查和 simplify，修复确认的重要问题，重跑受影响检查。
- [ ] 最终报告区分本机模拟、原生 UI 与线上未验范围，核验生产源码零差异及用户改动保护。
- [ ] 按既有授权正常钩子提交和推送安全分支，只开 Draft PR，核验 SHA/CI 后收尾，不合并、安装或部署。
