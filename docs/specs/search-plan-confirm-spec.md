> 历史科研规格：保存旧设计和数据语义，不作为当前新增功能或恢复运行接线的要求。科研主动功能正按[退役规格](./2026-11-10-research-retirement.md)分批收口，实际完成与未验收范围以对应执行记录为准。

# 检索方案确认组件 Spec（Search Plan Confirmation）

> **状态**：草稿 · 待 review
> **关联 issue**：#435（[ops-feedback] 检索方案确认组件 · 0601 反馈序号 10 · 旭武）
> **关联 PR**：TBD
> **领域语言事实源**：本 spec §2 术语；与 `CONTEXT.md` 对齐
> **范本依赖**：lit-review「选择综述方向」全链路（present_directions）——本 spec 与其 1:1 对称

---

## 1. 背景与问题

当前 lit-search 能力包的检索流程：场景 Agent 在「规划轮」产出 `## SEARCH PLAN`（intent / keywords / sources / method_terms / object_terms / steps…），**该方案只是对话里的一段 fenced JSON 文本**，产出后 Agent 直接派发 `searcher` 子代理调 `mcp__paper-search__retrieve` 开跑。

用户反馈（旭武）：
1. **方案塞在一段文本里、入口隐蔽，阅读体验差**；
2. **没有执行前的干预点** —— 用户既看不清拟定的检索策略，也无法在真正发起检索前确认或微调。

> 来源 prompt 段落：`apps/electron/default-capability-packs/lit-search/scenario/system-prompt.md` §"Planning turn — output format"（约 L29-80）。

## 2. 目标与术语

**目标**：在 lit-search 真正发起检索前，由 Agent 把结构化检索方案通过**对话内确认组件**摆出来，用户**确认 / 调整 / 取消**后，Agent 再据此执行检索。

**关键判据（来自 issue AC）**：
- 复用现有 `ChoiceCard` / `choice-tokens`，**不改右侧 WorkspacePanel**；颜色走语义 token，无 palette 硬编码；
- 打通 Agent → 前端「出方案待确认」→ 回传继续的链路（若涉及 IPC，四联同步）；
- 方案**分项**清晰展示，而非塞进一段文本；
- 文案走 `useT`，en + zh 同步、`key-parity` 通过；受影响包 patch 递增；`typecheck` + `bun test` 通过。

**术语**：
| 术语 | 含义 |
|------|------|
| 检索方案（Search Plan） | Agent 拟定的结构化检索策略：研究问题 + 关键词 + 目标源 + method/object 词 + 时间范围 + 目标数量 |
| 检索方案确认组件 | 对话流内渲染的 ChoiceCard，呈现方案分项 + [确认执行 / 我来调整 / 取消] |
| 方案确认链路 | Agent emit 待确认方案 → 前端渲染 → 用户操作 → 回传 tool_result → Agent 续走 |

## 3. 设计决策（已拍板）

### 3.1 「调整」交互粒度：MVP — 自然语言调整

**1:1 复用 lit-review present_directions 模式**，不新建可编辑表单组件：

- ChoiceCard `body` 渲染方案分项（只读），`options` = `confirm` / `adjust` / `cancel`；
- 选 **`confirm`** → 按原方案执行；
- 选 **`adjust`** → 走自由文本输入（与 present_directions 的 `custom` 同源交互），用户用一句话描述要改什么（"换成只搜 arxiv""加上 2020 年后""关键词去掉 X"），Agent 收到 `adjust` + 调整文本后**重新出一版方案再确认**；
- 选 **`cancel`**（含 Esc）→ 放弃本次检索。

> 内联可编辑表单（chips 增删 / 源多选 / 范围输入 → 回传结构化调整结果）**不在本 spec 范围**，作为后续 issue 迭代。理由：先让确认链路最快上线，编辑体验后续打磨。issue 备注亦认可此分步。

### 3.2 复用 vs 新建

| 复用（不动） | 新建（仿 litreview 对称文件） |
|------|------|
| `ChoiceCard` / `ChoiceCardShell` / `choice-tokens` | `SearchPlanCard`（ChoiceCard 包装，渲染方案分项 body） |
| `useActiveBannerSlot`（仅**新增 1 个 slot**） | `SearchPlanBanner`（atom → banner → card → IPC 回填） |
| `AgentEventBus` emit 机制 | `agent-search-plan-service.ts`（Promise + Map 异步等待） |
| orchestrator SDK MCP 注册位（L727-739 旁） | `search-plan-sdk-mcp.ts`（`present_search_plan` 工具） |
| — | `packages/shared/.../search-plan-ipc.ts`（通道 + 类型） |

## 4. 数据契约

### 4.1 方案 schema（`packages/shared/src/types/search-plan-ipc.ts`，新建）

