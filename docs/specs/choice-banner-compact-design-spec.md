# Choice Banner 紧凑化设计 Spec

> **状态**：草稿 · 待 review
> **关联 issue**：（待开）
> **关联 PR**：（待开）
> **领域语言事实源**：`CONTEXT.md`（暂无 banner 专门术语，本 spec 沿用既有命名）
> **触发来源**：会话流中的执行/权限卡片当前撑满屏幕，需要参考 Codex 的"覆盖式紧凑卡"重塑。

---

## 1. 问题与目标

### 1.1 现状

`PermissionBanner`（权限确认卡）在 Agent 调用 MCP / Bash / 文件工具时弹出，**替换输入框**显示在 `AgentView` 底部：

- 标题行（"需要确认 zotero / zotero_list_collections"）
- 副行（"使用工具: mcp__zotero__zotero_list_collections"）
- 工具预览（命令 / 文件路径 / JSON 参数，max-h 120px）
- 判定原因（硬规则 / AI 决策，可选）
- 3 个选项（允许 / 拒绝 / 本会话总是允许），每行 36px
- 队列追加（"+N queued"）
- 页脚键盘提示（↑↓ 切换 / ↵ 确认 / 1-3 直选 / esc 终止）

实测在通常场景下高度 ≈ 180–240px，**视觉上挤压上方对话消息流**，给用户"撑满屏幕"的压迫感。

### 1.2 目标

把 `PermissionBanner` 改为**紧凑覆盖式卡片**：

1. 高度 hug 内容（无 min-height），普通场景 ≈ 130px、带预览 ≈ 160px、危险加 tooltip 仍 ≈ 130px
2. 沿用"覆盖输入框"模式（`!hasBannerOverlay && <Input>`），无 z-index 叠加
3. 信息密度提升：标题合并工具名、副行删除、判定原因走 tooltip、预览块封顶 60px
4. 右下加**确定按钮**（按钮文字 = 当前 focused 选项动词；危险态 + focused 拒绝时按钮变红）
5. 同时焕新 3 个共用 shell 的兄弟 banner：`AskUserBanner`、`ExitPlanModeBanner`、`LitReviewDirectionsBanner`

### 1.3 非目标

- 不动 IPC / 权限服务 / 状态 atom（`PermissionRequest` 形状不变；响应通道 `PERMISSION_RESPOND` 不变）
- 不引入 banner 与输入框的 z-index 叠加（曾考虑"输入框压在卡片上"方案，最终回归覆盖式）
- 不动 `ToolActivityItem` / 消息流里的工具结果渲染（视觉体系不同，独立项）
- 不做动画 polish（淡入淡出 / slide-up 等留作 v2）
- 不重新设计 `ConfirmDangerousModal`（仅复用）

---

## 2. 决策回顾

| 项 | 决定 | 备选与放弃原因 |
|---|---|---|
| **范围** | 动共享 shell（`ChoiceCardShell` + `choice-tokens.ts`），4 个 banner 一起焕新 | 只动 PermissionBanner body 能改的余地有限（圆角/边框/页脚来自 shell） |
| **分支** | `alex-20260603`（基于 main），PR → main | 走 UI-main 会丢真实 IPC 数据流验证 |
| **与输入框** | 覆盖输入框（沿用现状） | 曾考虑"输入框 z-index 压在卡片上"，但实现复杂、键盘冲突、阻塞决策语义反而被削弱 |
| **选项排列** | 竖排（沿用现有 3 行结构，行高 36→28px） | 横排在窄屏退化复杂，且与现有 keyboard model 不匹配 |
| **高度** | hug content，无 min-height | 固定 80–90px 在带预览 / 多队列时溢出 |
| **键盘** | 不动现有全局监听（1/2/3 / ↑↓ / ↵ / Esc），输入框被覆盖故无焦点冲突 | — |
| **信息** | 副行删 · 工具名进标题 · 判定原因 → tooltip · always-allow 解释 → tooltip · 预览 120→60px | 全留信息过载；激进横向按钮组在 Bash/文件场景无法看参数 |
| **确定按钮** | 右下；文字 = focused 选项的动词；危险 + focused 拒绝时变红，其他保持深色 | 始终写"确定"信息量低；始终红色在普通态过度报警 |

---

## 3. 视觉规格

### 3.1 整卡结构

```
┌──────────────────────────────────────────────┐
│ 需要确认  zotero / zotero_list_collections   │  ← 标题行（hdr）
│              · 危险态: ⚠ 前缀；右侧浮判定原因 tooltip ⓘ
├──────────────────────────────────────────────┤
│ git fetch origin main                        │  ← 预览块（prv，可选）
├──────────────────────────────────────────────┤
│ 1  允许                                       │  ← 选项行（opt × N）
│ 2  拒绝                                       │     focused 行: bg-muted/40
│ 3  本会话总是允许                              │     disabled 行: opacity-45
├──────────────────────────────────────────────┤
│ ↑↓切换 1-3直选 Esc终止       [允许 ↵]        │  ← 页脚（ftr）
└──────────────────────────────────────────────┘
```

