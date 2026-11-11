# M2A：原正式 React UI 的 Tauri/Rust 独立宿主

状态：实施中。基线：63fdde632dcb625df1f5736d9f7ea5270f5de547。关联：已合并 PR #21。领域事实源：CONTEXT.md 和真实源码。

## 目标与全局约束

用户要求加速技术迁移，复用现有正式 UI 与交互。本批使用同一个 apps/electron/src/renderer/main.tsx、App、CSS、Jotai 状态，交付独立 Tauri 测试宿主，直接调用 Rust DesktopRuntime，不嵌入 Electron/Node 后端。

- 正式 Electron/SDK 默认链路、旧 Lab、用户安装版与真实数据保持不变。
- 仅新标记的隔离根、合成配置和 numeric loopback 模拟服务，不读取真实凭据/会话，不付费，不安装到 Applications。
- 保留现有 API 参数、返回值、同步与 unsubscribe 语义。未实现能力明确拒绝，禁止 Proxy 空成功。
- 同步设置返回 true 必须代表持久化已确认；关闭必须保存最后 500ms 内尚未 debounce 的标签状态，存储失败不得默默关闭。
- Rust 平台状态与会话 journal 分离，安全根、schema、大小限制、原子持久化、错误脱敏。renderer 不得控制 root/端点/密钥。
- 新 identifier、独立应用包、最小窗口与 IPC 权限；无通配文件/命令执行，无任意外部导航。
- 新用户文案走 en/zh i18n，不改布局、样式和生产默认。README.md/CLAUDE.md 不修改，说明落本 spec 与报告。
- 单个实现代理串行写入，同任务独立审查。不得清理用户文件或覆盖其它 worktree。安全分支正常提交、推送、Draft PR，不合并、部署或安装。

## 决策与能力边界

选择纯 preload domain 工厂注入 transport，复用完整 API 形状。Electron 适配保持 ipcRenderer/contextBridge。Tauri 先初始化真实宿主快照与事件桥，再动态 import 原 renderer。原静态 Electron Sentry 依赖和 CSP 在独立 Tauri 构建适配，不影响 Electron 构建。

Tauri 原生 Rust 平台服务提供设置、主题/语言、合成用户档案、工作区、引导、标签等启动和会话所需 API。会话发送/上下文/流式/取消/失败/重启继续使用现有 DesktopRuntime。不可用的附件、图片、OAuth、通用工具等不能伪装成功。

当前 provider sink/context/journal 仅支持文本，无 typed tool events、call/result、权限协调器和 runner。实际工具闭环 M2B 依赖这些扩展，另批实现，优先只读合成文件工具；deny/cancel/expired/wrong-run 必须零执行。此批不把单独权限卡或 toy 按钮算作工具迁移。

## 实现计划

### Task 1：纯 API 工厂与 Electron 适配

