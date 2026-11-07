# Rust 会话回放：验证、测量与回滚

基线 main `a371b7f409f1e34a88bba4411694c95af923c86c`，独立分支 `feat/rust-session-replay`。用户安排的实现窗口为北京时间2026-11-08 00:00至02:00，本阶段在00:00后启动，未在旧工作区写入源码。

## 交付范围

- `session_history.rs`：只读简化AgentMessage JSONL，按源行号分页，默认64条、最多256条、单行最多1MiB、每页保留源行总计最多8MiB。大消息页可少于请求条数，通过游标续读，不丢记录
- 未知元数据保留JSON语义。空白行保留游标位置，合法无换行末行可读，未写完JSON/UTF-8尾行单独标记。坏JSON、非法UTF-8、SDK原始消息形状、无效字段和读取失败拒绝整页，不把它们当空历史
- `session_lifecycle.rs`：queued/running/waitingInput/completed/failed/cancelled/interrupted纯契约，验证runId和合法转移。恢复未完成执行只标interrupted，不自动重放
- 同一合成JSONL由TypeScript AgentMessage类型测试和Rust解析测试共同验收
- 没有新增Tauri命令、UI或生产存储入口，现有草稿schema和四个命令不变，不是完整SDK或后台执行迁移

## 检查证据

| 检查 | 结果 |
| --- | --- |
| Rust全部测试 | 44通过，0失败，含原有25项草稿测试、14项历史测试、5项生命周期测试 |
| Rust fmt | 通过 |
| Rust clippy all-targets -D warnings | 通过 |
| Rust Lab前端build | 通过 |
| 全项目TypeScript typecheck | 通过 |
| 全仓Bun测试 | 3200通过，0失败，359文件 |
| Electron build | 通过 |
| Tauri/Rust桌面可执行编译 | 通过，不启动或安装 |
| Python测量脚本 | 语法检查和两种规模真实离线执行通过 |
| ESLint | 现有配置不覆盖Rust Lab测试文件，报告ignored，未宣称lint通过。Rust由clippy守门，TS由全项目typecheck守门 |

测试先验证缺失模块失败，随后实现通过。复核发现的UTF-8截断与坏JSON前缀反例也分别先失败后修复。完整中文/emoji记录的每个字节截断位置、超长行读取停止点、大消息分页保真均有回归。

## 内存与耗时

同一个release Rust二进制、同一解析器、相同合成文件与64条结果页。streaming使用BufReader，buffered先将全文件读入Vec再交同一解析器。每种策略各3次，交替顺序，结果页digest、条数和游标必须一致。macOS `/usr/bin/time -l`最大RSS单位为字节，表中为中位数。

| 记录数 | 输入大小 | 策略 | 最大RSS中位数 | 解析耗时中位数 |
| --- | --- | --- | --- | --- |
| 10,000 | 11.85 MiB | streaming | 2.11 MiB | 14.38 ms |
| 10,000 | 11.85 MiB | buffered | 13.97 MiB | 14.91 ms |
| 100,000 | 118.58 MiB | streaming | 2.20 MiB | 135.36 ms |
| 100,000 | 118.58 MiB | buffered | 120.81 MiB | 144.48 ms |

这是读取器输入策略的比较，**不是Electron与Tauri的整机内存比较**，也不是应用冷启动、空闲、并发会话或窗口关闭测量。两种策略均不启动WebView或模型。OS缓存未强制清空，时间不是冷缓存性能结论。页预算限制的是源行字节，解析后的Value/未知数组存在额外开销，不代表严格8MiB堆上限。

结果JSON记录每次观测、输入/二进制SHA-256、rustc、系统、架构与Python版本。原始time日志留在本地项目diagnostics，不提交124MB合成文件或构建产物。受限沙箱首次time调用无法查询kern.clockrate，按所需权限重跑后才采信结果。

### 复现

```sh
bun run --cwd apps/tinker-rust build
CARGO_TARGET_DIR=/tmp/tinker-replay-repro cargo build --offline --locked --release --manifest-path apps/tinker-rust/src-tauri/Cargo.toml --example session_history_memory
python3 apps/tinker-rust/scripts/measure-session-history.py --binary /tmp/tinker-replay-repro/release/examples/session_history_memory --output /tmp/tinker-replay-results --messages 100000
```

离线构建要求Cargo依赖已缓存。输出目录必须是新目录，避免覆盖旧观测。计划任务可额外传`--stop-at-utc`带时区ISO时间，超过截止不再启动下一次测量。构建profile/工具链变化后必须重新记录二进制指纹，不跨二进制混比。

## 兼容与回滚

- 新代码只有库模块导出、测试与测量工具，没改Electron、Tauri main.rs、草稿存储或React界面
- 回退仅移除这两个模块和lib.rs导出，以及相关测试/测量文件，或者回退本PR，不reset整个用户仓库
- 真实历史文件从未交给适配器，不存在已迁移用户数据需要回写，现行安装版继续可用
- 仅支持标准简化消息字段：非空id、四种role、字符串content、JS安全非负整数createdAt，保留其他JSON字段。超过行上限或不支持形状会明确拒绝，不能宣称兼容所有旧文件
- 游标仅在同一追加型文件上稳定，文件被重写后的跨快照分页不保证。每页仍需扫描前缀，没有持久化索引，未承诺全量翻页CPU优化
- 未接SDK日志、权限、实际取消/重连/rewind、工具幂等或模型执行，不代表完整会话迁移，后续接线需单独验收
- Windows/Linux运行、物理断电、完整原生端到端和应用级受控内存对比未做
