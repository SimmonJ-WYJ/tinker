# Rust HTTP/SSE迁移阶段报告

状态：限定范围的本机HTTP/IPC自动化验证和独立审查已完成，准备按正常钩子提交安全分支及Draft PR。非完整产品/原生窗口验收。

## 范围及基线

- 基线：main `b61ee1a8b7a04053643eb8da63dc43afee738459`
- 工作树：`/private/tmp/tinker-chat-http-20261109`
- 分支：`feat/rust-chat-http-stream`
- 规格：[HTTP/SSE适配](../specs/2026-11-09-rust-chat-http-stream.md)
- 依据：[Chat Completions官方协议](https://developers.openai.com/api/reference/resources/chat)，以及现有生产OpenAI-compatible适配源码

本批实现单轮文本Chat Completions HTTP/SSE适配，接入既有RunProvider、RunController和真实Tauri命令handler。可信Rust宿主可通过`RunHostState::with_chat_http`注入配置，renderer不能任意选择端点、模型或凭据。默认桌面入口仍使用离线provider，本批没有增加模型配置UI或切换生产执行路径。多轮上下文、工具、生图、项目和完整产品切换均未实现。旧DTO中的providerKind/offlineScenario字段仍是兼容元数据，不能作为网络来源展示或线上模型已启用的依据；实际来源取决于可信宿主注入，正式接入前还需单独完善配置和展示契约。

## 实现与边界

- 支持分片UTF-8、LF/CRLF/CR、流首BOM、可空元数据、usage尾块及完成标志
- 受控错误、断流和取消保留已持久化片段，沿用去重、晚到事件隔离与重启恢复语义
- HTTP仅允许numeric loopback，HTTPS域名必须由可信宿主显式提供地址pin，禁用系统DNS后备
- 原域名仍用于TLS证书验证，地址解析/更新须由未来另获授权宿主负责，本批没有外部TLS或DNS请求
- 禁止代理、重定向、自动重试，限制网络等待、总执行预算、正文、帧和输出大小
- 固定错误码，不保留上游错误body、URL、headers或reqwest异常原文，配置不实现Debug
- 对已配置伪key跨帧反射做暂存拦截，测试检查IPC及整个JSONL中无完整伪key

## 本轮验证

| 检查 | 当前结果 |
|---|---|
| 全仓`bun run typecheck` | 6个workspace通过 |
| 全仓`bun run lint` | 通过 |
| 全仓`bun test`（允许合成回环测试） | 3376通过，4跳过，0失败，380文件 |
| Rust Lab Vite build | 通过，32模块 |
| `git diff --check` | 通过 |
| Rust全量`cargo test --offline --locked` | 118通过，0失败，子进程辅助重复计数另计 |
| Rust `cargo fmt --check` | 通过 |
| Rust `cargo clippy --all-targets -- -D warnings` | 通过，未压制警告 |
| 原生Rust binary build | 通过，仅编译，未启动GUI |
| `bun run electron:build` | 通过，未启动或安装应用 |
| 独立复核及simplify | 旧3项与新增输出预算P2均关闭，未确认剩余P1/P2 |
| 原生UI/真实模型/产品验收 | 本轮未执行 |

日志保存在`/private/tmp/tinker-chat-http-checks-20261109`。Rust最终计数为53库、7协议、10传输、2历史IPC、4历史库、11执行IPC、12SDK历史、14会话历史、5生命周期，共118项，不重复累计两个子进程辅助测试。严格lint曾发现布尔表达式及测试helper未消费读取长度，均修正后重跑，未通过allow或跳过规则放行。默认sandbox首轮Bun有14项本机监听失败，提升至工具支持的回环测试权限后同套测试全通过。所有HTTP执行测试仅监听`127.0.0.1:0`，伪凭据和合成内容，不发送真实用户数据、不使用真实密钥、不产生模型费用。

HTTP专项最终包含7项协议测试、10项传输测试，以及11项IPC测试中的HTTP接线/错误脱敏/取消/重复/历史恢复用例。取消headers/body和超时均由本机服务端EOF/Reset验证连接释放，HTTP子进程退出后重新打开历史，整棵JSONL检查伪key未落盘。没有把这些测试称作线上或原生窗口验收。

首轮独立静态审查发现三项P2：nullable字段误拒、BOM/CR丢帧、阻塞DNS导致取消后runtime退出可能等待。新增BOM/换行回归先实际失败，再修复。DNS通过显式pin和拒绝resolver封住后备路径，不能用numeric-loopback结果外推真实HTTPS验收。最终复核另发现P2：上游大文本片段、JSON转义及SecretGuard前缀合并可能超过完整JSONL事件预算。已在安全输出和完成刷新处统一按UTF8边界分片，每片原文≤2048字节，最坏JSON转义≤12288字节，留4096字节容纳既有元数据。真实IPC回归先失败再通过，覆盖中文16KiB、长key前缀与控制字符、8191引号前缀结束刷新，最终输出一致且completed。

## 保护与验证限制

生产`apps/electron`、`packages`、`bun.lock`、Rust前端和run_store实现相对基线零差异。旧主仓、source、其它worktree、用户数据和安装版不写入；不改另一路QA合成数据。没有制作DMG、启动GUI、部署或安装。生产零差异只证明本批未改变生产源码，不代表新栈完整复刻了产品UI或全部功能。

本批使用真实HTTP socket和Tauri handler，WebView由Tauri MockRuntime提供，不能称原生窗口实测。真正线上模型、TLS握手、账户认证、模型兼容性与费用未验证。后续线上冒烟需明确服务、模型、一次性凭据用途、合成请求及费用上限。同步本地持久化耗时不受网络I/O计时器强制抢占，不将网络预算写成整个进程的硬实时上限。

## 资源与审批历史

曾因空闲3.27GiB触发4GiB停止线，暂停构建且未清理缓存或用户文件。用户自行释放空间后重新核验足够才恢复，始终单一Cargo构建者，复用既有`/private/tmp/tinker-rust-night-target`。共享缓存不是本批独占，不整目录清理。

首次回环绑定在默认sandbox返回`PermissionDenied / Operation not permitted`，不是审批拒绝。随后一次组合命令被自动审批以开发授权未明确拒绝，确认完全未执行后停止。协调侧补充经用户源消息核验的继续迁移授权，按原命令、目标、权限路线仅重试一次，session22046获执行，5测试4通过1预期失败。没有拆分或换工具绕过拒绝。后续回环验证通过正常支持的权限流程执行。

## 回滚及下一步

未提交阶段可保留本隔离分支，不接入任何生产入口。发布后回滚为revert本批提交，或继续使用基线默认离线路径，不删除或反向迁移数据。现有外部命令、DTO、草稿/事件schema和只读历史保持兼容。正常pre-commit会自动增加根与Rust Lab包的patch版本，这些仅是版本元数据，不涉及生产依赖或UI变更。

本报告随本批安全分支提交。准确提交SHA、Draft PR及远端CI查询结果见该PR和最终交付回复。没有checks/status/Actions记录时只能写无记录，不能称CI通过。

## 可复现检查命令

在仓库根执行，Cargo统一使用既有`CARGO_TARGET_DIR=/private/tmp/tinker-rust-night-target`，离线锁定依赖。回环测试通过工具支持的狭窄权限流程运行，Bun测试使用临时ASCI_CONFIG_HOME/ASCI_RUNTIMES_HOME和清理后的环境。

```sh
cargo fmt --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --check
cargo test --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --offline --locked
cargo clippy --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --offline --locked --all-targets -- -D warnings
cargo build --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --offline --locked --bin tinker-rust-foundation
bun run typecheck
bun run lint
bun test
bun run --filter=@tinker/rust-desktop build
bun run electron:build
git diff --check
```
