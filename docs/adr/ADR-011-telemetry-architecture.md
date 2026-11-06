# ADR-011：遥测埋点架构（三层、主进程汇集、地域判定、EU 驻留）

| 字段 | 内容 |
|------|------|
| **状态** | Accepted |
| **拍板日期** | 2026-06-02 |
| **关联** | issues #416 / #426 / #427 · [0.3.0 PRD Epic 3](../specs/0.3.0/0.3.0-prd.md) · [telemetry-spec](../specs/telemetry-spec.md) |

---

## 背景

0.3 公开发布需要崩溃定位（Sentry）、产品行为分析（PostHog）与自进化信号采集（自建端点）。
科研用户高度重视隐私、欧盟用户受 GDPR 约束，且自建后端（ADR-002）尚未拍板。
本 ADR 记录五个**难逆转或反直觉**的架构决策及其理由。

## 决策

### 1. 主进程统一汇集，禁 autocapture

所有遥测（行为事件 + 自进化信号）经 IPC 汇集到主进程 `telemetry-service`，由它统一执行
consent 闸门 → Zod 白名单 → 脱敏 → deviceId 注入 → 上报。renderer 不直连任何 SaaS。

- **为什么不用 posthog-js（官方推荐路径）**：autocapture 自动抓 DOM 文本，会把文献标题 /
  笔记内容捎出去，正面撞"绝不采集研究内容"红线；且 renderer 直连不走项目 proxy-fetch，
  科研用户大量在代理环境下会大面积丢数据。
- **为什么不用 posthog-node**：其自带 http 客户端无法复用 undici ProxyAgent；
  改为自建薄 sender 直连 PostHog HTTP `/batch/` API（零新增运行时依赖）。

### 2. 地域判定 = 本地时区启发式（偏离 PRD「欧盟 IP」字面）

PRD 写"欧盟 IP"，但查 IP 归属必须先把 IP 发给某个 geo 服务——发生在用户同意采集**之前**，
构成"同意前先泄 IP"悖论。改用 `Intl.DateTimeFormat().resolvedOptions().timeZone` 对照
EU/EEA/UK 时区清单（`packages/shared/src/telemetry/consent.ts`），零网络外发；
**无法判定一律按 GDPR 区保守处理**（默认关）。误差场景（旅行/代理）的偏差方向是更保守而非更激进。

### 3. consent 闸门 = 采集入口全停

toggle 关闭 = 不写本地 JSONL 也不上报（而非"本地照写、只闸上报"）。开关语义真实、审计干净。
两路开关（PostHog / 自进化）完全解耦。Sentry 恒开无 toggle（PRD 拍板，崩溃上报按合法利益处理，
但 main + renderer 双进程均过 `beforeSend` 深度脱敏；native minidump 无法客户端脱敏，
其上传不含 ASCI 注入的用户字段——这是已知边界）。

### 4. SaaS 数据驻留选 EU

PostHog EU Cloud（`eu.i.posthog.com`）+ Sentry EU region。与 ADR-002 节点位置倾向欧盟一致，
避免对欧盟用户的 SCC 依赖，Privacy Policy 子处理者清单更干净。建项后迁移区域成本高，故为难逆转决策。

### 5. @sentry/electron 必须 external（CLAUDE.md §7.1 的第三个例外）

`@sentry/electron` 依赖 OTel 动态 instrumentation（require-in-the-middle），不可被 esbuild
bundle，必须 `--external` 并把完整传递依赖闭包（68 包）写进 electron-builder `files`
（见 `apps/electron/scripts/build-main.ts` 与 `electron-builder.yml` 注释）。
处理模式与 agent-sdk 相同。

## 其他要点

- **匿名 deviceId**：本地 UUID（`~/.asci/telemetry/device-id.json`）做 PostHog distinct_id；
  #420 OPENSCI 登录落地后用 `identify()/alias()` 合并到账户，不等登录不阻塞。
- **自进化上报解耦**：后端（ADR-002）未建成，sender 可插拔——endpoint 未配置时仅本地
  `signals.jsonl` 缓冲（5MB 轮转 ×2）；schema 经 zod `z.toJSONSchema()` 生成
  `schema/telemetry/*.schema.json`（tracked）供外部审计，drift 测试守门。
- **key 注入**：PostHog key / Sentry DSN 均为 publishable，构建期经 esbuild `--define` 注入
  （env `ASCI_POSTHOG_KEY` / `ASCI_SENTRY_DSN`）；缺省时全链路自动降级本地缓冲。
- **dev 门控**：未打包 / `ASCI_DEV=1` 不发任何真实网络，仅本地 JSONL（`~/.asci-dev/telemetry/`）。

## 后果

- 新增事件 = 改 `packages/shared/src/telemetry/event-registry.ts` 注册表 + review 属性白名单，
  调用点禁裸字符串。
- 自进化信号字段范围以 `schema/telemetry/` 为准，改 Zod 必须重跑 `gen:telemetry-schema`。
- 后端就绪后开闸自进化上报 = 配置 endpoint（`ASCI_EVOLUTION_ENDPOINT`），无需改采集代码。
