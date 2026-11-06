# 助手输出反馈按钮 Spec（Output Feedback Buttons Specification）

> **状态**：草稿 · 待 review
> **关联 issue**：#477（feat(conversation): 助手输出新增 👍/👎 反馈按钮）
> **关联 PR**：—（待开）
> **领域语言事实源**：本 spec §3 数据模型；术语收敛进 `CONTEXT.md` 待补
> **改动包**：`@asci/shared`（IPC 通道 + 类型）、`apps/electron`（renderer + main + preload）

---

## 1. 概述与目的

在每条助手消息底部的动作工具栏新增一对「👍 赞同 / 👎 不赞同」按钮，让用户一键表达对该条输出的**直观感受**，并把每次点击落盘。这是 ASCI 第一个面向"输出质量"的用户反馈采集入口，为后续评估输出质量、按维度（模型 / 能力包 scenario）切分分析提供第一手数据。

**设计判据**：零学习成本（图标自解释）、单击即可表态、不打断对话流；后端负责把"一次点击"沉淀为可分析的结构化事件。

### 1.1 不做的事（Non-scope）

- 反馈数据的聚合分析 / 看板 / 导出（后续 issue）。
- 「不赞同」追加原因输入框（先只做一键信号，二期再考虑二级输入）。
- 把反馈回流给 Agent 影响后续生成（纯采集，不闭环）。
- 跨设备同步 / 云端上报（先本地落盘）。

---

## 2. 交互规格

### 2.1 位置与顺序

渲染于 `apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx` 的 `<MessageActions>`（约 666–700 行），插入到 **`<CopyButton>` 之后**，其余按钮整体后移：

| 顺序 | 按钮 | 组件 / 图标 | 说明 |
|------|------|------------|------|
| 1 | 复制 | `CopyButton` | 不动 |
| **2** | **赞同** | **`MessageAction` + lucide `ThumbsUp`** | **新增** |
| **3** | **不赞同** | **`MessageAction` + lucide `ThumbsDown`** | **新增** |
| 4 | 加入证据集 | `AddToEvidenceSetButton` | 后移 |
| 5 | Debug 复制 | `DebugCopyButton`（dev-only） | 后移 |
| 6 | 分支 | `MessageAction` + `Split` | 后移 |
| 7 | 撤回 | `MessageAction` + `Undo2` | 后移 |

> 图标尺寸沿用现有 `className="size-4"`；两个新图标**必须**来自 lucide 库 <https://lucide.dev/icons/>（[`thumbs-up`](https://lucide.dev/icons/thumbs-up) / [`thumbs-down`](https://lucide.dev/icons/thumbs-down)），经 `lucide-react` 引入，不自绘、不引第三方图标库。

### 2.2 状态机（单条消息）

三态互斥单选：`none`（未表态，默认）→ `up` / `down`。

| 当前态 | 点击赞同 | 点击不赞同 |
|--------|---------|-----------|
| `none` | → `up` | → `down` |
| `up` | → `none`（取消） | → `down`（切换） |
| `down` | → `up`（切换） | → `none`（取消） |

- **选中态高亮**：选中的按钮用语义 token（如 `text-primary` / `text-foreground` + 实心填充态），未选中沿用工具栏默认的 `text-muted-foreground`；**禁止 Tailwind 调色板硬编码**（不写 `text-green-500` 等）。
- **乐观更新**：点击即切换 UI 状态，再异步落盘；写失败时回滚并通过现有 toast 提示（遵循"错误必须可见 + 引导行动"）。
- **回显**：切换会话 / 重开应用后，按 `sessionId` 拉取该会话已有反馈，回填每条消息的选中态。
- **粒度**：每条助手消息独立记录，互不影响。

---

## 3. 数据模型

### 3.1 落盘事件（append-only JSONL，一行一事件）

存储位置：`~/.asci/feedback/<sessionId>.jsonl`（dev 走 `~/.asci-dev/feedback/<sessionId>.jsonl`），与 `~/.asci/conversations/<id>.jsonl` 的按会话分文件模式对齐。**追加写**，包含切换 / 取消（`none`）在内的每一次变更都追加一行，保留完整轨迹；回显时按 `messageUuid` 折叠取**最后一条**。