### 3.2 尺寸 token（落 `choice-tokens.ts`）

| token | 现值 | 新值 |
|---|---|---|
| `shellClass` 整体 padding | `p-3 / px-3 py-2` | `p-0`（child 自己控制） |
| 标题行 padding | `px-3 pt-2 pb-1` | `px-3 py-2`（统一） |
| 标题字号 | `text-sm font-semibold` | 保持 `text-sm font-semibold`（13px） |
| 工具名 | `text-xs text-muted-foreground font-mono` | 保持 |
| 副行 | 存在 | **删除** |
| 预览块 max-h | `120px` | `60px` |
| 预览块字号 | `text-xs font-mono` | 保持，`px-3 py-1` |
| 选项行高 | `h-9 px-3` | `min-h-7 px-3 py-1.5`（约 28px） |
| 选项分隔 | `divide-y` | 保持，颜色用 `border-muted/40` |
| 页脚 padding | `border-t px-3 py-1.5` | `border-t pl-3 pr-2 py-1.5`（右边留按钮气） |
| 页脚字号 | `text-[11px]` | 保持 |
| 确定按钮 | **新增** | `h-7 px-3 text-xs font-medium rounded` |

### 3.3 颜色 token（沿用现有语义 token，无 Tailwind palette 硬编码）

- 普通态：shell `bg-card border-border`；按钮 `bg-foreground text-background hover:bg-foreground/90`
- 危险态：shell `border-destructive/60`；标题 `text-destructive`；按钮（focused 在拒绝时）`bg-destructive text-destructive-foreground`
- 安全态（如有）：保持现有 `border-emerald-500/50`（沿用现状，未来 design.md 决定是否换 token）

> 严格遵守 CLAUDE.md §2 "颜色必须用语义 token，禁止 Tailwind 调色板硬编码" —— 任何 brand 色加 `// eslint-disable-next-line asci/no-tailwind-palette -- <理由>` 豁免。

### 3.4 Tooltip 内容

| 触发点 | 现来源 | tooltip 内容 |
|---|---|---|
| 标题右侧 "判定原因 ⓘ"（仅出现当存在 hardRuleReason 或 decisionReason） | `permission.banner.reason.hardRule` / `permission.banner.reason.decision` | 完整原文 |
| 选项 "本会话总是允许" 行 | `permission.banner.alwaysAllowTooltip` | 现有文案 |

Tooltip 触发：鼠标 hover **+ 键盘 focus-visible**（无障碍）；使用 ShadcnUI `Tooltip` 组件，`open-on-focus` 默认开启，无需自写。

---

## 4. 内容与 i18n 改动

### 4.1 现 key 处理（`apps/electron/src/renderer/locales/{en,zh}/conversation/input.json`）

实际触发"使用工具：xxx" 副行的是 `banner.description.generic`（zh: `使用工具：{{tool}}` / en: `Use tool: {{tool}}`），由 `ToolPreview` 在 `toolInput` 为空且无 `command` 时作为 fallback 渲染（`PermissionBanner.tsx:202`），不是独立 subtitle key。本 spec 不删 key（其它分支可能也用），而是改渲染逻辑：当 fallback 文案等价于"使用工具：<已在 title 显示的工具名>"时，**body 留空**（让 ChoiceCard 直接进入选项列表）。

| key | 操作 |
|---|---|
| `banner.title.normal` "需要确认" | 保持 |
| `banner.title.dangerous` "危险操作需要确认" | 保持 |
| `banner.title.safe` "确认操作" | 保持 |
| `banner.action.allow` / `.deny` / `.alwaysAllowSession` | 保持 |
| `banner.alwaysAllowTooltip` | 保持，移作 tooltip 内容 |
| `banner.reason.hardRule` / `.decision` | 保持，移作 tooltip 内容 |
| `banner.description.generic` "使用工具：{{tool}}" | key 保留（其它入口可能用）；PermissionBanner 渲染时若 generic fallback 等价 title 中的工具名则**不渲染 body** |
| `banner.confirmButton`（新增） | 默认 "确定"（en: "Confirm"），作回退；运行时按钮文字取自 focused option label |

### 4.2 现 key 处理（`apps/electron/src/renderer/locales/{en,zh}/conversation/permission.json`）

