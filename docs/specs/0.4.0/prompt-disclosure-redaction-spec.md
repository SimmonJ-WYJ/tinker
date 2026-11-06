# Prompt/数据披露分级与脱敏 · 实现 Spec

> **状态**：草案 · 待 review（位于 `docs/specs/0.4.0/`）
> **作者**：Huang Jia
> **关联 milestone**：[`docs/milestones/0.4/north-star.md`](../../milestones/0.4/north-star.md) §三（P3 安全边界 = Epic3）—— 本 spec **P0 → SB1 上线门禁（发布门禁）/ P1 → SB2（观察）**；P2 → 0.5+
> **关联 issue**：[#710](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/710)
> **关联 PR**：（无）
> **领域语言事实源**：本文件；术语回填仓库根 `CONTEXT.md` 待补
> **上游决策**：（原桌面草案引用 `prompt-visibility-classification-spec.md`；经确认本 spec 自包含、不依赖该文件，可独立作为完整方案）
> **关联架构**：`docs/adr/ADR-011-telemetry-architecture.md` · `docs/specs/telemetry-spec.md`
> **日期**：2026-06-18（迁入仓库 2026-06-22）
> **工作底稿**：`prompt治理/ASCI Prompt Exposure Inventory.md` · `prompt治理/Prompt Disclosure Policy v0.3`（文件名仍为 `Prompt Disclosure Policy v0.1.md`）· `prompt治理/上线前改造清单 v0.4` · `prompt治理/竞品调研矩阵 v0.3`
> **落地路径**：`docs/specs/0.4.0/prompt-disclosure-redaction-spec.md`

---

## 0. TL;DR

1. **本 spec 只治理 ASCI 自己造成的披露面，不治理 prompt 进入模型厂商请求体这一事实。** BYO-key / SDK 直连形态下，master prompt、capability prompt、subagent prompt 进入 provider request 是供应商协议与未来网关问题；本 spec 解决的是 debug copy、permission IPC、能力包 UI、导出、日志、第三方 telemetry 等产品出口。
2. **默认策略是“用户看得见行动和证据，看不见内部 prompt 全文”。** 科研工作流应展示 query strategy、source、filters、counts、screening/exclusion、citations 和高层计划；不展示完整 orchestrator/subagent/judge/ranking prompt、hidden chain-of-thought、raw tool payload、secret。
3. **统一 L0-L4 分级，但实现上分层而不是一个 redactor 包办一切。** shared 只提供同步脱敏原语、分类、占位符格式化；main 负责 toolPreview/export/debug formatter、hash/fingerprint、审计落盘；renderer 只保留 Sentry/telemetry 自洗与渲染已脱敏 DTO。
4. **复用现有 telemetry 脱敏基建，不另造旁路。** `packages/shared/src/telemetry/redact.ts`、`event-registry`、Zod strip schema、Sentry/PostHog sender 是现有事实源；本 spec 扩展它们覆盖 secret、metadata、error context 和第三方 payload，同时避免把 UI 摘要 formatter 与 telemetry 正则脱敏耦合成一个函数。
5. **上线门禁优先级明确。** P0 先落最小 redaction foundation、minimal prompt fingerprint helper、DebugCopy/Permission/AskUser/ExitPlan/Capability UI/telemetry/error/export；P1 做完整 prompt registry、发布产物扫描、SDK/plugin 注入面核实、stderr redaction 与治理增强。

---

## 1. 背景与目标

ASCI 即将面向用户开放。当前 prompt 治理问题不应混成一个“prompt 泄露”概念，而要拆成五条不同的数据面：

| 数据面 | 本 spec 是否治理 | 说明 |
|---|---:|---|
| Provider request / 模型厂商请求体 | 否 | 由 DPA、ZDR、数据留存、未来 prompt gateway 治理。 |
| 产品用户面 | 是 | 对话 UI、能力包配置页、权限弹窗、debug copy、普通导出。 |
| 本地诊断面 | 是 | 应用日志、session stderr、trace/debug payload、本地 JSONL。 |
| 客户端资源面 | 是 | Electron resources、default capability packs、default skills、manifest、prompt `.md`。 |
| 第三方 telemetry 面 | 是 | analytics、observability、session replay、error monitoring、LLM request analytics。 |

### 1.1 设计目标

| 目标 | 判据 |
|---|---|
| 产品用户面收口 | 普通 UI / debug copy / 普通导出不出现 master/subagent prompt body、raw tool I/O、thinking、secret。 |
| IPC 边界收口 | renderer 不再接收 raw `PermissionRequest.toolInput`、`AskUserRequest.toolInput`、`ExitPlanModeRequest.toolInput`。 |
| 第三方 payload 最小化 | 第三方只收到 allowlist 字段；禁止 raw prompt、raw user prompt、完整 search query、raw tool I/O、thinking、路径、secret。 |
| 可审计 | main 编排层输出 `hash`、`bytes`、`redactionMatches`，并节流写 `{ route, ruleName, category, action, runId, ts }`；shared 纯函数不写盘。 |
| 不牺牲科研透明度 | 用户仍能看到研究目标、query strategy、source/filter、screening/exclusion、citations、方法摘要和风险。 |

### 1.2 Non-scope

- 不解决 prompt 在 provider request 中对模型厂商可见的问题。
- 不承诺通过客户端硬化、ASAR、混淆实现 prompt IP 保密。
- 不把“模型不会复述 prompt”作为安全保证。
- 不在本 spec 内设计服务端 prompt gateway；若决策要做，另起 `prompt-gateway-impl-spec.md`。
- 不重构 telemetry 架构；只扩展现有 redaction / allowlist / schema。

---

## 2. 根本原则

1. **隐藏 prompt 不是安全边界。** 真正安全边界来自 sandbox、权限审批、密钥隔离、网络/文件系统策略、日志脱敏、访问控制。
2. **真正敏感的信息不应进入 prompt。** API key、token、cookie、Authorization、env value、内部 endpoint、完整权限绕过规则必须由代码和 secret store 隔离。
3. **用户需要理解“AI 做了什么”，不是看到内部动机全文。** 展示行动、证据、计划、来源、风险、筛选理由；隐藏完整 prompt body、judge rubric、ranking/scoring 细节。
4. **发到 renderer 的数据视同用户可见。** 不能把 raw payload 发给前端后再依赖组件“不展示”。
5. **第三方平台不是内部系统。** Dashboard、export、alert、session replay、support workflow 都按外部披露面治理。
6. **脱敏必须在离开安全边界前完成。** renderer IPC、UI payload、debug copy、export、telemetry、error monitoring 都要在出口前经过对应的分层 redaction/formatter；不要把产品摘要、诊断格式化、telemetry 正则脱敏合并成一个 mode 大函数。
7. **脱敏不是静默删除。** 用 `[REDACTED]`、`[[REDACTED:path]]`、`[[PROMPT:sha256:abcd@v7]]` 标记隐藏原因。
8. **客户端资源默认可被用户读取。** 打包进 Electron resources 的 capability prompt、skill prompt、manifest 不能承载必须保密的 L3 IP。
9. **SDK/plugin 注入面必须单独实测。** ASCI inventory 只能覆盖自有 prompt；SDK、plugin、skill 可能额外注入上下文。

---

## 3. 分级定义

| 等级 | 含义 | ASCI 具体内容 | 默认行为 |
|---|---|---|---|
| **L0 用户可见** | 用户内容与最终产物 | 用户输入、最终回答、引用证据、可执行计划摘要、工具动作摘要、权限选择结果、capability `summaryI18n` | 展示、复制、普通导出 |
| **L1 可解释摘要** | 对内部行为的意图级说明 | capability 名称、subagent 职责一句话、为什么调用工具、风险提示、source availability presence/status | 展示摘要，不展示原 prompt |
| **L2 受控诊断** | 调试/支持所需执行细节 | tool input/output redacted preview、route reason、dispatch prompt preview、prompt hash/version、latency/token、query/source 诊断摘要、error class | 仅诊断态或管理员可见，必须脱敏；第三方只收 allowlist |
| **L3 内部保留** | 内部策略全文与 prompt IP | master prompt、scenario/subagent prompt、`scenarioAgent.description` routing text、judge rubric、ranking/scoring prompt、anti-injection red-lines、完整 SKILL.md prompt | 不展示、不进普通 debug/export/telemetry；只暴露 id/version/hash |
| **L4 永不记录** | 凭证与隐私高危内容 | API key、token、cookie、Authorization、env value、secret 文件内容、私密路径、原始身份标识 | 不展示、不导出、不上传；强制 redacted |

跨级规则：

- 不确定时按更严格等级处理。
- L3 可派生 L1 摘要，但摘要不得可逆还原原文。
- 同一对象在不同面等级不同：tool I/O 在用户 UI 是 L0/L1 动作摘要，在诊断态是 redacted L2，在第三方 telemetry 只能是 allowlist 后的摘要/hash/stat。

---

## 4. 默认行为矩阵

| 披露面 | L0 | L1 | L2 | L3 | L4 |
|---|---|---|---|---|---|
| 对话 UI | 展示 | 展示摘要 | 不展示 | 不展示 | 不展示 |
| 计划/动作摘要 | 展示 | 展示 | 不展示 raw payload | 不展示 | 不展示 |
| Research provenance panel | 展示目标、source、filters、counts、citations、exclusion | 展示方法摘要 | 仅 redacted query/hash/stat | 不展示 ranking prompt | 不展示 |
| 能力包配置页 | 展示 `summaryI18n` / public summary | 展示职责摘要 | 不展示 raw metadata | 不展示 `scenarioAgent.description` / promptPath 全文 | 不展示 |
| 权限弹窗 | 动作摘要 | 风险/原因摘要 | 参数 redacted preview | 不展示内部规则/prompt | 不展示 |
| AskUser / ExitPlan | 用户问题、允许选择 | 高层计划摘要 | 不下发 raw `toolInput` | 不展示 routing prompt | 不展示 |
| Debug copy 普通模式 | 可复制 | 可复制 | 不复制原始值 | 不复制 | 不复制 |
| Debug copy 诊断模式 | 可复制 | 可复制 | redacted preview/hash | 只 hash/version | redacted |
| 普通会话导出 | 展示 | 摘要 | 不含 L2 raw | 不含 L3 | 不含 L4 |
| 第三方 telemetry | 匿名事件字段 | allowlist 摘要 | 仅 redacted/hash/stat | 不发送 | 不发送 |
| Session replay | 页面级事件 | 可选 UI 区域信息 | 默认 mask 文本区 | 不录制 | 不录制 |
| Error monitoring | error class / stack hash | redacted context | redacted diagnostic | 不发送 prompt body | 不发送 secret |

---

## 5. 已确认暴露面与目标改造

完整 inventory 见工作底稿 `ASCI Prompt Exposure Inventory.md`。本节只列上线改造相关锚点。

| 来源 | 现状 | 目标 |
|---|---|---|
| `DebugCopyButton` / `format-turn-debug-content.ts` | 直接复制 thinking、tool input、tool result，未过 redactor。 | 拆 `user-safe summary` 与 `redacted diagnostic`；普通模式不含 L2 raw/L3/L4。 |
| `PermissionRequest.toolInput` | raw object 经 IPC 发到 renderer；未知工具 fallback 完整 JSON。 | main 生成 `toolPreview`；renderer 不持有 raw `toolInput`。 |
| `AskUserRequest.toolInput` / `ExitPlanModeRequest.toolInput` | raw input 进入 renderer DTO。 | renderer 只收 UI 必需字段；raw 留 main pending state。 |
| `CapabilityPackPanel` | 直接渲染 `scenarioAgent.description` routing prompt 全文。 | 生产 UI 只展示 `summaryI18n` / public summary；description 仅 LLM/诊断侧使用。 |
| `default-capability-packs` / `default-skills` | Electron build 配置会打包资源。 | 发布前扫描实际产物；不把客户端资源当保密边界。 |
| `agent-session-diagnostics.ts` | stderr chunk 原样落盘。 | append 前走 redactor；保留期与关闭开关。 |
| Third-party telemetry | 若上线团队埋点，可能外发 query/tool/error/session replay。 | event schema allowlist + redaction + DPA/retention/region/RBAC/opt-out/delete。 |
| SDK/plugin skill injection | 是否注入完整 SKILL.md / description 未实测。 | 用测试标记核实 provider/debug/export/telemetry 四个面。 |
| `zotero-article-generator` prompt version | 已有 `PROMPT_VERSION` 正例。 | 推广为 prompt registry / fingerprint helper。 |

---

## 6. 关键数据流与插入点

### 流 A：prompt → provider request（out of scope）

```text
buildSystemPrompt(ctx)
→ agent-orchestrator systemPrompt append
→ claude-agent-adapter sdkOptions.systemPrompt
→ sdk.query()
→ provider request
```

处理：只在 ASCI 侧记录 `promptId/version/hash/configFingerprint`；不把 prompt body 写入 debug/export/telemetry。厂商请求体可见性由供应商协议或未来 gateway 治理。

### 流 B：capability/subagent prompt → runtime context

```text
manifest.json promptPath
→ capability-pack-loader resolvePromptFile()
→ expandPromptTemplates()
→ buildSubAgentOutputLanguageSection()
→ SubagentRegistry
→ Task(subagent_type, prompt)
```

处理：这些 prompt 属 L3；默认资源打包可读性必须发布前扫描。如要 IP 硬控制，迁移到服务端注入或受控 registry；否则文档明确客户端可读。

### 流 C：capability manifest → 配置 UI

```text
manifest.json scenarioAgent.description
→ capability-pack-service list()
→ capability-pack IPC DTO
→ CapabilityPackPanel
```

处理：生产 UI 移除 routing prompt 全文，改用 `summaryI18n` / public summary；缺 summary 的内置 pack 在校验阶段失败。

### 流 D：tool / permission / debug copy

```text
tool_use input/result
→ DebugCopyButton
→ PermissionRequest
→ AskUserRequest / ExitPlanModeRequest
```

处理：debug copy 走 formatter；permission/ask/exit 由 main 生成 redacted preview，renderer 不接 raw input。

### 流 E：产品埋点 → 第三方平台

```text
workflow/tool/error/latency/source status
→ telemetry event builder
→ allowlist + redaction
→ analytics / observability / replay / error monitoring
```

处理：第三方 payload 只包含 allowlist 字段，且字段标注 L0-L4、发送目的、保留期、是否可导出、是否进告警。

---

## 7. 与现有 telemetry 架构的关系

本 spec 扩展而非替换 ADR-011 / `telemetry-spec.md`。

| 现有能力 | 位置 | 扩展 |
|---|---|---|
| 文本脱敏原语 | `packages/shared/src/telemetry/redact.ts` `redactText` | 增加 secret/token/cookie/Authorization/private key/env/path/query/prompt-marker 分类；保持同步纯函数。 |
| 深度对象脱敏原语 | `redactDeep` | 只作为任意嵌套对象的字符串叶子兜底；不承担 tool 语义摘要、导出格式化、prompt fingerprint。 |
| Sentry event 脱敏 | `scrubSentryEvent` | main 与 renderer beforeSend 共用；扩展到 secret/tool args/prompt marker/error context。renderer 事件 envelope 不过 main beforeSend，renderer 必须自洗。 |
| 事件白名单 | `event-registry.ts` | 字段增加 L0-L4、purpose、retention、exportable、alertable。 |
| Zod strip schema | `schema/telemetry/*.schema.json` | 新增 prompt/agent 字段只允许 id/version/hash，不允许 body。 |
| consent / 地域判定 | `consent.ts` | 复用；session replay 默认随 consent 关。 |
| 本地 JSONL 缓冲 | `apps/electron/src/main/lib/telemetry/jsonl-buffer.ts` | 可复用为 redaction audit sink；只由 main 编排层写入，renderer 不直接落盘。 |

沿用 telemetry 红线：不采集文献全文 / PDF / 笔记原文 / 对话原文 / 检索词 / API Key / 邮箱 / 用户名 / 含用户名路径。

本 spec 追加红线：不采集 master/subagent prompt body、raw `toolInput`/tool result、assistant thinking、完整 query、未脱敏路径、scenario routing text、SDK/plugin 注入的完整 skill prompt。

---

## 8. Redaction / Formatter 分层设计

### 8.1 分层边界

不要把“产品摘要化”和“telemetry 字符串脱敏”塞进同一个函数。目标分三层：

| 层 | 所在 | 职责 | 不做 |
|---|---|---|---|
| Shared redaction primitives | `packages/shared/src/telemetry/redact.ts` | 同步纯函数：文本/对象兜底脱敏、敏感分类、占位符拼装、Sentry scrub helper | 不算 hash、不写 JSONL、不理解具体 tool 语义、不生成 UI DTO |
| Main disclosure formatter | `apps/electron/src/main/lib/...` | `toolPreview`、AskUser/ExitPlan safe DTO、export/debug diagnostic formatter、prompt fingerprint、hash/bytes、redaction audit sink | 不把 raw payload 发到 renderer；不把 formatter 逻辑塞进 telemetry 正则 |
| Renderer safety net | `apps/electron/src/renderer/...` | 渲染 main 已脱敏 DTO；renderer Sentry `beforeSend` / `beforeBreadcrumb` 自洗；必要时 user-safe debug summary | 不持有 Permission/AskUser/ExitPlan raw `toolInput`；不负责生产诊断 hash |

现有证据约束：

- `@asci/shared` 的 `tsconfig` 继承根配置 `lib:["ESNext"]`，包职责是 shared 类型/纯函数；不应引入 `node:crypto`。
- `redactText` / `redactDeep` 当前是同步纯函数；如果改用 WebCrypto 会把调用链传染成 async，不适合现有 Sentry/telemetry beforeSend 路径。
- main 侧已有多处 `node:crypto` / `createHash` 先例，包括 `trace/trace-redactor.ts`；prompt/content hash 应在 main 编排层或调用方生成。
- renderer Sentry 明确有自己的 `beforeSend`，因为 renderer envelope 不再过 main beforeSend；所以 renderer 仍需要 shared redaction primitives，但只作为 telemetry/error safety net。

### 8.2 Shared 原语输出

```typescript
type RedactionCategory =
  | 'credential'
  | 'prompt-body'
  | 'tool-payload'
  | 'query'
  | 'home-path'
  | 'file-content'
  | 'pii'
  | 'thinking'
  | 'env-value'
  | 'unknown'

interface RedactionPrimitiveResult<T> {
  value: T
  redactionMatches: RedactionMatch[]
}

interface RedactionMatch {
  path: string
  category: RedactionCategory
  action: 'replace' | 'mark' | 'drop'
  ruleName: string
}

function formatPromptPlaceholder(input: {
  promptId: string
  version: string
  hash: string
}): string
```

shared 不生成 `hash` / `bytes`；需要 hash 的调用方在 main 层生成后再调用 `formatPromptPlaceholder()`。

### 8.3 Main 编排输出

```typescript
interface DisclosureFormatted<T> {
  value: T
  hash?: string
  bytes?: number
  redactionMatches: RedactionMatch[]
}

interface RedactionAuditEvent {
  route: string
  ruleName: string
  category: RedactionCategory
  action: string
  runId?: string
  ts: string
}
```

审计 sink：

- 只能由 main 编排层写入，renderer 不写 fs。
- 复用 `JsonlBuffer` 或同形追加 JSONL 缓冲，例如 `redaction-audit.jsonl`。
- 高频产品 formatter 要节流/采样，只记录规则命中摘要，不记录 raw sensitive value。
- shared 纯函数只返回 `redactionMatches`，不产生副作用。

占位符：

| 类别 | 占位符 |
|---|---|
| Prompt body | `[[PROMPT:sha256:<first16>@<version>]]` |
| Credential / env value | `[[REDACTED:credential]]` |
| Home path / private path | `[[REDACTED:path]]` |
| Tool payload | `[[REDACTED:tool-payload:<hash>]]` |
| Query | `[[REDACTED:query:<hash>]]` |
| File content | `[[REDACTED:file-content:<hash>]]` |
| PII | `[[REDACTED:pii]]` |
| Assistant thinking | `[[REDACTED:thinking]]` |
| Unknown sensitive | `[REDACTED]` |

### 8.4 Formatter 模式

| 模式 | 可用环境 | 内容 |
|---|---|---|
| User-safe summary | 所有环境默认 | 用户消息摘要、最终回答摘要、工具动作列表、错误摘要、event id。 |
| Redacted diagnostic | 受控诊断开关 | L2 redacted preview、hash、bytes、tool/action timing、redactionMatches。 |
| Full diagnostic dump | 禁止生产默认路径 | 即使显式开启，L3 仍只 hash/version；L4 永不出现。 |

---

## 9. Prompt Registry

每个 prompt source 必须有 registry entry。这里记录的是 **prompt body 源本身的最高敏感级**，不是用户可见摘要的等级；用户可见摘要另用 `summaryDisclosure` 表达。

```typescript
interface PromptRegistryEntry {
  promptId: string
  kind: 'master' | 'capability-scenario' | 'subagent' | 'skill' | 'judge' | 'article-generator'
  version: string
  hash: string
  label: 'production' | 'canary' | 'experiment'
  owner: string
  /** prompt body 源本身的最高敏感级；master/subagent/judge/完整 SKILL.md 通常都是 L3 */
  sourceMaxLevel: 'L2' | 'L3'
  /** 允许派生给用户或诊断面的摘要等级；不代表 body 可见 */
  summaryDisclosure: 'none' | 'L1-summary' | 'L2-redacted-preview'
  debugPolicy: 'summary-only' | 'hash-only' | 'redacted-preview'
  telemetryPolicy: 'id-version-hash-only' | 'redacted-summary-only' | 'never'
  configFingerprint?: string
}
```

要求：

- 第三方 telemetry、debug copy、普通导出只引用 `promptId/version/hash/label/configFingerprint`。
- registry 可用 `hash@version` 反查受控 prompt 源，但反查面不经客户端普通 UI 暴露。
- `zotero-article-generator` 的 `PROMPT_VERSION` 是现有正例，应抽象为 helper 后覆盖 master、dynamic context、capability scenario、subagent、judge/audit、article generator、SDK/plugin skill context。
- 若 SDK/plugin 注入内容不可完全枚举，至少通过测试标记给出“是否进入 provider / debug copy / 普通导出 / 第三方 telemetry”的证据。

P0 只要求 **minimal fingerprint helper**：main 可为已知 prompt 源生成 `promptId/version/hash/configFingerprint`，并确保所有出口只引用这些字段。完整 registry 后台、owner/label 管理、回滚和 canary 属 P1。

---

## 10. 实现计划

> 实现时遵守仓库版本规则：改到哪个包，该包 `package.json` patch 递增。若涉及 IPC，按 shared 常量/类型 → main handler/service → preload → renderer 四联同步。

### P0 · 上线门禁

| # | 改动 | 主要位置 | 验收 |
|---|---|---|---|
| P0-0 | 最小 redaction foundation：扩展 shared 同步脱敏原语/分类/占位符格式化；main 增 minimal prompt fingerprint helper、hash/bytes 计算、节流 audit sink。 | `packages/shared/src/telemetry/redact.ts` · main formatter/fingerprint helper · `JsonlBuffer` 同形 audit buffer | P0-1/2/5/7/8 可独立调用；shared 不引入 `node:crypto`、不 async、不写盘；main 能输出 hash/bytes/redactionMatches。 |
| P0-1 | Debug copy 拆 user-safe / redacted diagnostic formatter，复用 shared 原语；诊断 hash 由 main formatter 生成。 | `apps/electron/src/renderer/components/agent/DebugCopyButton.tsx` · `format-turn-debug-content.ts` · main debug/export formatter | 普通复制无 thinking 全文、raw tool input/result、system/subagent prompt、token/cookie/home path。 |
| P0-2 | `PermissionRequest` 增 `toolPreview`，移除 renderer-facing raw `toolInput`。 | `apps/electron/src/main/lib/agent-permission-service.ts` · `packages/shared/src/types/agent.ts` · `PreviewFormatters.ts` | IPC payload 无 raw `toolInput`；未知 MCP tool 显示 main 生成的 hash/bytes/redacted summary；approve 仍用 main 内部 raw input resume SDK。 |
| P0-3 | `AskUserRequest` / `ExitPlanModeRequest` DTO 移除 renderer-facing raw `toolInput`。 | `agent-ask-user-service.ts` · `agent-exit-plan-service.ts` · `packages/shared/src/types/agent.ts` | renderer state、debug copy、普通导出无 AskUser/ExitPlan raw input；SDK resume 不受影响。 |
| P0-4 | Capability 详情页不再展示 `scenarioAgent.description` routing prompt；生产内置包必须有 `summaryI18n` / public summary，禁止 fallback 到 description。 | `CapabilityPackPanel.tsx` · `capability-pack-utils.ts` · capability schema/loader | 配置页源码/界面无 description 原文渲染；缺 public summary 的生产内置 pack 校验失败或被隐藏为实验包。 |
| P0-5 | 第三方 telemetry event schema 标注 L0-L4、purpose、retention、exportable、alertable，并在发送前 redaction。 | `packages/shared/src/telemetry/event-registry.ts` · `redact.ts` · telemetry sender | 抓包/SDK hook 证明第三方 payload 无 raw prompt、raw tool I/O、thinking、完整 query、路径、secret。 |
| P0-6 | 若启用 session replay，默认 mask 敏感区域并随 consent 关。 | 第三方 replay 配置 · Data Collection settings | 回放样本无用户输入、prompt、论文摘录、权限参数、terminal/stdout/stderr 原文。 |
| P0-7 | Error monitoring 只传 error class、stack hash、build version、redacted context；main/renderer Sentry beforeSend 均复用 shared scrubber。 | Sentry beforeSend/breadcrumb · `redact.ts` | 构造 token/cookie/path/query/tool input 后，第三方后台只见 redacted/hash；renderer beforeSend 不依赖 main 二次处理。 |
| P0-8 | 普通导出与诊断导出分离。 | export formatter | 普通导出无 system/subagent prompt、ranking prompt、raw tool I/O、thinking、secret。 |

### P1 · 上线前应改

| # | 改动 | 主要位置 | 验收 |
|---|---|---|---|
| P1-1 | 完整 prompt registry：owner、label、canary/rollback、debug/telemetry policy 管理。 | registry types · `apps/electron/src/main/lib/*prompt*` | telemetry/debug/export 只引用 id/version/hash；可反查受控版本。 |
| P1-2 | 发布产物扫描 default packs/skills/manifest/prompt `.md` 可读性。 | `apps/electron/electron-builder.yml` · release script | 产物清单记录路径；敏感 prompt 不假设客户端不可读。 |
| P1-3 | `redLines` / `evidenceSchema` / `auditChecklist` 纳入 registry，只暴露 hash/version。 | `agent-prompt-builder.ts` | debug/export/third-party payload 无 rubric 全文。 |
| P1-4 | source availability 只注入 presence/status。 | `capability-pack-loader.ts` | 各 source 状态可见但无 key、secret、账号、内部 endpoint。 |
| P1-5 | SDK/plugin skill injection 实测。 | orchestrator plugin 注入面 | 报告明确 SKILL.md/description 是否进入 provider/debug/export/telemetry；若进入，只留 hash/version。 |
| P1-6 | session stderr append 前 redaction，增加保留期/关闭开关。 | `agent-session-diagnostics.ts` | stderr 样本无 key/token/cookie/home path；第三方 error payload 只含摘要。 |
| P1-7 | permission/hard rule 文案降到 L0/L1。 | `hard-permission-rules.ts` · i18n | 用户只看动作、风险、参数预览，不看完整规则库。 |
| P1-8 | redaction audit 治理增强：采样率、保留期、查询入口、告警阈值。 | main audit sink / local diagnostics | 触发脱敏后可审计，审计记录不含 raw sensitive value，且高频 formatter 不造成日志膨胀。 |
| P1-9 | prompt/result cache key 加 `redactionPolicyVersion`。 | prompt/result cache namespace | 策略版本改变后旧缓存不被复用。 |

### P2 · 上线后治理

| # | 目标 | 动作 |
|---|---|---|
| P2-1 | Day-2 竞品补测。 | Claude Code、Codex CLI、Gemini CLI、Cursor、OpenHands、Devin：导出 transcript、查看 debug log、询问 system prompt、观察 tool call UI、检查权限 prompt。 |
| P2-2 | Research provenance panel 产品化。 | 展示 query、source、filters、counts、screening/exclusion、citation links；raw payload 仍 redacted。 |
| P2-3 | 第三方 telemetry 最小化巡检。 | 定期抽样 dashboard/export/alert payload。 |
| P2-4 | RBAC / 团队权限产品化。 | 按 §13 六类角色落权限边界：普通用户、支持人员、管理员、开发者诊断态、prompt registry 运维、第三方平台账号。 |
| P2-5 | 精简 routing snapshot。 | 复核 master prompt 中 scenario/subagent 清单的最小必要字段。 |

---

## 11. 第三方 telemetry 字段边界

| 字段类别 | 可发送 | 不可发送 |
|---|---|---|
| 会话/用户标识 | 匿名 user/session id、tenant/workspace id hash、版本号、平台、地区粗粒度 | 邮箱、姓名、机构、精确路径、未哈希 workspace 名、可反推身份的项目名 |
| 研究 workflow | workflow type、step name、status、latency、token count、source name/status、result count、error class | 用户原始研究问题全文、完整 search query、论文全文片段、未脱敏 seed title、完整 source metadata |
| Prompt / agent | promptId、promptVersion、promptHash、capability id、subagent id | master/system prompt body、subagent prompt body、judge rubric、ranking prompt、SDK 注入的完整 skill prompt |
| Tool / MCP | tool name、operation class、success/failure、duration、bytes/hash、redacted preview | raw `toolInput`、raw tool result、MCP args/url 中的 secret/query/path、文件内容、shell output 全文 |
| Debug / reasoning | redactionMatches、error class、stack frame hash、diagnostic mode flag | assistant thinking、hidden chain-of-thought、debug dump 全文、raw runtime metadata |
| Secrets / credentials | presence/status，例如 `configured: true` | API key、token、cookie、Authorization、private key、env value、secret file path |
| Session replay | 默认关或 mask text inputs，只保留点击/页面级事件 | 对话输入框、prompt 编辑器、论文摘录、权限弹窗参数、terminal/stdout/stderr 原文 |

Redaction category 对齐：

| 红线内容 | `RedactionCategory` | 默认占位符 / 处理 |
|---|---|---|
| API key、token、cookie、Authorization、private key | `credential` | `[[REDACTED:credential]]` |
| env value / `ANTHROPIC_*` / cloud provider env | `env-value` | `[[REDACTED:credential]]` |
| master/subagent/judge/ranking prompt body | `prompt-body` | `[[PROMPT:sha256:<first16>@<version>]]` |
| raw `toolInput` / tool result / shell output | `tool-payload` | `[[REDACTED:tool-payload:<hash>]]` |
| 完整 search query / research question 动态 | `query` | `[[REDACTED:query:<hash>]]` |
| home/private path / secret file path | `home-path` | `[[REDACTED:path]]` |
| 文献全文 / PDF / 笔记原文 / 文件内容 | `file-content` | `[[REDACTED:file-content:<hash>]]` |
| 邮箱、用户名、可反推身份信息 | `pii` | `[[REDACTED:pii]]` |
| assistant thinking / hidden chain-of-thought | `thinking` | `[[REDACTED:thinking]]` |
| 未归类但疑似敏感 | `unknown` | `[REDACTED]` |

---

## 12. 权限、debug、导出规范

### 12.1 权限提示

权限弹窗展示：

- 工具名和动作类型。
- 风险级别。
- 命中规则的短原因。
- 脱敏后的参数预览，例如路径摘要、命令摘要、域名、写入范围。

权限弹窗不展示：

- 完整 internal prompt。
- 完整 hard rule 规则库。
- 原始 `toolInput` 全 JSON。
- env、token、cookie、Authorization、secret value。

### 12.2 Debug copy

普通模式默认只输出 L0/L1。诊断模式输出 redacted L2、hash、bytes、timing、`redactionMatches`。生产环境禁一键 full dump；debug copy 内容不得自动进入第三方 telemetry。

### 12.3 普通导出

普通导出只包含：

- 用户问题与最终回答。
- 方法/步骤摘要。
- query strategy 摘要。
- source/filter/counts。
- screening/exclusion decisions。
- citations / evidence links。

普通导出不包含：

- raw tool input/output。
- thinking / hidden CoT。
- master/subagent/judge/ranking prompt body。
- secret/path/env。
- SDK/plugin 注入的完整 skill prompt。

### 12.4 用户直接索要 system prompt 时的回复策略

允许：

- 解释 ASCI 的高层行为原则。
- 说明会调用哪些能力、工具、证据和权限边界。
- 提供 capability/subagent 职责摘要。
- 说明 source availability 的高层状态，例如“某数据源已启用/未配置”。

不允许：

- 输出完整 master prompt、subagent prompt、judge rubric、anti-injection 规则全文。
- 输出 prompt 的隐藏策略、绕过规则、scoring/ranking 细节。
- 输出任何 secret/env/token/path。
- 输出 `scenarioAgent.description` routing prompt 全文、promptPath 文件正文或 SDK/plugin 注入的完整 skill prompt。

建议话术：

> 我不能提供完整内部 prompt，但可以说明当前任务的高层执行策略、会调用的能力、权限风险和证据要求。

---

## 13. 角色可见性 / RBAC

| 角色 | 可见上限 | 说明 |
|---|---|---|
| 普通用户 | L0 + L1 | 行为、证据、计划、摘要。 |
| 支持人员 | L0 + L1 + event id | 不看 raw payload。 |
| 管理员 | L0-L2 脱敏 | 可看 redacted diagnostic、hash/version、脱敏审计。 |
| 开发者受控诊断 | L0-L2 脱敏 | L3 仍只 hash/version；L4 不可见。 |
| prompt registry 运维 | 可管理 L3 源 | 通过独立受控后台和审计，不经客户端披露面。 |
| 第三方平台账号 | 最小必要 L0/L1 + redacted L2 | 不得看到 L3/L4，不得有 raw text session replay。 |

L4 对所有角色不可见。

---

## 14. 竞品对标结论

`竞品调研矩阵.md` 支撑本 spec 的产品姿态：

- Agent harness 共识是“展示计划、动作、证据、风险；隐藏完整 system/developer prompt”。
- 科研产品共识是“报告化透明，不是后台 payload 透明”：展示方法、结果、来源、citations、筛选标准、exclusion decisions；隐藏 hidden prompts、model payload、ranking prompt、hidden chain-of-thought。
- Observability 产品已把隐藏 input/output、隐藏 metadata、masking function、固定占位符、prompt version/label 解耦做成标准能力。
- ASCI 不应承诺“所有 tool calls/raw payload 全可见”；更稳妥的是提供可复核 research log，并让 raw payload 进入 redacted diagnostic。

---

## 15. 测试与验收

| 测试 | 目的 | 验收 |
|---|---|---|
| Prompt exposure regression | master/subagent prompt、tool input/result、metadata 是否进 debug copy/普通导出/第三方 telemetry | 每项标“出现/不出现”证据；debug copy 与 telemetry 分别验收。 |
| Permission fallback | 未知 tool input 是否完整 JSON 展示 | 未知 tool 只显示 hash/bytes/redacted summary。 |
| Capability UI 暴露 | `scenarioAgent.description` 是否仍在配置页展示 | 生产 UI 不展示 routing prompt 全文。 |
| Redaction L4 | API key、Bearer token、cookie、home path、private key path、env key | 全部 redacted，审计可见 `redactionMatches`。 |
| 打包产物扫描 | `default-capability-packs`、`default-skills`、manifest、prompt `.md` 安装后可读性 | 产物清单记录路径；文档明确客户端可读为非保密边界。 |
| SDK/plugin skill injection | SKILL.md/skill description 是否由 SDK/plugin 注入 provider/debug/export/telemetry | 给出“进入/不进入”明确结论。 |
| Third-party telemetry payload | 拦截 analytics/observability/replay/error monitoring payload | 只含 allowlist 字段，其余 redacted/hash。 |
| 缓存策略版本 | 改 redaction policy version 后旧缓存不被复用 | cache key 含 `redactionPolicyVersion`。 |

上线门禁：

- [ ] 普通 debug copy 无 L2 raw / 无 L3 / 无 L4。
- [ ] 普通导出无 L2 raw / 无 L3 / 无 L4。
- [ ] Permission / AskUser / ExitPlan IPC 不向 renderer 发 raw `toolInput`。
- [ ] 能力包配置页不展示 `scenarioAgent.description` routing prompt 全文。
- [ ] 第三方 telemetry payload 只含 allowlist 字段，无 raw prompt/tool I/O/thinking/完整 query/路径/secret。
- [ ] 若启用 session replay，已 mask 对话输入、prompt 编辑器、论文正文、权限参数、terminal。
- [ ] Error monitoring 只传 error class、stack hash、build version、redacted context。
- [ ] 打包产物扫描完成，明确 `default-capability-packs` / `default-skills` 可读性。
- [ ] SDK/plugin skill injection 测试完成，debug copy、普通导出、第三方 telemetry 不含完整 skill prompt。
- [ ] 合并扫描：debug copy / 普通导出 / stderr / permission payload / 第三方 payload 中，master/subagent prompt 片段、凭证、隐私路径 0 命中。

---

## 16. 受影响包与版本号

| 包 | 改动面 | 版本号 |
|---|---|---|
| `packages/shared` | `redact.ts` 同步脱敏原语与 category/placeholder formatter、event registry 字段标注、permission/AskUser/ExitPlan DTO、hard permission 文案类型 | 实现 PR 中 patch +1 |
| `apps/electron` | main permission/ask-user/exit-plan service、capability loader、session diagnostics、prompt fingerprint helper、完整 prompt registry、debug/export/toolPreview formatter、redaction audit sink、renderer Sentry safety net 与 config UI | 实现 PR 中 patch +1 |
| `packages/ui` | 若抽公共 redacted preview 组件或 export formatter UI 才触及 | 触及时 patch +1 |

IPC 改动须四联同步：

1. `packages/shared/src/...`：通道常量 + 请求/响应类型。
2. `apps/electron/src/main/ipc.ts` / main service：handler 与服务逻辑。
3. `apps/electron/src/preload/index.ts`：context bridge。
4. `apps/electron/src/renderer/...`：atoms/hooks/components 调用。

---

## 17. 后续文档同步

若本 spec 进入仓库并实现功能变更，需要向维护者确认是否同步：

- `CONTEXT.md`：补 L0-L4、redaction、prompt registry 术语。
- `README.md`：补数据披露与本地优先/第三方 telemetry 红线。
- `AGENTS.md`：只在需要新增长期硬约束时更新；修改前必须征得用户允许。