```typescript
// packages/shared/src/types/output-feedback.ts
export type OutputFeedbackValue = 'up' | 'down' | 'none'

/** 落盘的单条反馈事件（append-only JSONL，一行一条） */
export interface OutputFeedbackEvent {
  /** 助手消息 uuid（折叠键；同一 uuid 取最后一条为当前态） */
  messageUuid: string
  /** 对应用户提问消息 uuid（可空：极端历史消息无配对提问） */
  userMessageUuid?: string
  /** Agent session id */
  sessionId: string
  /** workspace id（按 workspace 切分分析用，可空） */
  workspaceId?: string
  /** 反馈值；'none' 表示取消表态 */
  value: OutputFeedbackValue
  /** 事件写入时间，ISO 8601 */
  createdAt: string
  /** 可选维度：产出该消息的模型 id */
  model?: string
  /** 可选维度：能力包 scenario 标识 */
  scenario?: string
}

/** 回显：sessionId → { messageUuid → 当前态(up/down) }，none 不返回 */
export type SessionFeedbackMap = Record<string, Exclude<OutputFeedbackValue, 'none'>>
```

> 选型理由：反馈是**追加型事件日志**，符合 CLAUDE.md「追加型日志走 JSONL」约定；不是关系型 / 大量结构化数据，不引 SQLite。按会话分文件让回显只读单个小文件，避免全量扫描。

---

## 4. IPC 通道契约

新增通道常量 + 请求/响应类型，文件 `packages/shared/src/types/output-feedback.ts`（紧接 §3 类型）：

```typescript
export const OUTPUT_FEEDBACK_IPC_CHANNELS = {
  /** 写入/切换/取消一条反馈，返回折叠后的当前态 */
  SET: 'outputFeedback:set',
  /** 拉取某 session 的回显 map */
  GET_FOR_SESSION: 'outputFeedback:getForSession',
} as const

export interface OutputFeedbackSetInput {
  sessionId: string
  messageUuid: string
  userMessageUuid?: string
  workspaceId?: string
  value: OutputFeedbackValue
  model?: string
  scenario?: string
}
/** 返回折叠后的当前态（none → null，便于渲染端判断高亮） */
export interface OutputFeedbackSetResult {
  value: Exclude<OutputFeedbackValue, 'none'> | null
}

export interface OutputFeedbackGetForSessionInput {
  sessionId: string
}
export type OutputFeedbackGetForSessionResult = SessionFeedbackMap
```

记得在 `packages/shared/src/types/index.ts` re-export 新模块。

---

## 5. 四联同步落点（照文件改）

| # | 层 | 文件 | 改动 |
|---|----|------|------|
| 1 | shared | `packages/shared/src/types/output-feedback.ts` **(新建)** | §3 类型 + §4 通道常量与请求/响应类型 |
| 1' | shared | `packages/shared/src/types/index.ts` | `export * from './output-feedback.ts'` |
| 2 | main | `apps/electron/src/main/lib/output-feedback-service.ts` **(新建)** | `appendEvent(event)` 追加写 JSONL；`getSessionMap(sessionId)` 读文件折叠成 `SessionFeedbackMap`；目录不存在则懒建 |
| 2' | main | `apps/electron/src/main/lib/config-paths.ts` | 新增 `getOutputFeedbackDir()` → `~/.asci/feedback/`、`getOutputFeedbackPath(sessionId)` → `~/.asci/feedback/<sessionId>.jsonl`（仿 `getConversationMessagesPath`） |
| 2'' | main | `apps/electron/src/main/ipc.ts` | `ipcMain.handle` 注册两个通道，调用 service；外部调用 try/catch，失败向上抛 |
| 3 | preload | `apps/electron/src/preload/index.ts` | `contextBridge` 暴露 `outputFeedback: { set, getForSession }`（仿现有 `evidenceSets` 块，约 752 / 1523 行两处都要补：实现 + 类型声明） |
| 4 | renderer | `apps/electron/src/renderer/atoms/session-feedback-atoms.ts` **(新建)** | 持有 `SessionFeedbackMap` 的 atom + 拉取/更新 action（仿 `session-evidence-atoms.ts`） |
| 4' | renderer | `SDKMessageRenderer.tsx` | §6 渲染改动 |

---

## 6. 渲染层改动（SDKMessageRenderer.tsx）

`import { ThumbsUp, ThumbsDown } from 'lucide-react'`（并入第 21 行现有 lucide import）。在第 673 行 `{textContent && <CopyButton content={textContent} />}` 之后插入：

```tsx
{textContent && lastUuid && (
  <OutputFeedbackButtons
    sessionId={agentSessionId}
    messageUuid={lastUuid}
    userMessageUuid={userMessageUuid}
    messageTimestamp={messageTimestamp}
  />
)}
```