| key | 操作 |
|---|---|
| `choiceCard.keyboardHint.navigate` "切换" | 保持 |
| `choiceCard.keyboardHint.confirm` "确认" | **删除 JSX 使用**（移到按钮 kbd `↵`），key 暂保留以防其他 banner 用 |
| `choiceCard.keyboardHint.select` "直选" | 保持 |
| `choiceCard.keyboardHint.dismissTerminate` "终止" | 保持 |
| `choiceCard.counter` `{{current}}/{{total}}` | 保持 |
| 旧 `permission.title` / `permission.subtitle.tool`（legacy 块） | 探索阶段标注为 unused，本 spec 不动；后续清理 spec 另开 |

### 4.3 双语守门

- 改动 key 时 en + zh 同步增删
- `key-parity.test.ts` 守门确保不漏翻

---

## 5. 文件清单（实现时落到这些文件）

| 文件 | 改动 |
|---|---|
| `apps/electron/src/renderer/components/agent/choice/choice-tokens.ts` | 收紧尺寸 token、新增 `confirmButtonClass` |
| `apps/electron/src/renderer/components/agent/choice/ChoiceCardShell.tsx` | 页脚布局重写：左 hints + 右 confirm button；接受 `confirmLabel`、`confirmDanger`、`onConfirm` props；删 `counter` 显示位（合并进 hints 或保留？见 § 8 待定） |
| `apps/electron/src/renderer/components/agent/choice/ChoiceCard.tsx` | 把 Enter 行为路由到 shell 的 `onConfirm`；focused 选项变化时通知 shell 更新按钮文字 |
| `apps/electron/src/renderer/components/agent/choice/KeyboardHintFooter.tsx` | 改为 inline 短文（不再单独一行的"键盘提示"组件，删除独立组件或简化为 string builder） |
| `apps/electron/src/renderer/components/agent/PermissionBanner.tsx` | `ToolPreview` 的 generic fallback 在等价工具名时返回 `null`（让 body 空）；预览块 max-h 改 60；判定原因从 inline 移到 tooltip wrapper；通过 ChoiceCard / shell 传 `confirmLabel = focusedOption.label`、`confirmDanger = dangerLevel === 'dangerous' && focusedIdx === denyIdx` |
| `apps/electron/src/renderer/components/agent/AskUserBanner.tsx` | 接 shell 新 props；如有自由文本输入框（选项之外），整合到 confirm 按钮上方 |
| `apps/electron/src/renderer/components/agent/ExitPlanModeBanner.tsx` | 接 shell 新 props |
| `apps/electron/src/renderer/components/agent/LitReviewDirectionsBanner.tsx` | 接 shell 新 props；若选项多于 5 个，shell 内部 listbox 加 `max-h-[160px] overflow-y-auto` |
| `apps/electron/src/renderer/components/agent/permission/PermissionQueueList.tsx` | 不动（追加行已经够紧凑） |
| `apps/electron/src/renderer/locales/{en,zh}/conversation/input.json` | 删 `banner.subtitle.tool`；新增 `banner.confirmButton` 回退态 |
| `apps/electron/package.json` | patch 递增（`0.x.y → 0.x.(y+1)`） |
| `apps/electron/src/renderer/components/agent/choice/ChoiceCardShell.test.tsx`（新） | 新 props 渲染快照 + 键盘行为 |
| `apps/electron/src/renderer/components/agent/PermissionBanner.test.tsx`（如无则新增） | 验证 confirm button label 跟随 focusedIdx、danger 态颜色切换、tooltip 触发 |

---

## 6. 实现注意点

### 6.1 IPC / 数据流保持不变

- 入站：`useGlobalAgentListeners.ts:479-495` 仍消费 `permission_request` 事件 → 落 `allPendingPermissionRequestsAtom`
- 出站：`PermissionBanner.respond` 仍调 `window.electronAPI.respondPermission({ requestId, behavior, alwaysAllow })`
- 终止：Esc 仍走 `handleDismiss` → flush queue + `stopAgent(sessionId)`

### 6.2 键盘模型不变

- 全局 `keydown` 监听仍由 `ChoiceCard.tsx:85-116` 和 `ChoiceCardShell.tsx:38-53` 注册
- `skipInputElements` 卫语句保留（虽然输入框被覆盖，但其它 textarea / contentEditable 仍可能存在）
- Enter 行为：原直接调用 `triggerSelect(focusedIdx)` → 现统一走 shell 的 `onConfirm`，shell 内部仍调 `triggerSelect`
- `ConfirmDangerousModal` 路径不变

### 6.3 dev-only 不涉及

本改动无 dev/prod 分支，无需 `IS_DEV_MODE` / `ASCI_DEV` 门控。

### 6.4 packages/ 解耦

视觉与 i18n 均在 `apps/electron/` 内部，不耦合 `packages/shared` / `packages/core` / `packages/ui`。

---

## 7. 测试矩阵