```ts
export const SEARCH_PLAN_IPC_CHANNELS = {
  /** renderer → main：用户已确认/调整/取消，回填 tool result */
  RESPOND: 'search-plan:confirm-respond',
} as const

/** 单项检索方案（UI 友好裁剪自 lit-search SEARCH PLAN） */
export interface SearchPlanProposal {
  /** 研究问题（一句话，卡片头/副标题） */
  researchQuestion: string
  /** 关键词（核心概念 + 同义词），分项 chips 展示 */
  keywords: string[]
  /** 目标源：openalex / crossref / arxiv ... */
  sources: string[]
  /** 方法词（可选，分项展示） */
  methodTerms?: string[]
  /** 对象词（可选，分项展示） */
  objectTerms?: string[]
  /** 时间范围（可选） */
  timeRange?: { from?: number; to?: number }
  /** 目标数量（可选，对应 retrieve top_k / stop_conditions 概数） */
  targetCount?: number
}

/** present_search_plan 请求（main → renderer，走 agent event stream） */
export interface SearchPlanConfirmRequest {
  requestId: string
  sessionId: string
  plan: SearchPlanProposal
  /** "我来调整" 按钮文案（默认 zh/en 由前端 i18n 提供，可被 prompt 覆盖） */
  adjustLabel?: string
}

/** present_search_plan 响应（renderer → main） */
export type SearchPlanConfirmResponse =
  | { requestId: string; choice: 'confirm' }
  | { requestId: string; choice: 'adjust'; adjustment: string }
  | { requestId: string; choice: 'cancel' }
```

### 4.2 tool_result 回给 Agent

`search-plan-sdk-mcp.ts` 把结果序列化为 `{ content: [{ type: 'text', text: JSON }] }`（与 litreview `resultToContent` 对称）：
- `confirm` → `{ "choice": "confirm" }`
- `adjust` → `{ "choice": "adjust", "adjustment": "<用户自由文本>" }`
- `cancel` → `{ "choice": "cancel" }`

## 5. 端到端链路（与 present_directions 逐层对称）

```
lit-search 规划轮：产出 SEARCH PLAN → 调 mcp__searchplan__present_search_plan
  → search-plan-sdk-mcp.ts tool handler（闭包持 sessionId / sendToRenderer）
  → searchPlanService.handlePresentSearchPlan()  ── Promise + Map<requestId> 挂起
  → eventBus.emit('search_plan_request')          ── AgentStreamEvent 新类型
  → useGlobalAgentListeners → allPendingSearchPlanRequestsAtom（Map<sessionId, req[]>）
  → useActiveBannerSlot 仲裁（新增 'searchPlan' slot）
  → SearchPlanBanner → SearchPlanCard（ChoiceCard：body=方案分项, options=confirm/adjust/cancel）
  → 用户操作 → window.electronAPI.respondSearchPlan(response)
  → ipcMain.handle(SEARCH_PLAN_IPC_CHANNELS.RESPOND) → searchPlanService.respondConfirm()
  → Promise resolve → tool_result 回给 Agent → emit('search_plan_resolved')
  → Agent：confirm→派发 searcher 执行；adjust→重出方案再确认；cancel→收尾不检索
```

## 6. 实现清单（按依赖顺序）

### 6.1 shared（`packages/shared`，patch++）
- [ ] 新建 `src/types/search-plan-ipc.ts`（§4.1 全部类型 + 通道常量），从 `index.ts` 导出；
- [ ] `src/types/agent.ts` 的 `AgentStreamEvent` 联合新增：
  `{ type: 'search_plan_request'; request: SearchPlanConfirmRequest }`、
  `{ type: 'search_plan_resolved'; requestId: string }`。

### 6.2 main（`apps/electron`，patch++）
- [ ] 新建 `src/main/lib/agent-search-plan-service.ts`（仿 `agent-litreview-directions-service.ts`：Promise+Map、`handlePresentSearchPlan` / `respondConfirm` / `getPendingRequests` / `clearSessionPending`，导出单例 `searchPlanService`）；
- [ ] 新建 `src/main/lib/search-plan-sdk-mcp.ts`（仿 `litreview-sdk-mcp.ts`：`present_search_plan` 工具 + zod 入参 schema + `resultToContent`；server name `searchplan`，工具名暴露 `mcp__searchplan__present_search_plan`）；
- [ ] `agent-orchestrator.ts` L727-739 旁注册：`mcpServers['searchplan'] = createSearchPlanSdkMcpServer(sessionId, (request) => eventBus.emit(sessionId, { kind:'asci_event', event:{ type:'search_plan_request', request } }))`；
- [ ] `ipc.ts` 新增 `ipcMain.handle(SEARCH_PLAN_IPC_CHANNELS.RESPOND, ...)`（仿 litreview L1328-1341，回填后 emit `search_plan_resolved`）；
- [ ] session 取消/清理路径调用 `searchPlanService.clearSessionPending(sessionId)`（与 litreview 同址）。

### 6.3 preload（`apps/electron`）
- [ ] `src/preload/index.ts`：暴露 `respondSearchPlan: (r: SearchPlanConfirmResponse) => ipcRenderer.invoke(SEARCH_PLAN_IPC_CHANNELS.RESPOND, r)`，并在类型声明处补 `respondSearchPlan`（仿 L450 / L1229）。