新增内部组件 `OutputFeedbackButtons`（同文件内，仿 `AddToEvidenceSetButton` 的就近定义）：
- 从 `session-feedback-atoms` 读当前 `messageUuid` 的态（`up` / `down` / 无）。
- 渲染两个 `<MessageAction tooltip={tConv('feedback.thumbsUp.tooltip' | 'feedback.thumbsDown.tooltip')} onClick={...}>`，分别放 `ThumbsUp` / `ThumbsDown`，选中态加语义 token 高亮。
- `onClick`：按 §2.2 状态机算出 `next` 值 → 乐观更新 atom → `window.electronAPI.outputFeedback.set({...})`；catch 回滚 + toast。
- 会话级回显在父层（会话加载处）调用一次 `outputFeedback.getForSession(sessionId)` 灌入 atom，组件只读。

---

## 7. i18n（硬约束）

命名空间 `conversation`，文件 `locales/{en,zh}/conversation/panels.json`，在 `fork` 块后新增 `feedback` 段（en / zh 同步落键，由 `key-parity` 守门）：

```jsonc
// en
"feedback": {
  "thumbsUp": { "tooltip": "Good response" },
  "thumbsDown": { "tooltip": "Bad response" },
  "saveFailed": "Couldn't save your feedback — please try again"
}
// zh
"feedback": {
  "thumbsUp": { "tooltip": "回答不错" },
  "thumbsDown": { "tooltip": "回答不行" },
  "saveFailed": "反馈未能保存，请重试"
}
```

组件内全部走 `useT('conversation')` 的 `tConv('feedback.*')`，禁止 inline 硬编码（中或英）。

---

## 8. 存储与服务行为

- `appendEvent`：`appendFileSync(getOutputFeedbackPath(sessionId), JSON.stringify(event) + '\n')`；目录懒建。
- `getSessionMap`：文件不存在 → 返回 `{}`；逐行 parse（跳过坏行并 `console.warn`），按 `messageUuid` 覆盖式折叠，`value==='none'` 的从 map 删除，最终只留 `up`/`down`。
- 时间戳由 **主进程** 用 `new Date().toISOString()` 生成（渲染层不传时间，避免时钟不一致）。
- 全程 try/catch；写失败向上抛由 IPC 层转成 renderer reject，触发乐观更新回滚 + toast。

---

## 9. 版本号递增

| 包 | 当前 | 目标 |
|----|------|------|
| `@asci/shared` | 0.1.92 | 0.1.93 |
| `apps/electron` | 0.1.410 | 0.1.411 |

（`@asci/core` / `@asci/ui` 不涉及，不动。）

---

## 10. 测试计划

- **shared**：`OutputFeedbackEvent` 类型 + 通道常量编译期校验（随 `typecheck`）。
- **main**：`output-feedback-service.test.ts`（仿 `evidence-set-service.test.ts`，用 `setConfigDirForTesting` 重定向到 tmp）——覆盖追加多事件后折叠取最后一条、`none` 删除、坏行跳过、文件不存在返回 `{}`。
- **i18n**：`key-parity.test.ts` 自动校验 en/zh 新键对齐。
- **手动 golden path**（`bun run dev`）：点赞 → 高亮；再点取消；点踩切换；重开会话回显；设置页切 zh↔en tooltip 无 raw key。

---

## 11. Done When

- [ ] 工具栏按 复制 → 赞同 → 不赞同 → 加入证据集 → (Debug) → 分支 → 撤回 顺序展示，dev / prod 一致。
- [ ] 两个新图标来自 lucide（`ThumbsUp` / `ThumbsDown`），`size-4`，与现有图标同体系。
- [ ] 三态互斥单选 + 取消 + 语义 token 高亮；乐观更新 + 失败回滚 + toast。
- [ ] 事件落盘 `~/.asci/feedback/<sessionId>.jsonl`，字段齐全；重开会话回显。
- [ ] IPC 四联同步完成（shared → main → preload → renderer）。
- [ ] en + zh 文案同步，无 raw key。
- [ ] `bun run typecheck` / `bun test`（含 service 测试 + `key-parity`）通过。
- [ ] `@asci/shared` 0.1.93、`apps/electron` 0.1.411。

---

## 12. 开放问题

1. 反馈文件按 `sessionId` 还是 `conversationId` 分？本 spec 取 `sessionId`（组件直接可得，与证据集 preview 的身份键一致）；若后续分析更需要 conversation 维度，再在事件里补 `conversationId` 字段（向后兼容，老行缺字段即视为未知）。
2. `model` / `scenario` 维度当前能否在渲染层稳定拿到？若拿不到先留空，不阻塞主功能；后续从 turn 元数据补。
