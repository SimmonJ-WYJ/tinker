<a id="连发消息排队-&#45;打断-specconversation-message-queue-&#45;interrupt"></a>

# Consecutive-message queue / interrupt Spec (Conversation Message Queue & Interrupt)

> **Status**: Draft · Review pending
> **Related issue**: #450 ([ops-feedback] Only the last of consecutive instructions gets a reply; earlier instructions are swallowed)
> **Related PR**: To be opened
> **Domain-language source of truth**: §1 of this spec (queue / soft interrupt / interrupt and redirect)

---

<a id="1-背景与问题"></a>

## 1. Background and problem

When users **send consecutive instructions** in a session (without waiting for the previous Agent reply), the current implementation handles every new message with `queueAgentMessage({ interrupt: true })`: **indiscriminately soft-interrupting** the current turn and replacing it with the new message.

Result: N consecutive messages = N-1 soft interrupts; **only the final message survives**, with earlier instructions sent but producing nothing. This is correct for progressive corrections (changing topic/count), but for **multiple independent tasks** it is the bug described in #450.

Observed (DeepSeek-V4-Pro, 2026-06-10): Sending 3 progressive corrections logged 2 “Current turn soft-interrupted” and 2 “Additional message injected interrupt=true” entries (English translations), ultimately converging on the last message.

<a id="11-领域语言"></a>

### 1.1 Domain language

- **Queue / FIFO**: Push a new message into the SDK message channel **without interrupting** the current turn; SDK automatically consumes it in order after the current turn finishes. Consecutive messages execute sequentially, none lost.
- **Soft Interrupt**: Call SDK `query.interrupt()` to finish the current turn at a clean boundary and yield an aborted result, **retaining the subprocess and session context**; the new message becomes the next turn's input. Not hard termination.
- **Interrupt & Redirect**: When the user explicitly changes their mind/direction, soft-interrupt the current turn and immediately use the new message next; the current default becomes explicit in v1.

<a id="12-关键技术前提均已具备"></a>

### 1.2 Key technical prerequisites (all available)

- `claude-agent-adapter.sendQueuedMessage()` pushes into the channel; **omitting `interruptQuery` naturally gives FIFO queuing**.
- SDK messages have `priority`: `'now'` preempts, normal priority executes in order.
- The four-part IPC chain (`AgentQueueMessageInput.interrupt` → `queueMessage(opts.interrupt)` → preload → renderer) **already exists**, currently hardcoded to `true`.
- The orchestrator publishes `resolved_language` on each user-turn entry (`agent-orchestrator.ts:1307`), usable as a new-turn-start tick.

---

<a id="2-行为规格bdd"></a>

## 2. Behavior specification (BDD)

<a id="场景-a-&#45;默认排队最常见"></a>

### Scenario A — Default queue (most common)
> **Given** the Agent is running task 1
> **When** the user enters task 2 and presses **Enter**
> **Then** task 2 enters FIFO marked “Queued,” **without interrupting** task 1; SDK automatically consumes task 2 after task 1 finishes; consecutive tasks execute in order, **none swallowed**

<a id="场景-b-&#45;显式打断重定向"></a>

### Scenario B — Explicit interrupt and redirect
> **Given** the Agent is running task 1
> **When** the user presses **⌘+Enter** (**Ctrl+Enter** on Windows/Linux)
> **Then** soft-interrupt the current turn (retaining context); the new message immediately becomes the next turn with `priority:'now'`

<a id="场景-c-&#45;排队中可见"></a>

### Scenario C — Visible queuing
> **Given** queued messages exist
> **Then** show them normally in the conversation with a “Queued” badge/muted styling; remove the badge and restore normal running state when execution actually starts

<a id="场景-d-&#45;打断时已有队列"></a>

### Scenario D — Interrupt with an existing queue
> **Given** B and C are queued (B first)
> **When** the user sends D with ⌘+Enter
> **Then** D soft-interrupts the current turn and **moves to the queue front** for immediate execution; B and C **remain**, producing order D → B → C (no silent loss of user-queued messages)