范围：apps/electron/src/preload/{transport.ts,api.ts,helpers.ts,index.ts,domains/*} 及对应测试。
把六 domain 的 Electron 依赖变为显式 transport 注入；导出 createDesktopApi(transport) 返回同一个 ElectronAPI。transport 支持 invoke、readSync、subscribe、getPathForFile。Electron adapter 放唯一 Electron 入口，保持现有方法通道/参数/返回值/同步执行和 unsubscribe。纯 api/domain/helpers 不得 runtime import Electron/Node。

先写行为测试，通过可记录 transport 验证全部 API 方法形状、代表性四联参数、事件 unsubscribe、同步 settings/theme/chrome/telemetry 和 webUtils 路径语义，覆盖零参数与 namespace。原 Electron 构建/typecheck 不变。不要实现 Tauri transport 或 Rust 平台。不要改生产 UI。

### Task 2：Rust 平台状态与可信启动边界

新增 formal_platform 模块与可信启动边界，共享 DTO 保持薄。固定白名单平台服务与DesktopRuntime共用严格标记隔离根。原生宿主于下一任务接线，旧 Lab 仍 None。提供 fixed allowlist 的平台 invoke/bootstrap、typed bounded mutations，版本化快照、revision 与持久化 ack。设置、用户/工作区和初始主题的事实源必须可重启恢复。写失败不提前更新缓存。窗口关闭 token 验证匹配 renderer flush，超时/失败保留窗口。

先行为测试根/标记/schema/未知字段/大小、并发 revision、重复 mutation、原子失败和重启。测试 handler 而非仅辅助函数。原真实用户路径不得访问。主 binary 的 production defaults 和 Lab 不变。

### Task 3：原生会话适配与独立宿主

新增 FormalAgentHost 持有会话 active/polling/generation，复用 DesktopRuntime 与既有投影契约，页面刷新不丢执行事实。固定 IPC/session/profile 映射与参数边界。GET_SDK_MESSAGES 恢复时须主动提供完整 text_snapshot、requestId 与后续增量，晚到响应不进入别的请求。host持有取消、退出、断流的生命周期。新增独立binary/config，FormalHost 持有唯一 Arc<DesktopRuntime>，旧Lab 的 DesktopHostState(None) 与默认命令保持。新binary只注册受actor/generation/关闭边界约束的formal命令，不额外暴露可绕过这些边界的旧Lab通用命令。

预览专用宿主内嵌受控 Rust numeric-loopback HTTP/SSE mock，稳定标记测试渠道/模型与逻辑configRevision，随机端口仅为宿主传输定位。这个fixture不属于核心provider，不访问真实服务。独立app无需Node/Electron/devserver。先测宿主真实服务门面、分页/刷新/重复/取消/失败/错误投影，未支持能力明确拒绝。

### Task 4：同 renderer 的 Tauri transport 与生命周期

独立 Vite/entry/transport、受限 event 桥、原生会话事件订阅和 Rust projection/polling 契约、平台缓存与关闭 participant。复用 M1 纯逻辑，避免 Node router 打入 WebView。注册事件后再 mount。同步 API 从已确认 cache 读取；updateSettingsSync 不能假 ack。正式 main.tsx 只添加非视觉且 Tauri 明确门控的 close flush participant，原 Electron 路径保持。

通过同 DTO 接线通道/模型、创建/列表/历史、发送/多轮/流式/停止/错误/重启恢复，晚到响应只属于对应 requestId。独立构建 CSP 支持必要 Tauri IPC，Sentry 使用受控适配，不引入真实网络。测试协议映射、参数失败、取消、乱序、关闭最新 atom 与失败不关闭。

### Task 5：可运行包、原生验收与最终守门

构建独立 identifier 的 .app，不写 Applications。不依赖 Node/Electron/dev server；如需模拟 provider，交付明确启动器和合成服务，无服务时明确失败。原生验收可使用 owned QA binary 内部驱动 WKWebView、记录截图与合成 HTTP/journal，不能向产品 renderer 暴露任意 eval 或绕过系统权限。

覆盖启动/退出、双模型/effort、多轮 Unicode、流式、取消/重复、失败草稿/部分内容、刷新/关闭重开、中英主题与最后 debounce 窗口保存。区分 DOM 自动化与系统鼠标测试，截图对照原正式 UI，不承诺跨引擎像素一致。

最终 Rust fmt/test/clippy，前端与全仓 typecheck/Bun/lint，Electron build、Tauri build，独立 review/simplify，敏感信息及 production default 差异审查。fetch/merge 最新 main 后安全提交推送 Draft PR，核验完整 head/checks/status/Actions，无记录不能写 CI 通过。

## 回滚与交付

独立测试应用退出即可回到原 Electron，原数据从未迁入。可逐提交 revert 本批源码，新增隔离数据仅在明确识别且另获删除授权时清理。报告列实际测试、未运行范围、源 SHA、应用路径与哈希、签名公证状态、GitHub PR/CI、未迁移功能。不能称完整产品/真实服务/全部 UI 行为已验收。
