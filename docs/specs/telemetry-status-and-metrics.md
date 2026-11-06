# 埋点能力现状 × 目标看板指标对照

> **状态**：现状盘点（对照 0.3.0 milestone 埋点 issue 与数据看板目标）
> **关联 issue**：[#416](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/416) Sentry · [#426](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/426) PostHog 行为 · [#427](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/427) 自进化信号
> **关联文档**：[ADR-011 遥测架构](../adr/ADR-011-telemetry-architecture.md) · [telemetry-spec](./telemetry-spec.md) · `~/Downloads/埋点/格物0.3-PostHog埋点Spec-v0.4.3.md`（dashboard 目标 Spec，38 事件）
> **数据源现状**：PostHog Cloud EU，distinct_id = 本地匿名 deviceId（#420 登录未落地，尚未按账户归属）

---

## 一、三个 issue 的实现状态

| Issue | 内容 | 状态 | 说明 |
|-------|------|------|------|
| **#416** | Sentry 崩溃上报 + 脱敏 | ✅ **已支持** | main+renderer 双进程，beforeSend 脱敏（邮箱/IP/路径用户名段）；DSN 已配 |
| **#426** | PostHog 行为埋点 + 数据采集 tab + 地域 opt-in/out | 🟡 **部分支持** | 架构+6 个事件+consent tab+时区地域判定已落地；事件清单远少于看板所需（6 vs 38） |
| **#427** | 自进化 5 类信号 + 独立通道 + toggle | 🟡 **部分支持** | schema+采集+本地 JSONL+toggle 已落地；**上报通道等后端（ADR-002 未拍板）**，且走独立通道不进 PostHog |

---

## 二、当前已上报的数据（事实清单）

### 2.1 PostHog 行为事件（6 个）→ 进 PostHog，可做看板

| 事件 | 属性 | 触发点 |
|------|------|--------|
| `app_launched` | `appVersion` / `platform` / `uiLocale` | 主进程 app ready |
| `profile_created` | （空） | 本地档案首次创建 |
| `login_completed` | （空，**占位未接**） | 等 #420 登录 |
| `search_executed` | `source` / `resultCount` / `durationMs` / `success` | 检索结果落库 |
| `review_generated` | `paperCount` / `durationMs` / `success` | 综述实体化成功 |
| `agent_task_completed` | `numTurns` / `durationMs` / `success` / `resultSubtype` / `modelId` / `channelType` | 一次 runAgent 结束 |

**公共维度**：`distinct_id` = 登录后账户 uid（OPENSCI uid，#420），未登录回落匿名 deviceId。
**账户归属已接**（登录成功 `$identify` 合并匿名历史 + `$set` person 属性 `institution` / `discipline` / `signup_method`）。仍缺：`current_activation_level` / `pmf_status` / `install_source`（属漏斗/召回事件，另议）。

### 2.2 自进化信号（5 类 + 隐式反馈）→ 走独立通道，**不进 PostHog**

落本地 `~/.asci/telemetry/signals.jsonl`，endpoint 未配则不外发（后端未建）。

| kind | 字段 |
|------|------|
| `task_structure` | promptChars / attachmentCount / mentionedSkillCount / numTurns / durationMs / success |
| `tool_usage` | toolName / success / durationMs |
| `model_choice` | modelId / channelType |
| `error_event` | stage / message(脱敏) / retryable |
| `workspace_structure` | workspaceHash / sessionCount / paperCount / noteCount |
| `implicit_feedback` | action(copy/save/cite/discard/retry) / target |

### 2.3 Sentry → 崩溃/异常 + 堆栈（脱敏）

---

## 三、目标看板指标 × 能否算出 × 如何加工

目标 = `格物0.3-数据看板预览` 的 8 块看板。下表按"现有数据能否支撑"分三档。

### ✅ A. 现在就能算（用已上报的 6 事件 + Sentry）

| 目标指标 | 用什么 | PostHog 加工方式 |
|----------|--------|------------------|
| DAU / WAU / MAU | `app_launched` | Trends → unique users（distinct_id 去重），按日/周/月 |
| 版本 / 平台 / 语言分布 | `app_launched.appVersion/platform/uiLocale` | Trends breakdown by 属性 |
| 检索次数 / 成功率 | `search_executed` (+`success`) | Trends 总数 + `success=true` 占比 |
| 检索来源分布 | `search_executed.source` | breakdown by source |
| **检索 TTLT P90**（§9.3） | `search_executed.durationMs` | Trends → 属性数值 P90（检索不流式，durationMs 即 TTLT）✅ 完全对齐 |
| 综述次数 / 成功率 | `review_generated` (+`success`) | 同上 |
| 综述论文数分布 | `review_generated.paperCount` | 直方图 / 平均 |
| **综述 TTLT P90**（§9.3） | `review_generated.durationMs` | P90（≈全程时长；见下"近似"注意） |
| Agent 任务量 / 成功率 / 轮次 | `agent_task_completed` | Trends + breakdown |
| **模型选型分布**（§9.8 单维） | `agent_task_completed.modelId` / `channelType` | breakdown by modelId |
| 崩溃数 / 崩溃率 / 按版本平台 | Sentry | Sentry Issues + release/tag 维度 |

### 🟡 B. 部分能算 / 只能近似（缺分层或精确字段）

| 目标指标 | 现状 | 缺口 |
|----------|------|------|
| 整体留存（D1/D7/D30） | `app_launched` 可做 PostHog Retention | ✅ 整体留存能做；但**无法按 L0/L2/L3 分层**（§9.2 留存对照做不了，缺 `current_activation_level`） |
| 激活漏斗（粗） | `profile_created → search_executed → review_generated` 可拼 3 步漏斗 | **不是 §9.1 的 L0→L3 阶梯**：缺 `first_l{n}_reached` 去重派生、L2(写 Note)/L3(建 EvidenceSet) 事件；现有漏斗每步可重复计数、非"首次达成" |
| 综述 TTLT | `review_generated.durationMs` | 是否严格等于"提交→全部 token"取决于打点位置，需核对；当前为综述实体化耗时，可能含落盘 |
| 新增用户近似 | `profile_created` | 非真实注册（#420 登录未落地）；登录后应改用 `login_completed` + 账户 distinct_id |

### ❌ C. 现在算不出（缺事件 / 缺字段 / 缺后端）

| 目标看板 / 指标 | 缺什么 | 要补的事件或字段 |
|----------------|--------|------------------|
| **§9.1 L0→L3 阶梯漏斗** | 阶梯派生 + L2/L3 动作 | `first_l0/l2/l3_reached`（去重派生）、`note_created`、`evidence_set_created`、`current_activation_level`(person prop) |
| **§9.2 阶梯留存对照** | 分层维度 | person property `current_activation_level` |
| **§9.3 假成功率** ⭐ | 产物质量判定 | `review_generated` 加 `output_complete` + `claim_count` / `cited_paper_count`；`skill_execution_incomplete`(H2) + `incompleteness_type` |
| **§9.3 综述 TTFT P90** ⭐ | 首 token 时点 | 新事件 `synthesis_first_token_received.ttft_ms`（现有只有全程 durationMs，无首 token） |
| **§9.3 综述放弃率 / 路由准确率 / 报告投递率** | 对应事件 | `synthesis_abandoned`、skill 路由事件(H1)、`*_report_rendered` |
| **§9.4 L2 气泡 A/B** | 实验框架 | `note_prompt_shown` + `experiment_exposed` + PostHog Feature Flags 接入 |
| **§9.5 渠道 / Referral** | 获客 + 邀请 | person `install_source`、`invite_sent/accepted`(I 组) |
| **§9.6 召回 / PMF** | J 组 | `inactive_user_detected` / `recall_message_*` / `pmf_survey_answered` + person `pmf_status` |
| **§9.7 工作循环闭合（复用率/二次唤起/散点）** | 跨期引用 + 后端 | `seeded_from_*` / `references_*` / `source_note_ids` / `evidence_set_opened` + **服务端 24h 跨期 join**（ADR-002 后端未建） |
| **§9.8 产物评价（点赞拉踩双维）** | claim 级评价 | `claim_feedback`(N1/N2) + `workflow_path` 维度（现有只有 modelId、无 workflow_path、无 claim 级赞踩） |
| **任意 breakdown by 学科/来源/注册方式** | person properties | `identify` + install_source / discipline / signup_method |
| **隐式反馈进看板** | 通道错位 | 现有 `implicit_feedback` 走自进化通道(本地 JSONL)，**不在 PostHog**；要进看板需另发 PostHog 事件或接通自进化后端 |

---

## 四、关键结论与差距根因

1. **能立刻产出的看板**：基础健康度（DAU/WAU、检索/综述/任务的量与成功率、检索 TTLT、模型分布、崩溃率）——用现有 6 事件 + Sentry 即可在 PostHog 配出。
2. **dashboard 大部分高级看板缺事件**：现状 6 个行为事件 vs Spec 目标 38 个 + 3 派生。漏斗（L0-L3）、留存分层、假成功率、TTFT、A/B、Referral、PMF、产物评价**都缺对应事件/字段**。
3. **三个结构性根因**：
   - **无 person properties / 无账户归属**：distinct_id 仍是匿名 deviceId（#420 登录未落地），无法按账户去重、无法 `current_activation_level` 分层、无法按学科/来源 breakdown。
   - **闭环 §9.7 强依赖后端**：24h 跨期 join / `is_cross_session` 派生 PostHog 原生做不到，依赖 ADR-002 服务器栈（未拍板）。
   - **自进化信号与 PostHog 通道隔离**：隐式反馈在自进化通道（本地 JSONL，后端未建），dashboard（PostHog）当前取不到。

---

## 五、要补齐到目标，按优先级的工作项

1. **接 person properties + 登录归属**（依赖 #420）：`identify` + install_source/discipline/signup_method/current_activation_level → 解锁留存分层、漏斗去重、breakdown。
2. **扩 PostHog 事件清单（6 → Spec 的 A/B/C/D/E/F/H 组核心）**：补 `first_l{n}_reached`、`note_created`、`evidence_set_created`、`synthesis_first_token_received`、`synthesis_abandoned`、skill 路由/投递事件、`review_generated` 加 `output_complete`/`claim_count`（假成功率）。
3. **A/B（§9.4）**：接 Feature Flags + `experiment_exposed`（0.3 Spec 标 W3，可后置）。
4. **闭环（§9.7）**：等 ADR-002 后端，补 `seeded_from_*`/`references_*`/`evidence_set_opened` + 服务端跨期 join。
5. **Referral/PMF/召回（§9.5/9.6）**：0.3 暂缓（Spec 已明示）。

> 详细的事件字段定义以 `格物0.3-PostHog埋点Spec-v0.4.3.md` 为准；本表只做"现状 → 目标"的差距对照。