### 7.1 单元 / 集成（Bun test）

| 用例 | 覆盖 |
|---|---|
| ChoiceCardShell 普通态渲染 | 标题 / 选项 / 页脚 / 确定按钮全部出现 |
| ChoiceCardShell 危险态渲染 | shell 边框 `border-destructive/60`、标题 `text-destructive`、按钮 focused-deny 时背景为 `bg-destructive` |
| ChoiceCard ↵ 路由 | Enter 触发 shell 的 `onConfirm`，进而调用 `triggerSelect(focusedIdx)` |
| ChoiceCard 1/2/3 直选 | 数字键触发对应 option |
| ChoiceCard ↑↓ 切换 | `focusedIdx` 在可用选项之间循环；button label 同步 |
| ChoiceCard Esc | 仍调 `onDismiss` |
| PermissionBanner button label 同步 | 切换 focused 时，按钮文字跟着变（"允许" → "拒绝" → "本会话总是允许"） |
| PermissionBanner tooltip | hardRuleReason 存在时标题右侧出现 `判定原因 ⓘ`；hover/focus 显示完整文本 |
| PermissionBanner queue | N>1 时显示 `+N queued`，最高位排首 |
| i18n key-parity | en + zh 同步增删 `banner.subtitle.tool`、`banner.confirmButton` |

### 7.2 视觉手测（`bun run dev`）

- 普通 zotero / paper-search MCP 调用 → 确认卡 ≈ 130px、无副行、按钮"允许 ↵"
- Bash 调用（git fetch / ls） → 预览块出现、卡片 ≈ 160px
- 危险 Bash（rm -rf 触发 detect-dangerous-bash） → 红边框 / 标题加 ⚠ / focused 跳到拒绝 / 按钮变红 / always-allow 行 disabled
- 多请求排队（连续触发 2 个工具调用） → 队列显示 `+1 queued`、首请求解决后第二个自动上位
- 切 zh ↔ en 各走一遍 → 无 raw key、按钮文字双语正确
- AskUserBanner / ExitPlanModeBanner / LitReviewDirectionsBanner 各跑一遍 golden path → 视觉一致

### 7.3 reach

- `bun run typecheck` 通过（含新 props 类型）
- `bun test` 全绿（含 `key-parity.test.ts`）
- `apps/electron/package.json` patch 递增

---

## 8. 仍待实现期决策（不阻塞 spec approval）

1. **counter 显示位**：现 shell 显示 `{{current}}/{{total}}`（如 "1/3 queued"）在标题旁。新设计是否保留？默认保留，但若标题行变挤可挪到队列追加行。
2. **safe 态视觉**：当前 `dangerLevel === 'safe'` 走 `border-emerald-500/50`。本 spec 沿用现状；若 design system 后续给 `--success` token 再切换。
3. **按钮 hover/active 状态**：使用 ShadcnUI `Button` 现有 variant 还是手写最小样式？默认走 ShadcnUI variant 复用。

---

## 9. 风险与回滚

| 风险 | 缓解 |
|---|---|
| Enter 路由改造打断现有 PermissionBanner 测试 | 实现时先跑现 `PermissionBanner.test.tsx`，把行为差异写进 spec 测试 |
| 兄弟 banner（AskUser 等）的 listbox 列表过长导致 shell 撑高 | shell 内部加 `max-h-[160px] overflow-y-auto`（见 § 5） |
| Tooltip 内容溢出（长判定原因） | tooltip 用 ShadcnUI 现有组件，自动 max-width / wrap |
| i18n 漏翻 | `key-parity.test.ts` 守门；CI 不过不能 merge |
| design.md 颜色规范变化 | spec 内所有颜色走语义 token，未来切 token 一次性替换 |
| 按钮 label = focused 动词时长文（如 "本会话总是允许"）在窄宽度（< 480px renderer 宽）溢出 | 按钮加 `max-w-[180px] truncate`；过长 label 触发 truncate 时整词改回退态 "确定" |

回滚策略：单 PR commit，revert 一次即回到现状。

---

## 10. 交付检查（Done When）

按 CLAUDE.md §8：

1. [ ] `bun run typecheck` 通过
2. [ ] `bun test` 通过（含 `key-parity.test.ts`）
3. [ ] `apps/electron/package.json` patch 已递增
4. [ ] 跑过一次 `simplify` skill 复盘
5. [ ] `bun run dev` 中 4 个 banner 各走 golden path + 危险态、队列、长预览边界
6. [ ] zh ↔ en 切换无 raw key
7. [ ] 向用户确认是否同步 CLAUDE.md / README.md（本 spec 改的是组件实现，不动文档约定，预计**不需要**同步）
8. [ ] 不涉及 IPC 四联同步
9. [ ] 不涉及 SDK 打包配置
