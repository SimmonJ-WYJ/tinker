# Tinker · 第一阶段

空仓库独立构建的 Rust + Tauri + React/TypeScript 桌面基础版。没有复制 ASCI 代码或资产。暂用文字品牌和开发图标，最终品牌资产待提供。

## 启动

需要 Rust、Node、macOS Xcode Command Line Tools。依赖已锁定。

```sh
npm ci --ignore-scripts
npm run dev
```

另一个终端运行桌面开发版（依赖上述开发服务）：

```sh
cargo run --offline --manifest-path src-tauri/Cargo.toml
```

浏览器预览：http://127.0.0.1:5173/ 。仅监听本机。

## 验证

```sh
npm run build
cargo test --offline
cargo check --offline --manifest-path src-tauri/Cargo.toml
cargo build --offline --manifest-path src-tauri/Cargo.toml
```

4 项 Rust 测试、TypeScript 检查、Vite 生产构建、Tauri check/debug build 已通过。Vite 升级 6.4.5 后 npm 审计报告 0 漏洞。浏览器自动化连接开发服务超时，尚未完成可见 UI 和桌面交互验收；钥匙串仅编译验证，没有写入测试或用户密钥。

## 当前行为

演示、本地、自定义三个渠道独立保留草稿和消息。演示完成发送和明确标识的演示回复，不调用模型。本地/自定义可填写端点、模型，发送报错并保留草稿。端点和模型配置仅会话内有效，尚不参与真实请求。

macOS 桌面密钥经 security-framework 写系统钥匙串，不进入配置、日志、浏览器存储或子进程参数。成功后清空输入，无返回明文密钥到前端的命令。浏览器不接受密钥。尚无密钥读取用于请求、删除或保存状态查询。

手工验收：演示输入 → 切本地输入另一段 → 切回检查原文 → 演示发送 → 本地发送失败后检查草稿仍在。密钥请使用者在桌面用测试密钥验收，钥匙串 service 为 dev.tinker.foundation，account 为渠道 ID。

草稿、消息和配置不支持重启恢复。真实模型、流式响应、配置校验及持久化、正式 Logo、安装包和签名未完成。编译通过不等于端到端运行通过。

依赖来源和许可见 [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md)。未指定项目发布许可，也不宣称独立重写自动保证所有权。

## 产品与需求文档

[项目文档入口](docs/product/README.md)：产品方向、第一阶段需求与验收、交付问题清单、技术方向及能力核实。文档中区分已实现、计划和待验证；不代表真实模型或跨能力工作流已可用。
