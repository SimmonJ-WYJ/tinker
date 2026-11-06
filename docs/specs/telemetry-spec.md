# 遥测埋点 Spec（Telemetry Specification）

> **状态**：已实现（单 PR 交付）
> **关联 issue**：#416（Sentry 崩溃上报）· #426（PostHog 行为埋点 + 数据采集 tab）· #427（自进化 5 类信号，上报通道等后端）
> **关联 ADR**：[ADR-011 遥测埋点架构](../adr/ADR-011-telemetry-architecture.md)
> **领域语言事实源**：仓库根 [CONTEXT.md](../../CONTEXT.md) §遥测埋点
> **PRD 来源**：[0.3.0 PRD Epic 3](./0.3.0/0.3.0-prd.md)

---

## 1. 三层架构

| 层 | 技术 | 开关 | 通道 |
|----|------|------|------|
| 崩溃上报 | @sentry/electron（main + renderer） | 恒开（脱敏） | Sentry EU |
| 行为埋点 | 自建 sender → PostHog HTTP `/batch/` | 数据采集 tab toggle ① | PostHog EU Cloud |
| 自进化信号 | 5 类 Zod schema + 可插拔 sender | 数据采集 tab toggle ②（与①解耦） | 独立端点（未配置时仅本地 JSONL） |

**红线**：绝不采集文献全文 / PDF / 笔记原文 / 对话原文 / 检索词 / API Key / 邮箱 / 用户名 / 含用户名路径。

## 2. 数据流

```
renderer 显式埋点（注册表常量）
   │ IPC telemetry:track / telemetry:capture-signal
   ▼
main telemetry-service ── consent 闸门（采集入口全停）
   ├─ 行为事件：redactDeep → deviceId 注入 → events.jsonl + PosthogSender(/batch/, proxy-fetch)
   └─ 信号：redactDeep → validateSignal（Zod strip = 白名单）→ ts 注入 → SignalSender(signals.jsonl + 可选 endpoint)
```

主进程自有埋点（app_launched / search_executed / review_generated / agent_task_completed /
自进化 5 类）直接调 `telemetryService`，不绕 IPC。

## 3. 关键文件地图

| 职责 | 位置 |
|------|------|
| 事件注册表（名称 + 属性白名单） | `packages/shared/src/telemetry/event-registry.ts` |
| consent 模型 + 时区地域判定 | `packages/shared/src/telemetry/consent.ts` |
| 脱敏纯函数（main/renderer 共用） | `packages/shared/src/telemetry/redact.ts` |
| 5 类信号 Zod schema | `packages/shared/src/schemas/telemetry-signals.ts` |
| 审计用 JSON Schema（tracked，drift 测试守门） | `schema/telemetry/*.schema.json`（`bun run gen:telemetry-schema` 生成） |
| 汇集服务（闸门/注入/出口） | `apps/electron/src/main/lib/telemetry/telemetry-service.ts` |
| PostHog / 自进化 sender | 同目录 `posthog-sender.ts` / `signal-sender.ts` |
| Sentry 初始化（main / renderer） | 同目录 `sentry-init.ts` / `apps/electron/src/renderer/lib/sentry.ts` |
| 本地缓冲（5MB 轮转 ×2） | 同目录 `jsonl-buffer.ts` → `~/.asci/telemetry/` |
| 匿名 deviceId | 同目录 `device-id.ts` → `~/.asci/telemetry/device-id.json` |
| 自进化采集器（orchestrator 旁路） | 同目录 `self-evolution-hooks.ts` |
| 构建期 key 注入 | `apps/electron/scripts/build-main.ts`（env `ASCI_POSTHOG_KEY` / `ASCI_SENTRY_DSN`） |
| 数据采集 tab | `apps/electron/src/renderer/components/settings/DataCollectionTab.tsx` |
| renderer 埋点封装 | `apps/electron/src/renderer/lib/telemetry.ts` |

## 4. 行为事件清单（0.3）

`app_launched` · `profile_created`（#420 前占位）· `login_completed`（占位待 #420）·
`search_executed`（来源工具名 + 计数，无检索词）· `review_generated` · `agent_task_completed`。
新增事件必须进注册表 + 属性白名单 review。

## 5. 自进化信号（5 类 + 隐式反馈）

task_structure / tool_usage / model_choice / error_event / workspace_structure +
implicit_feedback（copy / save / cite / discard / retry；thumbs_up/down 为占位无 UI）。
隐式反馈发射点：CopyButton、AgentView 重试、ZoteroQuickAddDialog（save）、
SendToAgentButton（cite）、NotesView 删除（discard）。

## 6. 验收对照（PRD T-1 ~ T-6）

| 验收 | 状态 |
|------|------|
| T-1 Sentry 崩溃含堆栈 + 脱敏 | 实现；Dashboard 验证待账号开通（DSN 注入后打包冒烟） |
| T-2 检索/综述/登录事件流 | 实现；登录事件为占位（#420），PostHog 可见性待账号开通 |
| T-3 地域 opt-in/out 默认 | 实现（时区启发式，见 ADR-011 §2）+ 单测覆盖 |
| T-4 两开关解耦 | 实现 + 单测覆盖 |
| T-5 信号 schema 仓库可查 | 实现（`schema/telemetry/` + drift 测试） |
| T-6 自进化端点落库 | **等后端**（ADR-002 未拍板）；本期以 `signals.jsonl` 本地可见代偿 |

## 7. 前置条件（阻塞线上验收，不阻塞开发）

PostHog EU 项目 key 与 Sentry EU DSN 由运营开通后注入 CI env；缺省时全链路自动降级本地缓冲。
