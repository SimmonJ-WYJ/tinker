# 连发消息排队 / 打断 Spec（Conversation Message Queue & Interrupt）

> **状态**：草稿 · 待 review
> **关联 issue**：#450（[ops-feedback] 连续发送多条指令时只回复最后一条，前面指令被吞掉）
> **关联 PR**：待开
> **领域语言事实源**：本 spec §1（排队 / 软中断 / 打断重定向）

---

## 1. 背景与问题

用户在会话中**连续发送多条指令**（不等 Agent 上一条回复完就接着发），当前实现把每一条新消息都走 `queueAgentMessage({ interrupt: true })`——即**无差别软中断**当前 turn 并用新消息替换。

后果：N 条连发 = N-1 次软中断，**只有最后一条幸存**，前面的指令"发了但没有产出"。这对「渐进修正」（换主题/改数量）是对的行为，但对**多条独立任务**就是 #450 描述的 bug。

实测确认（DeepSeek-V4-Pro，2026-06-10）：连发 3 条递进修正，日志出现 2 次「已软中断当前 turn」+ 2 次「追加消息已注入 interrupt=true」，最终收敛到最后一条。

### 1.1 领域语言

- **排队（Queue / FIFO）**：新消息压入 SDK 消息通道但**不打断**当前 turn，当前 turn 跑完后由 SDK 按序自动消费。多条连发依次执行，无一被吞。
- **软中断（Soft Interrupt）**：调用 SDK `query.interrupt()` 让当前 turn 在干净边界收尾并 yield 一个 aborted result，**保留子进程与会话上下文**，新消息成为下一轮输入。非硬终止。
- **打断重定向（Interrupt & Redirect）**：用户主动「改主意/换方向」时，软中断当前 turn 并让新消息立即作为下一轮——即现状的默认行为，v1 改为显式触发。

### 1.2 关键技术前提（均已具备）

- `claude-agent-adapter.sendQueuedMessage()` 把消息压入通道；**不调 `interruptQuery` 即天然 FIFO 排队**。
- SDK 消息带 `priority` 字段：`'now'` 抢占、普通优先级按序。
- IPC 四联（`AgentQueueMessageInput.interrupt` → `queueMessage(opts.interrupt)` → preload → renderer）**已存在**，现仅被写死成 `true`。
- orchestrator 每轮 user-turn 入口发布 `resolved_language` 事件（`agent-orchestrator.ts:1307`），可作「新一轮开始」tick。

---

## 2. 行为规格（BDD）

### 场景 A — 默认排队（最常见）
> **假设** Agent 正在跑第 1 条任务
> **当** 用户输入第 2 条并按 **Enter**
> **那么** 第 2 条进入 FIFO 队列、标记「排队中」，**不打断**第 1 条；第 1 条跑完后 SDK 自动消费第 2 条；多条连发依次执行，**没有任何一条被吞**

### 场景 B — 显式打断重定向
> **假设** Agent 正在跑第 1 条任务
> **当** 用户按 **⌘+Enter**（Windows/Linux 为 **Ctrl+Enter**）
> **那么** 软中断当前 turn（上下文不丢），新消息以 `priority:'now'` 立即成为下一轮

### 场景 C — 排队中可见
> **假设** 存在排队消息
> **那么** 它在对话流里正常显示但带「排队中」徽标/弱化样式；轮到它真正开始执行时，徽标消失、转正常运行态

### 场景 D — 打断时已有队列
> **假设** 队列里已排了 B、C（队头为 B）
> **当** 用户 ⌘+Enter 发了 D
> **那么** D 软中断当前 turn 并**插到队头**立即跑，B、C **保留**，最终执行顺序为 D → B → C（不静默丢弃用户已排的消息）

---

## 3. 架构落点（5 处）

| # | 文件 | 改动 |
|---|------|------|
| 1 | `AgentView.handleSend`（renderer） | `streaming` 分支按键位决定 `interrupt`：Enter ⇒ `false`、⌘/Ctrl+Enter ⇒ `true`。`interrupt:false` 时把 synthetic 消息标记为「排队中」并压入渲染层队列态 |
| 2 | 输入框 keydown 入口 | 在现有 Enter→handleSend 处加分支区分 Enter（排队）与 ⌘/Ctrl+Enter（打断），仅在 `streaming` 时这两者语义不同 |
| 3 | `queueMessage`（orchestrator） | `priority` 区分：打断走 `'now'`（现状），排队走普通优先级，保证 FIFO 按序而非抢占 |
| 4 | 渲染层队列态 | 新增 per-session「排队中 uuid 有序列表」atom；徽标渲染；turn-start tick 出队队头；硬 Stop 清空 |
| 5 | i18n | 流式时输入框提示文案（`Enter 排队，⌘+Enter 打断`）+「排队中」徽标 label，en/zh 同步 |

### 3.1 徽标清除信号

- 发送排队消息（`interrupt:false`）时，把其 uuid **按序压入**渲染层 `queuedUuids[sessionId]`，对应消息显示「排队中」。
- FIFO 保证顺序：每次收到新一轮 turn-start tick（`resolved_language` 事件），**出队队头**（清该条徽标，转正常运行态）。
- 无需把 uuid 透传进 SDK 回显做精确匹配——靠 FIFO 顺序 + 逐轮 tick 出队即可，简单且健壮。

### 3.2 打断插队（场景 D）

- ⌘+Enter 发送 ⇒ `queueMessage({ interrupt: true })`，priority `'now'`，软中断当前 turn。
- 渲染层队列态：D 的 uuid 插入 `queuedUuids` **队头**（B、C 顺延），保证徽标出队顺序与实际执行顺序（D→B→C）一致。

---

## 4. 边界处理

| 边界 | 处理 | 理由 |
|------|------|------|
| **附件 + 排队** | v1 维持现状：排队仅纯文本，带附件时沿用现有 toast 提示 | 附件排队需先存文件到 session 目录，属独立工作量；YAGNI，标记 future |
| **硬 Stop 时的队列** | 点 Stop（硬停）→ 清空该会话 `queuedUuids` + 清掉所有「排队中」徽标 | 硬停=放弃整条，残留排队消息会变孤儿 |
| **运行中出错/重试** | 软重试不杀通道 → 队列保留；仅终态错误才连同队列一起清 | 自动重试对用户透明，不该误清排队意图 |
| **连发上限** | 不设硬上限 | 自然行为，每条都持久化，无溢出风险 |
| **切会话/关 tab** | 队列 per-session 跟随，不跨会话 | 与现有 per-session 状态一致 |

---

## 5. 测试

- **orchestrator 单测**：`queueMessage({interrupt:false})` 不调 `interruptQuery`、消息以普通优先级入通道；`{interrupt:true}` 才软中断且 priority `'now'`。
- **渲染层单测**：排队 uuid 有序入队；turn-start tick 出队队头；打断时 D 插队头；硬 Stop 清空队列。
- **手动 golden path**：连发 3 条**独立任务**（创建文件 / 查日期 / 列 PDF）→ 三条依次执行且都有产出（#450 复现验证）；再测 ⌘+Enter 打断重定向仍生效。
- **i18n**：设置页切 zh↔en，输入框提示 + 徽标无 raw key（`key-parity` 守门）。

---

## 6. 非目标（v1 不做）

- 排队消息的**取消/撤回**（`cancelQueuedMessage` 桩保持不动）。
- 附件随排队消息发送。
- 自动判断「修正 vs 新任务」意图（#517 已论证不应依赖模型指令遵循做 harness 级保证，此处不引入脆弱的分类器）。
