# Rust Lab 离线执行闭环验证与回滚

基线 `94dad45fff5b2220b89d9d5bedce28df9a9590bf`，分支 `feat/rust-offline-run-loop`，工作区 `/private/tmp/tinker-rust-runloop-20261109`。仅迁移隔离实验链路，不代表生产执行器迁移完成。

## 本轮实现

- Rust provider接口和唯一OfflineFixture适配器，成功/失败/慢速场景均无模型、网络、shell或付费调用。
- 单活动线程、requestId/runId去重、参数冲突拒绝、取消令牌、终态后晚到片段隔离。正常约150ms/片段、慢速约1秒/片段，取消检查间隔5ms。
- Rust Lab自身`app_local_data_dir()/runs-v1`，单写者锁、受限ID、符号/硬链接拒绝、私有文件权限。独立JSONL事实源、原子快照缓存和持久createdOrder，避免mtime相同导致最近run错选。
- 启动元数据header最多512KiB，输入最多65536 UTF-8字节；普通事件16KiB、输出256KiB、4096事件及单run日志4MiB，上限同时生效。header-only崩溃直接恢复interrupted，不伪造provider启动。
- 先持久化再向宿主确认，存储不确定时明确失败并阻断重试伪成功。截断日志显示只读恢复状态，损坏中段/未来版本拒绝覆盖。重启在途执行恢复interrupted，绝不自动执行provider。
- Tauri三个独立命令：start_lab_run、cancel_lab_run、read_lab_run，文件工作经spawn_blocking，不接受前端路径、URL或模型。
- React离线面板、严格协议和世代隔离，100ms非重叠游标读取，取消、失败、旧响应、重复点击和安全重试；恢复后独立显示原执行输入与部分输出，中英文固定错误提示，不改变当前草稿。
- 旧submit_draft仍返回modelNotMigrated，草稿schema和只读历史API保留。生产Electron/shared/core/ui/依赖锁文件未变。

## 实际通过

| 检查 | 结果 |
| --- | --- |
| 原始Rust基线 | 63 passed，0 failed |
| Rust完整测试 | 90 passed，0 failed，含原有测试、新22项核心测试、5项IPC测试/子进程夹具 |
| Tauri真实handler | 真实参数解码和响应序列化，覆盖成功/分页/去重/失败/取消/错误码 |
| 真实进程崩溃恢复 | 子测试进程通过真实handler启动慢速执行，已有片段落盘后exit跳过析构；新宿主恢复interrupted，输入/片段保留，序号不自动推进 |
| Rust质量 | cargo fmt --check、clippy --all-targets -D warnings通过 |
| Lab前端 | 30 tests，230 assertions，0 failed；typecheck、Vite build通过 |
| 全仓Bun | 3376 passed，4 skipped，0 failed，380 files，8916 assertions |
| 全仓typecheck | 6个workspace退出0 |
| Lab ESLint | 临时配置复用原规则覆盖Lab，max-warnings=0通过，生产eslint配置未改 |
| Electron构建 | electron:build退出0 |
| 独立审查与simplify复盘 | 重要发现修复后复核通过，无剩余重要确认问题 |
| 原生QA构建 | Tauri release arm64 .app构建通过；codesign --verify --deep --strict通过 |

全仓跳过的4项属于原有papers-rg-tool的包内rg二进制集成测试，当前复用依赖目录未提供该二进制。没有修改测试或生产依赖来隐藏跳过。本轮新增测试全部执行。

先写行为红测再实现。独立审查发现并修复：双层runs-v1路径、创建header后确认失败的永久queued、mtime碰撞最近run恢复错误、恢复后输入不可见，以及身份/连续序号/事件语义/启动响应绑定的前端校验缺口。相应回归已加入并通过。

## 原生验证的准确边界

独立QA产物 `/private/tmp/tinker-rust-night-target/release/bundle/macos/Tinker Rust Run QA.app`，Info.plist和编译二进制均验证标识`com.tinker.rustlab.runqa.20261109`，arm64，临时adhoc签名、未Apple公证。没有复制或安装到Applications，没有启动此产物，没有读写真实用户会话或凭据。

桌面工具预检明确返回Mac锁屏，无法操作原生应用。本轮不请求夜间解锁、不自动解锁、不改密码/锁屏/全局电源设置，也不把mock-runtime或DOM测试写成真实WebView验收。

**未运行：原生UI中的成功、取消、失败、重启恢复四流程和双语/主题人工查看；相应原生截图缺失。** 当前只能认定Rust/Tauri handler闭环、前端自动测试和原生构建通过。Draft PR保留这些验收项，不可据此宣称完整原生闭环或生产兼容已全部验收。

## 资源和保护

复用既有`/private/tmp/tinker-rust-night-target`，未开并行Cargo缓存竞争，未执行cargo clean或删除用户文件。缓存约3.2GiB→3.7GiB；新工作区约126MiB（node_modules仅指向既有依赖），本批观察增长约0.65GiB，未超过3GiB预算。全局空闲在8.8–10GiB间变化，低于4GiB会停止新构建，本轮未触发。没有测量原生应用RSS或承诺整机内存下降。

没有改旧source、旧ASCI副本、打包工作树源码、当前安装版、密钥或真实会话。原source状态仍未知，不把它当作干净；原有挂起Git进程未被本轮处理。临时caffeinate仅用于本批有界执行，结束后释放。

## 发布判断及回滚

隔离离线Lab、生产代码零差异、全部可执行新增自动检查及独立审查通过，适合发布为**Draft PR供审阅**，但原生UI验收仍待补。不会合并、auto-merge、部署、制作DMG或替换安装版。远端SHA和CI最终以实际核验为准，不能把0检查的pending状态称为正在运行CI或已绿。

回滚仅在独立分支revert本批提交并正常测试。旧草稿命令/会话文件/history-v1不需要反向迁移；runs-v1是独立实验数据，回滚不删除它。需要精确停用时移除RunPanel挂载和run_commands注册，原草稿与历史能力保留。未来再接真实provider、权限、模型/工具、真实后台任务和生产切换，均不在本轮完成范围。

主要本机日志位于`/private/tmp/tinker-runloop-checks-20261109`：baseline-rust.log、ipc-red.log、rust-final.log、clippy.log、typecheck.log、lint.log、bun-final.log、electron-build.log、native-build.log。日志不加入提交，报告不包含真实用户记录。
