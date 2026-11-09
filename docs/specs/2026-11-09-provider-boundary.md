# Rust执行器provider边界解耦

状态：已实现并完成自动验证与独立审查，原生UI补验仍受阻。基线80a0043aef0e37930a395c6666e5129f3942ffdf，独立分支refactor/rust-provider-boundary。

## 范围

RunProvider不再接OfflineScenario，控制器不得直接创建/执行OfflineFixture。宿主适配层将现有success/failure/slow选项绑定到provider后注入同一执行器，保留start_lab_run/cancel_lab_run/read_lab_run及现有UI/DTO/旧日志读取、去重、取消、失败保存、重启恢复。OfflineScenario若作为旧持久化兼容元数据保留，不能再充当provider执行参数或决定控制器行为。不得为隐藏类型而添加空转转发层。

新增行为：任意注入的受信任provider发生受控错误或panic时，执行器必须形成明确终态、保留已提交片段，不能永远running；取消后provider晚到结果不得改写旧run，drop和重开不自动调用provider。默认唯一可由IPC选用的provider仍为离线fixture，前端不能传provider实现、URL或凭据。

## 验收

先写失败行为测试，再实现最小接口；至少两个不同注入provider走真实控制器，验证分段输出、错误和panic、重复请求、取消/晚到片段、重开不执行、落盘故障。现有Tauri handler测试证明旧命令继续走已注入provider链路；IPC/React协议不改变，生产Electron/packages/bun.lock零差异，无新依赖。运行Rust fmt/test/clippy，前端和全仓类型/测试/lint/构建、独立审查，验证后正常钩子推安全分支并仅开Draft PR。

原生UI补验独立阻碍：桌面工具getState两次均failed to start Node runtime: No such file or directory，尚未进入新的应用权限流程。成功/取消/失败/重启/双语主题/关闭返回仍未验收，不以自动测试替代；不再重试CUA，不换工具绕过。

回滚：revert本批提交恢复上一版fixture执行器，不删除实验数据。不接真实网络、模型、密钥、付费调用，不安装/部署。复用既有Cargo缓存，磁盘低于4GiB停新构建，不清理用户文件。不操作有47/14项已有改动或读取超时的旧工作树。

验证及回滚：[报告](../reports/2026-11-09-provider-boundary-validation.md)。
