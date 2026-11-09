# Provider边界解耦验证与原生补验状态

基线main：80a0043aef0e37930a395c6666e5129f3942ffdf。分支refactor/rust-provider-boundary，工作树/private/tmp/tinker-provider-boundary-20261109。新阶段与上一阶段原生补验必须分别判断。

## 一、原生补验仍受阻

本次桌面工具getState在进入应用权限流程前失败：`failed to start Node runtime: No such file or directory (os error 2)`。公开js_reset重置一次后同样失败，随后停止。未发起新的getApp权限请求，未消耗获准的一次应用访问重试，没有待批准请求。不换工具绕过，不安装或修改桌面自动化运行时，不启动QA或用户应用。

成功/流式事件/取消和重复操作/失败保留/重启恢复/中英主题/关闭返回的真实原生窗口验收仍未执行。本轮无法判断桌面是否熄屏或锁定，不推断密码状态。没有临时保活进程。以下自动检查不能代替真实WebView验收。

## 二、本阶段实现

- RunProvider::execute仅接input、取消令牌和输出sink，不接OfflineScenario。
- OfflineFixture在宿主按原有选项配置后作为Arc<dyn RunProvider>注入；控制器不再构造fixture，也不按场景选择执行行为。
- RunHostState默认仍只绑定离线fixture，受信任Rust测试宿主可注入其他实现，IPC不能传实现、URL或凭据。真实start_lab_run调用已接上注入入口，没有只新增孤立trait。
- scenario/providerKind仍为旧DTO、日志和去重的兼容元数据，尚未变成通用provider身份协议。本轮不改旧schema、UI或对外命令，不声称可直接挂真实模型。
- provider panic映射固定providerPanicked失败终态，已提交片段保留；payload不进入JSONL/snapshot/IPC。Rust默认stderr panic hook保持，没有修改全局hook。
- 注入provider必须遵守合作取消和输出sink错误；现有同步worker的Drop/join不会强制终止永不返回的第三方代码。这一边界未被本轮宣称解决。

## 三、本次新跑的证据

| 检查 | 结果 |
| --- | --- |
| Rust完整测试 | 96 passed、0 failed；较基线增加5个控制器注入/故障测试及1个真实handler测试 |
| 真实Tauri handler | HostEcho/HostPanic不同实现使用旧DTO进入同一执行器，场景标签不决定其行为，错误/panic片段可读取 |
| 控制器回归 | 分段输出、受控错误、panic、重复请求、cancel后晚到delta/panic、下一run隔离、drop/reopen不执行、落盘故障 |
| Rust质量 | fmt --check、clippy --all-targets -D warnings通过 |
| 全仓类型 | 6个workspace通过 |
| 全仓Bun | 3376 passed、4 skipped、0 failed，380 files；4项为原有包内rg二进制集成测试，非新增用例 |
| 前端及lint | Lab Vite build、复用原ESLint规则的Lab检查通过，前端源码没有改动 |
| 原生编译 | cargo tauri build --no-bundle 离线release通过，仅编译未启动，旧QA .app未替换 |
| 独立审查 | spec和quality均通过，无阻断回归；合作取消和metadata限制已审阅 |
| Electron构建 | 本次electron:build通过，生产源码不变 |

先写缺失新trait/注入接口的红编译，再实现并观测绿测；其余新增测试验证已保持语义，不声称逐例红绿。原始实施日志及Root新跑日志在/private/tmp/tinker-provider-checks-20261109，实施者报告同目录implementer-report.md，审查结果见reviewer-report.md。

## 四、保护、发布与回滚

Electron、packages、bun.lock、Cargo.lock、Rust Lab前端和存储实现相对基线零差异；只改Rust执行器/provider/host接线及测试和本轮文档。包版本由正常钩子更新。未操作有47项和14项已有差异的旧工作树，source状态读取超时仍标未知。无真实会话、密钥、模型、网络请求或费用，无安装/部署。

复用既有Cargo缓存，未创建重复大型缓存，观察到约12GiB空闲，未清理用户文件。原生UI未验收是保留的发布限制；适合自动检查和独立审查通过后作为Draft供审阅，不合并或替换生产运行时。远端SHA/CI状态以最终实际核验为准，不把0记录称为CI绿。

回滚revert本批提交即可恢复旧fixture执行器，不删除数据或迁移schema。旧草稿submit_draft的modelNotMigrated、save/recover和history只读API保留。当前provider边界仅完成无需真实调用的接线，后续网络协议、真实模型认证与费用仍未实施。
