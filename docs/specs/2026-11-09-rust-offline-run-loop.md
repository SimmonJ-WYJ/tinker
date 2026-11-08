# Rust Lab 离线执行闭环实施规格

状态：隔离闭环已实现，自动检查通过，原生UI受锁屏阻挡，待Draft审阅。基线 main 94dad45fff5b2220b89d9d5bedce28df9a9590bf。仅 apps/tinker-rust、本文及验证报告允许变更，包版本遵循钩子。北京时间00:10开始，01:25收束实现，02:00停止新增实现及长构建。

## 目标和边界

沿用既有 Rust Lab，不创建第二套工程。实现默认实验会话的离线执行、片段输出、请求去重、取消、失败保留、JSONL事件及快照、重启恢复为interrupted。模型/工具/网络/密钥/真实会话/生产Electron/安装均不接入。旧submit_draft仍为modelNotMigrated，旧草稿schema和只读历史不改。UI明确显示离线测试，不称真实模型成功。

## 协议（camelCase JSON，protocolVersion=1）

- RunSnapshot：runId、requestId（相同受限ASCII ID，1..64）、providerKind='offlineFixture'、scenario（success/failure/slow）、input、output、status（既有RunStatus）、sequence（安全非负整数）、errorCode（string|null）、recoveryRequired（boolean）。
- RunRecord：protocolVersion、runId、sequence、kind（started/delta/completed/failed/cancelled/interrupted）、text（string|null）、errorCode（string|null）；持久化首条是独立元数据header（input/requestId/scenario，上限512KiB，计入总日志4MiB预算），它不属于公开RunRecord、不对外发。正常started从序号1开始；header-only崩溃恢复直接记录interrupted为序号1、不伪造已启动，以便独立恢复并兼容64KiB输入。
- RunEventPage：protocolVersion、snapshot、events、nextAfterSequence、hasMore。每页默认64，最多256项，游标不超过快照序号，未知协议/非法形状拒绝。
- start_lab_run(requestId,input,scenario)→RunSnapshot。scenario只允许success/failure/slow，客户端不能传地址/路径/模型。相同requestId和参数返回同一run，不重复执行；同ID不同参数冲突。input上限沿用65536 UTF-8字节。
- cancel_lab_run(runId)→RunSnapshot，重复取消幂等，终态不可被晚到片段改写。
- read_lab_run(runId?,afterSequence?,limit?)→RunEventPage，runId缺省读取最近run；不存在返回runNotFound。

前端通过现有invoke进行有界游标读取，运行中约100ms一轮、同一时刻仅一轮，终态及卸载停止。并非真实模型SSE。使用现有桥接，无新增JS依赖；失败保留输入和部分输出，旧run晚到响应用请求世代隔离。

## Rust核心

- run_provider.rs：可替换provider trait，OfflineFixture为唯一实现，不访问网络或shell。正常输出、片段后失败、可取消慢速场景，全部明确离线。
- run_store.rs：固定Rust Lab app_local_data_dir()/runs-v1，单写者锁、受限ID及符号链接检查，追加JSONL为事实源，快照可原子重建。独立于session-store-v1/history-v1，不塞进旧草稿记录。
- run_controller.rs：一个活动run，有限队列/输出内存，取消令牌，先落盘再确认事件；存储失败不伪装完成。启动恢复旧inflight为interrupted，不自动调用provider。runId绑定唯一requestId，重复点击及重启重复提交不生成第二个run。
- 事件单条上限16KiB、输出上限256KiB、事件最多4096、单run日志上限4MiB（任一到界停止）。分页最多256，不一次性向前端发送全部历史事件。

## 实施清单与文件所有权

- [x] Rust行为红测后实现provider/store/controller，复用session_lifecycle。新增上述模块、run_types.rs及独立测试，lib.rs仅模块导出。
- [x] Tauri真实handler接线与InvokeRequest回归：run_commands.rs、main.rs，不改变旧命令语义。
- [x] React严格解码、单轮读取与过期响应处理、双语RunPanel和测试。main.tsx仅挂载隔离实验面板，保留原草稿和历史。
- [x] 故障回归：正常/失败/取消/重复/取消竞态/旧run隔离/存储失败/损坏中段与截断尾部/未来版本/重启恢复，不依赖真实用户文件。
- [x] 最终fmt/test/clippy、前端类型/测试/build、全仓typecheck/test、Electron build、独立审查、生产目录零差异。
- [ ] 独立identifier原生QA，合成数据验证成功/取消/失败/重启恢复。锁屏受阻不绕过，明确未运行项。
- [ ] 正常钩子提交安全分支，验证全通过才推送Draft PR，不强推/合并/部署/安装，核验具体SHA和真实CI数量。

## 资源与回滚

复用确认无并发占用的/private/tmp/tinker-rust-night-target，Cargo离线锁定依赖。新增长尽量≤3GiB，空闲<4GiB停止新构建，不清理用户目录或制作DMG。不并行跑争用同一Cargo缓存的命令。临时caffeinate只覆盖本批，结束释放。

回滚只revert本批提交或移除实验面板/command注册；现行Electron和安装不变。runs-v1是独立新实验数据，回滚不删除它，也不迁移用户历史。未迁移能力仍标记未迁移。不承诺整机内存下降，资源测量只能描述本次离线Rust Lab。

实际证据、原生UI未运行边界、资源与回滚见 [验证报告](../reports/2026-11-09-rust-offline-run-loop-validation.md)。
