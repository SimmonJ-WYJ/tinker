# Tinker Rust 重建：阶段 1 规格与实施记录

状态：第一阶段历史记录；当前草稿持久化实现见 [后续规格](./tinker-rust-session-persistence.md)。基线：8c1a8e046c0b792d543b01e06a93746f49c33039，Electron 0.1.604。
原阶段采用独立实验骨架；本次用户已授权将基础与持久化实现集成到最新 main 并提交推送，不发布或替换安装版。

## 选型
- Tauri 2 + Rust 主进程 + React/TypeScript 前端：推荐。系统 WebView，不携带 Electron；便于保持当前界面语言。不是全 Rust。
- Slint + Rust：可行的原生界面候选，但需要重做当前 HTML/React 编辑器、Markdown、图片等组件并独立核对许可。
- Rust 服务 + Electron：迁移风险低，但首阶段不能移除 Electron 宿主；不用于本次骨架。
参考：https://v2.tauri.app/concept/architecture/ 、https://v2.tauri.app/security/capabilities/ 、https://www.slint.dev/

## 第一阶段范围与接口
新应用 apps/tinker-rust；原 apps/electron 与 apps/tauri-prototype 均保留。
独立 identifier com.tinker.rustlab，不读写 .asci、Tinker Candidate、Electron Key 或历史记录。
只提供 snapshot、save_draft、submit_draft 三个命令。Workspace 仅有内存草稿；不访问磁盘、网络、shell，不接模型。
草稿最多 65536 UTF-8 字节；拒绝过大输入时保留旧草稿；提交空白输入报 emptyInput；非空输入保存在内存后报 modelNotMigrated，UI 不清空文字。
JSON 错误码由前端中英字典翻译；未知通信失败也显示可见提示。操作期间禁用编辑和按钮，避免覆盖较新输入。
保留当前品牌、侧栏、居中标题和圆角输入框的设计方向。未迁移的项目、搜索、渠道禁用并明确标注，不冒充功能齐全的旧界面。
CSP 限制本地资源；无 shell、fs、http 插件，窗口能力 permissions 为空。后续新增命令需单独审查权限。

## 来源与权利边界
本阶段在已有仓库中开发，不能称 clean-room 独立实现或全部自有版权。
Cargo 配置/锁文件/build.rs 以现存 tauri-prototype 为起点；Rust 草稿领域与 IPC/React 页面按本规格新增，未复制旧 orchestrator/存储逻辑。
复用用户选择的 Tinker VI v4-A 资源；资源来源记录见 tinker-logo-a-integration.md。
保留根 LICENSE、NOTICE 和旧模块。依赖 Tauri、Serde、React、Vite 等第三方许可仍适用。
本规格记录实现来源，不构成代码、Logo 或第三方权益归属保证。

## 逐阶段路线与验收门槛
1. 骨架：Rust 测试、前端类型检查、打包编译；桌面检查 IPC、草稿恢复、失败保留、浅深主题及中英。
2. 本地存储：Tinker 自有带版本 JSON/JSONL 结构，原子写与损坏恢复；用自制 fixture 测试，旧数据只读导入，支持回退。
3. 渠道：独立 endpoint/能力/错误协议，支持用户中转根地址不强制追加 /v1；Key 通过平台凭据服务，不直接导入旧加密内容。
4. 模型执行：先完成文本流式、取消、超时、429/401、权限与请求幂等；离线模拟优先，付费端到端另核预算。
5. 图片：准确引用、版本父子关系、文件缺失、保存和连续编辑；验证不重复计费、不丢草稿。
6. 项目、检索、附件和工具：逐条定义旧功能基线；Rust 适配层承接真实能力，未迁移状态不得显示成功。
7. 迁移切换：历史数据/快捷键/权限/更新/签名/跨平台实测齐备后再决定取代 Electron。此阶段不承诺时间或体积收益。

## 实施计划
- [x] 核对干净工作区和已有原型；创建 codex/tinker-rust-foundation。
- [x] 先运行草稿行为测试确认缺失行为失败，再实现 Rust 草稿域。
- [x] 新建隔离 Tauri 配置和三个 IPC 命令；新增中英前端与浅深主题。
- [ ] 运行 Rust fmt/test/clippy、前端类型检查与构建、桌面编译。
- [ ] 实际启动并检查核心流程；记录未完成项与运行限制。
- [ ] 核对旧代码、许可证和数据入口未修改；不提交或推送本阶段。