### 6.4 renderer（`apps/electron`，patch++）
- [ ] `atoms/agent-atoms.ts`：新增 `allPendingSearchPlanRequestsAtom`（Map<sessionId, SearchPlanConfirmRequest[]>），仿 `allPendingLitReviewDirectionsRequestsAtom`；
- [ ] `hooks/useGlobalAgentListeners.ts`：监听 `search_plan_request` 入队、`search_plan_resolved` 出队（仿 L76-79 / L533-540）；
- [ ] `components/agent/choice/useActiveBannerSlot.ts`：`BannerSlot` 加 `'searchPlan'`，并在仲裁链插入（建议优先级置于 `litReviewDirections` 同级附近）；
- [ ] 新建 `components/agent/choice/SearchPlanCard.tsx`：ChoiceCard body 渲染方案分项（研究问题 / 关键词 chips / 源 / method-object / 时间范围 / 数量），options = confirm/adjust/cancel；选 `adjust` 走自由文本输入回填 `{ choice:'adjust', adjustment }`；
- [ ] 新建 `components/agent/SearchPlanBanner.tsx`（仿 `LitReviewDirectionsBanner.tsx`：读 atom、`useActiveBannerSlot` 判 slot、`respondSearchPlan` 回填）；
- [ ] `components/agent/AgentView.tsx`：在 `LitReviewDirectionsBanner` 旁挂 `<SearchPlanBanner sessionId={sessionId} />`。

### 6.5 i18n（`apps/electron`，patch++）
- [ ] 在 agent 命名空间下新增 `searchPlanConfirm.*` keys：`title` / `subtitle` / 分项 label（researchQuestion/keywords/sources/methodTerms/objectTerms/timeRange/targetCount）/ `action.confirm` / `action.adjust` / `action.cancel` / `adjustPlaceholder`；**en + zh 同步**，`key-parity.test.ts` 通过。

### 6.6 prompt（`apps/electron/default-capability-packs/lit-search`，pack version++）
- [ ] 在 `scenario/system-prompt.md` 规划轮收口处插入 **mandatory** 步骤：产出 SEARCH PLAN 后、派发 `searcher` 前，**必须**调用 `mcp__searchplan__present_search_plan` 传入裁剪后的 `SearchPlanProposal`；依据返回：
  - `confirm` → 按原方案派发 searcher；
  - `adjust` → 结合 `adjustment` 重写 SEARCH PLAN，**再次**调用 present_search_plan 确认（可循环）；
  - `cancel` → 不检索，简短收尾。
- [ ] 明确 `direct_lookup`（exact-lookup）/ citation-tracing 是否也走确认（建议：exact-lookup 单 ID 直查**可跳过**确认，只有 general-query / citation-tracing 的多源检索才确认 —— 待 review 拍板，见 §8）。

## 7. 验收映射（AC → 实现）

| issue AC | 由谁满足 |
|------|------|
| 检索前对话流出现确认组件，方案分项清晰 | §6.4 SearchPlanCard + §6.6 prompt 强制调用 |
| 确认按方案执行；调整后按调整结果执行 | §3.1 confirm/adjust 语义 + §6.6 prompt |
| 复用 ChoiceCard/choice-tokens，不改 WorkspacePanel，语义 token | §3.2 复用表；SearchPlanCard 仅包装 ChoiceCard |
| Agent↔前端链路打通（IPC 四联同步） | §6.1-6.4 shared→main→preload→renderer |
| useT、en+zh、key-parity、patch++、typecheck+test | §6.5 + 各包 patch |
| `bun run dev` 实跑 golden path | 交付前手动验证（§9） |

## 8. 待 review 拍板的开放问题

1. **哪些 intent 走确认？** 建议仅 general-query / citation-tracing 多源检索确认；exact-lookup 单 ID 直查跳过（避免无谓打断）。
2. **adjust 是否限制循环次数？** 建议软上限（如 3 次）后提示用户或降级直接执行，防抖动。
3. **slot 优先级**：searchPlan 与 litReviewDirections 不会同时出现（不同能力包），但仍需在 `useActiveBannerSlot` 明确次序。
4. **lit-search SEARCH PLAN → SearchPlanProposal 的字段裁剪**：steps / stop_conditions / needs_closing_turn 不进 UI，仅展示用户可理解的检索维度——确认裁剪集是否够用。

## 9. 自验清单（交付前）

- [ ] `bun run typecheck` 通过
- [ ] `bun test` 通过（含 `key-parity.test.ts`）
- [ ] 受影响包 patch 已递增（shared / electron + lit-search pack version）
- [ ] 跑过 `simplify` / `@code-simplifier`
- [ ] `bun run dev`：发起检索 → 看到确认组件 → confirm 按方案执行；adjust 重出方案；cancel 终止 —— zh/en 各走一遍无 raw key
- [ ] 确认未改 WorkspacePanel、无 Tailwind palette 硬编码