---

<a id="3-架构落点5-处"></a>

## 3. Architectural changes (5 locations)

| # | File | Change |
|---|------|------|
| 1 | `AgentView.handleSend` (renderer) | In the `streaming` branch, choose `interrupt` by shortcut: Enter ⇒ `false`, ⌘/Ctrl+Enter ⇒ `true`. With `interrupt:false`, mark synthetic messages “Queued” and append to renderer queue state |
| 2 | Input keydown handler | At existing Enter→handleSend entry, distinguish Enter (queue) from ⌘/Ctrl+Enter (interrupt); their semantics differ only during `streaming` |
| 3 | `queueMessage` (orchestrator) | Distinguish `priority`: interrupts use `'now'` (existing), queues use normal priority, ensuring FIFO rather than preemption |
| 4 | Renderer queue state | Add per-session ordered queued-uuid atom; render badges; dequeue head on turn-start tick; clear on hard Stop |
| 5 | i18n | Streaming input hint (`Enter 排队，⌘+Enter 打断`, meaning Enter queues, ⌘+Enter interrupts) + “Queued” badge label, synchronized en/zh |

<a id="31-徽标清除信号"></a>

### 3.1 Badge-clearing signal

- On queued sends (`interrupt:false`), **append uuid in order** to renderer `queuedUuids[sessionId]`; show “Queued” on that message.
- FIFO guarantees order: each new turn-start tick (`resolved_language` event) **dequeues the head** (clears its badge, switches to normal running state).
- No need to pass uuid through SDK echoes for exact matching; FIFO order + per-turn dequeue ticks are simple and robust.

<a id="32-打断插队场景-d"></a>

### 3.2 Interrupt insertion (Scenario D)

- Sending with ⌘+Enter ⇒ `queueMessage({ interrupt: true })`, priority `'now'`, soft-interrupting the current turn.
- Renderer queue state: Insert D's uuid at the **head** of `queuedUuids` (B and C shift back), aligning badge dequeue order with actual execution (D→B→C).

---

<a id="4-边界处理"></a>

## 4. Boundary handling

| Boundary | Handling | Reason |
|------|------|------|
| **Attachments + queue** | v1 keeps existing behavior: text-only queuing; attachments retain existing toast | Attachment queuing needs files saved to session directory first, separate work; YAGNI, mark future |
| **Queue on hard Stop** | Stop (hard stop) → clear session `queuedUuids` + all “Queued” badges | Hard stop abandons the entire chain; remaining queued messages would be orphaned |
| **Runtime error/retry** | Soft retries retain channel → retain queue; clear queue only with terminal errors | Automatic retries are transparent and must not incorrectly clear queued intent |
| **Consecutive-send limit** | No hard limit | Natural behavior; each message persists, no overflow risk |
| **Session switching/tab closing** | Queue follows its session, never crosses sessions | Consistent with existing per-session state |

---

<a id="5-测试"></a>

## 5. Tests

- **Orchestrator unit tests**: `queueMessage({interrupt:false})` does not call `interruptQuery` and inserts normal-priority messages; only `{interrupt:true}` soft-interrupts with priority `'now'`.
- **Renderer unit tests**: Ordered uuid enqueue; turn-start tick dequeues head; interrupt inserts D at head; hard Stop clears queue.
- **Manual golden path**: Send 3 **independent tasks** consecutively (create file / check date / list PDFs) → all execute in order with outputs (#450 reproduction validation); then verify ⌘+Enter interrupt/redirect remains effective.
- **i18n**: Switch zh↔en in settings; input hints + badges show no raw keys (guarded by `key-parity`).

---

<a id="6-非目标v1-不做"></a>

## 6. Non-goals (excluded from v1)

- **Cancel/withdraw** queued messages (`cancelQueuedMessage` stub unchanged).
- Send attachments with queued messages.
- Automatically classify correction vs new-task intent (#517 established that harness guarantees should not depend on model instruction-following; do not introduce a fragile classifier here).
