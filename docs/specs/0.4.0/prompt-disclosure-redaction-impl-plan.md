# Prompt/数据披露脱敏 · 实现计划（PR 拆分与执行口径）

> **状态**：执行中 · 实现计划
> **设计权威源**：同目录 [`prompt-disclosure-redaction-spec.md`](./prompt-disclosure-redaction-spec.md)（本文件只管"怎么落地/拆分/验收"，不重述设计）
> **关联 issue**：[#710](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/710)（P0 = SB1 上线门禁）
> **关联 PR**：PR1–PR5 开后回填
> **领域语言事实源**：`prompt-disclosure-redaction-spec.md`
> **作者**：Huang Jia
> **日期**：2026-06-24

---

## 0. 执行口径

- **单一主题 PR**：#710 的 P0 虽是一个 issue，但改动面横跨 shared redaction / IPC DTO / debug·export / telemetry·Sentry / capability UI，拆成 **5 片独立 PR**，**不做整 P0 大 PR**（review 友好；一片定位不清不拖住全部）。
- **节奏**：做完一片 → 测完一片（§15 对应项"0 命中"有证据）→ 提一片；**不攒到最后一次性提**。
- **Closes/Refs**：前 4 片 `Refs #710`；只有最后门禁验收全绿的 PR 才 `Closes #710`。
- **版本号**：改到哪个包，该包 `package.json` patch +1，**开 PR 时一次性递增**（不在本地逐 commit 递增）。
- 设计细节（L0–L4 分级、占位符、分层边界、redaction category）一律以 spec 为准。

## 1. PR 拆分总览

| PR | spec 任务 | 关闭的 §15 门禁项 | 依赖 | 分支 | 标题 | 体量 |
|---|---|---|---|---|---|---|
| **PR1** | P0-0 | （建立机械基线 + "Redaction L4"） | 无 | `feat/issue-710-prompt-disclosure-redaction`（当前，mainline） | `feat(telemetry): add prompt disclosure redaction foundation` | M |
| **PR2** | P0-2 / P0-3 | Permission/AskUser/ExitPlan IPC 不发 raw `toolInput`；Permission fallback | PR1 | stacked on PR1 → 合后 rebase main | `feat(agent): remove raw tool input from renderer requests` | M |
| **PR3** | P0-1 / P0-8 | 普通 debug copy / 普通导出 无 L2-raw/L3/L4 | PR1 | stacked on PR1 → 合后 rebase main | `fix(agent): redact debug copy and export outputs` | M |
| **PR4** | P0-5 / P0-7 | 第三方 telemetry 只含 allowlist；Error monitoring 只 class/hash/redacted | PR1 | stacked on PR1 → 合后 rebase main | `fix(telemetry): redact third-party and sentry payloads` | M |
| **PR5** | P0-4 | 能力包配置页不展示 `scenarioAgent.description` | **无（off main）** | `feat/issue-710-capability-summary-only`（off main，可先做先合） | `fix(agent): hide capability routing descriptions` | S |
| **验收** | §15 总扫描 + P0-6 + 打包/SDK 证据 | 合并扫描 0 命中；replay no-op；产物可读性结论；SDK 注入结论 | PR1–PR5 | 最后开 | `chore(release): prompt disclosure release-gate evidence`（`Closes #710`） | S–M |

## 2. 分支与合并策略

1. **PR5 先行**：off `main`、最小最确定、不依赖 PR1，能早合就早合。
2. **PR1 是 mainline 地基**：后续 PR2/3/4 都依赖其 redaction primitives + canary harness，须尽早单独提、先合。
3. **PR2/3/4**：PR1 合并前可基于 PR1 开 stacked branch 开发，PR 描述标 "based on PR1"；**PR1 合并后 rebase 到最新 `main`**（ADR-000：开 PR 前 rebase 目标分支最新）。
4. 全程不直接 commit 到 `main`，必走 PR（ADR-000）。

## 3. 各片详情

### PR1 · P0-0 redaction foundation + canary harness
- **目标**：可复用的脱敏地基 + "0 命中"机械基线。
- **范围**：`packages/shared/src/telemetry/redact.ts` 扩 `RedactionCategory`（credential/env-value/prompt-body/tool-payload/query/home-path/file-content/pii/thinking/unknown）+ 占位符 formatter（`formatPromptPlaceholder` 等）+ **带 `redactionMatches` 的新变体**；**旧 `redactText`/`redactDeep`/`scrubSentryEvent` 签名与同步性不动**（只扩内部规则）。main：minimal prompt fingerprint helper（泛化 `zotero-article-generator` 的 `PROMPT_VERSION`）+ hash/bytes（`node:crypto` 只在 main）+ 节流 audit sink（复用 `JsonlBuffer`）。**canary 泄漏回归 harness**：埋假 token/cookie/Authorization/home-path/prompt-body/thinking，对各出口断言"0 命中"（此刻多数红，后续 PR 逐个变绿）。
- **行为测试(BDD)**：给定敏感串 → 出对应占位符 + `redactionMatches`；旧调用链不坏。
- **验收**："Redaction L4"项绿；canary harness 建立。
- **风险**：别破坏现有同步 Sentry beforeSend 路径；hash 只在 main（spec §8.1）。

### PR2 · P0-2 / P0-3 IPC raw toolInput 收口
- **目标**：renderer 拿不到 raw `toolInput`，但 SDK 仍能 resume。
- **范围**：`formatToolPreview` 逻辑搬 main；`PermissionRequest` 增 `toolPreview`（脱敏）；`PermissionRequest`/`AskUserRequest`/`ExitPlanModeRequest`（`shared/types/agent.ts`）去掉 renderer-facing raw `toolInput`；main pending state 保留 raw 供 SDK resume。**IPC 四联同步**（shared 类型 → main service → preload → renderer）。实测：renderer 仅 permission 三件套消费 `toolInput`（`PermissionBanner`/`PermissionQueueList`/`PreviewFormatters`），AskUser/ExitPlan renderer 不读 → 改动小。
- **行为测试**：未知工具只显示 hash/bytes/redacted；**approve → SDK resume 仍带原始 input（头号回归）**；renderer payload 无 raw。
- **验收**：§15 第 3 项 + Permission fallback。
- **风险**：SDK resume 断裂（最高优先级回归测试）。

### PR3 · P0-1 / P0-8 debug copy + export 出口
- **目标**：普通 debug copy / 普通导出不含敏感内容。
- **范围**：`DebugCopyButton.tsx` / `format-turn-debug-content.ts` 拆 user-safe / redacted-diagnostic；普通导出 vs 诊断导出分离（**先定位"普通导出"真实代码路径**——grep 未直接命中，PR 内确认）；hash 在 main。
- **行为测试**：普通模式无 thinking 全文 / raw tool I/O / prompt body / token·cookie·home-path；诊断模式才出 redacted preview/hash。
- **验收**：§15 第 1、2 项。

### PR4 · P0-5 / P0-7 telemetry + Sentry
- **目标**：第三方出口（analytics / error monitoring）不含敏感内容。
- **范围**：`event-registry.ts` 字段标 L0–L4/purpose/retention/exportable/alertable；`posthog-sender.ts` 发送前 redact；main `sentry-init.ts` + renderer `lib/sentry.ts` 的 `beforeSend` 复用扩展后 scrubber（renderer envelope 不过 main，须自洗）。
- **行为测试**：构造 token/path/query/tool-input，第三方 payload 只见 allowlist/redacted/hash；renderer 自洗不依赖 main。
- **验收**：§15 第 5、7 项。

### PR5 · P0-4 capability UI summary-only（off main，可先做）
- **目标**：配置页不暴露 routing prompt。
- **范围**：`CapabilityPackPanel.tsx` 停渲染 `scenarioAgent.description`，改 `summaryI18n` / public summary；loader 校验：**生产内置包缺 summary → 失败**。实测两个内置包（`lit-review`/`lit-search`）均已有 `summaryI18n` → 低风险。
- **行为测试**：配置页源码/界面无 description 原文；lit-review/lit-search 摘要正常；缺 summary 的生产内置包校验失败。
- **验收**：§15 第 4 项。

## 4. release-gate 验证证据（P0，非完整治理）

issue 正文已把"打包产物 / SDK 注入面逐项 0 命中"写进 P0 范围，**不挪 P1**。但区分：

- **P0 必须有验证证据**：① 扫描打包产物（`default-capability-packs` / `default-skills` / manifest / prompt `.md` 安装后可读性）给结论；② 实测 SDK/plugin 注入面，给出"进入/不进入 provider/debug/export/telemetry"结论。
- **完整 registry / 长期治理**（owner/label/canary/rollback、产物扫描自动化）留 **P1**。
- **若扫描或实测发现 raw prompt / skill prompt / secret 进入 debug/export/telemetry → 对应修复立即升级 P0。**
- 归入 release-gate evidence：可并进 PR1 的 canary harness（产物 grep），也可放最后验收 PR。

## 5. P0-6 session replay：no-op 声明

- 实测**未启用** session replay（仓库 grep `sessionReplay`/`replaysSessionSampleRate`/`rrweb` 零命中）→ P0-6 **不写代码**。
- 在 PR4 或最终验收里写清：当前未接入 session replay；P0-6 代码改动 no-op；**若未来接入，必须默认 mask** 对话输入 / prompt 编辑器 / 论文摘录 / terminal / 权限参数，并随 consent 关闭。

## 6. 每片提 PR 前自检（三问）

1. 这片关闭了哪一条 §15 门禁？
2. 有没有**自动测试**证明？
3. 有没有**"0 命中"证据**（测试 / grep / 抓包）？

三条齐 → 可提；只有"代码看起来改了"但无 0 命中证据 → 先不提。

## 7. §15 上线门禁总清单（最后验收 PR `Closes #710`）

- [ ] 普通 debug copy 无 L2-raw/L3/L4 — **PR3**
- [ ] 普通导出无 L2-raw/L3/L4 — **PR3**
- [ ] Permission/AskUser/ExitPlan IPC 不向 renderer 发 raw `toolInput` — **PR2**
- [ ] 能力包配置页不展示 `scenarioAgent.description` routing prompt — **PR5**
- [ ] 第三方 telemetry payload 只含 allowlist — **PR4**
- [ ] session replay 已 mask 或未启用声明 — **P0-6 no-op（验收 PR）**
- [ ] Error monitoring 只传 error class/stack hash/redacted — **PR4**
- [ ] 打包产物扫描完成，明确可读性 — **release-gate evidence**
- [ ] SDK/plugin skill injection 测试完成 — **release-gate evidence**
- [ ] 合并扫描：debug copy/导出/stderr/permission/第三方 payload 中 prompt 片段·凭证·隐私路径 0 命中 — **验收 PR（基于 PR1 canary harness）**
