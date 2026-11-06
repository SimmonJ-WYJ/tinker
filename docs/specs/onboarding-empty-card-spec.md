# note / 证据集 首次使用 onboarding 空状态教学卡 Spec

> **状态**：草稿 · 待 review
> **关联 issue**：[#438](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/438) — `[ops-feedback] note / 证据集首次使用 onboarding 引导（降低新人门槛）`
> **关联 PR**：TBD
> **领域语言事实源**：[CONTEXT.md](../../CONTEXT.md)（note / 证据集 / 文献库 术语）
> **依赖输入**：现有 `SpotlightOverlay V2` 状态机（仅作机制对比，不复用其状态字段）；现有 `EvidenceSetCard` 视觉语言（卡片样式同源）

---

## 1. 背景与目标

### 1.1 问题

note（笔记）和证据集（Evidence Set）是 ASCI 的核心科研对象，但产品里没有任何首次使用引导/演示。新人不知道它们是什么、怎么用、和文献库/对话的关系，上手门槛高（来源：0601 测试反馈序号 17·旭武）。

现有 `SpotlightOverlay V2` 是"真·首次安装一次性贯穿引导"，覆盖 LLM/Zotero/任务三步动作链，**不覆盖 note / 证据集的概念引导**。且 spotlight 是"指向式动作引导"，与 note/证据集所需的"概念讲清"语义不匹配。

### 1.2 目标

为 **NotesView**（"全部证据集"列表）和 **PaperNotesPanel**（论文 notes 区）补一套**视图内空状态教学卡**：

- **触发**：列表数据为空 + 未 dismiss → 自然显示
- **内容**：每张卡含 1 张 SVG 主示意 + 4 段文字步骤（"是什么 / 怎么建 / 在哪看 / 典型用法"）
- **关闭**：右上 `×` 主动 dismiss → 持久化 → 即便列表仍空也不再显示
- **再看**：视图顶部一个 `HelpCircle` 图标 → 清掉 dismiss 标志位 → 卡片重新出现

### 1.3 非目标（YAGNI）

- ❌ 不在 `EvidenceSetDetailSheet`（已建空集）显示——已经在用证据集的人不需要概念引导
- ❌ 不在 `PaperContainingEvidenceSetsPanel`（被收录提示）显示——反向 hint，看见即懂
- ❌ 不接入 `SpotlightOverlay` 状态机——spotlight 是一次性贯穿语义，空状态卡是按视图独立 dismiss 语义，混在一起会污染 spotlight
- ❌ 不做"几天后自动重显"——dismiss 即永久（但 `dismissedAt: number` 字段为未来此能力留口）
- ❌ 不做演示 GIF / 截图——纯 SVG 主示意，零图片资产维护

---

## 2. 架构与组件边界

### 2.1 新增文件清单

```
apps/electron/src/renderer/components/onboarding/
  OnboardingEmptyCard.tsx                    # 通用空状态教学卡（props 驱动）
  illustrations/
    EvidenceSetIntro.tsx                     # SVG 主示意 #1（证据集是什么）
    PaperNotesIntro.tsx                      # SVG 主示意 #2（PDF 划词→笔记）

apps/electron/src/renderer/atoms/
  onboarding-empty-card-atoms.ts             # state atom + hydrate 逻辑

apps/electron/src/renderer/hooks/
  useOnboardingEmptyCard.ts                  # 视图侧使用的便捷 hook

apps/electron/src/main/lib/
  onboarding-empty-card-service.ts           # settings.json read/write + subscribe
  onboarding-empty-card-service.test.ts      # 主进程单元测试

packages/shared/src/types/
  onboarding-empty-card.ts                   # OnboardingEmptyCardKey + State 类型
  # 在 ipc-channels.ts 加 4 个通道常量

apps/electron/src/renderer/locales/<lang>/onboarding.json
  # 根级加 emptyCard 子树（不新开 ns）
```

### 2.2 通用组件契约

```ts
// OnboardingEmptyCard.tsx
import type { LucideIcon } from 'lucide-react'

export type OnboardingEmptyCardKey = 'notesView' | 'paperNotes'

export interface OnboardingEmptyCardProps {
  /** 持久化 dismiss 的 key（哪张卡被关） */
  cardKey: OnboardingEmptyCardKey
  /** SVG 主示意（120×120，跟随 currentColor） */
  illustration: React.ReactElement
  /** i18n key：标题 */
  titleKey: string
  /** i18n key：一句话定义 */
  introKey: string
  /** 4 段步骤（"是什么/怎么建/在哪看/典型用法"），每段含 lucide 图标 */
  steps: ReadonlyArray<{ icon: LucideIcon; labelKey: string }>
}
```

- **视觉契约**：`border + shadow-sm + bg-card`，与 `EvidenceSetCard` 视觉同源；右上 `×` 关闭按钮；内部布局上→下为 `主示意 → 标题 → intro → 4 段步骤`。
- **依赖**：仅 `useT('onboarding')` + `useOnboardingEmptyCard(cardKey)`（dismiss 通过 hook 内部 IPC）。
- **零业务依赖**：组件不查数据、不判空——是否显示由 host 视图根据自己的数据状态 + `dismissed` 综合判断。

### 2.3 关键边界与取舍

| 决策 | 取舍 |
|---|---|
| **独立服务而非合进 spotlight** | spotlight 是"一次性贯穿"，empty-card 是"按视图独立 dismiss"；状态语义不同，混合会污染状态机 |
| **dismiss 字段为 `dismissedAt: number` 而非 `boolean`** | 同时兼容未来"几天后自动重显"+ 调试时间审计 |
| **i18n 走 `onboarding.json` 根级 emptyCard 子树** | `onboarding` 现为单文件 ns；新开子 ns 需改 `locales/index.ts` 合并逻辑，收益不抵成本；root subtree 由 key-parity 测试现成守门 |
| **不写组件渲染测试** | 视觉组件，与 `EvidenceSetCard` / `SpotlightTooltip` 同策略——靠 `bun run dev` 手工验收 |
| **`replay` = 清掉 dismissedAt** | 比"加 shouldReplay 字段"更简洁，与"自然显示规则"（`空 && !dismissed`）自洽 |

---

## 3. 数据流与持久化

### 3.1 settings.json 字段扩展

`packages/shared/src/types/settings.ts`：

```ts
interface AppSettings {
  // ...已有字段
  onboardingSpotlight?: OnboardingSpotlightState  // 已有
  onboardingEmptyCard?: {
    notesView?:  { dismissedAt: number }
    paperNotes?: { dismissedAt: number }
  }
}
```

**老用户兼容**：字段缺失 → 状态为空对象 `{}` → 所有 key 都未 dismiss → 列表空时正常显示卡。无需迁移逻辑。

### 3.2 IPC 四联通道

| 通道（shared 常量） | 方向 | 参数 | 返回 |
|---|---|---|---|
| `IPC_ONBOARDING_EMPTY_CARD_GET_STATE` | invoke | — | `OnboardingEmptyCardState` |
| `IPC_ONBOARDING_EMPTY_CARD_DISMISS` | invoke | `{ key: OnboardingEmptyCardKey }` | 更新后的 `OnboardingEmptyCardState` |
| `IPC_ONBOARDING_EMPTY_CARD_REPLAY` | invoke | `{ key: OnboardingEmptyCardKey }` | 更新后的 `OnboardingEmptyCardState` |
| `IPC_ONBOARDING_EMPTY_CARD_ON_CHANGED` | event | broadcast | `OnboardingEmptyCardState` |

四联同步检查清单（CLAUDE.md §5）：
- [ ] `packages/shared/src/ipc-channels.ts` — 通道常量 + 请求/响应类型
- [ ] `apps/electron/src/main/ipc.ts` — `ipcMain.handle` 注册，调用 `onboardingEmptyCardService`
- [ ] `apps/electron/src/preload/index.ts` — `window.electronAPI.onboardingEmptyCard.*` 桥接
- [ ] renderer — `useOnboardingEmptyCard` hook 调用

### 3.3 renderer 状态流

```ts
// atoms/onboarding-empty-card-atoms.ts
export const onboardingEmptyCardAtom = atom<OnboardingEmptyCardState>({})

// hooks/useOnboardingEmptyCard.ts
export function useOnboardingEmptyCard(key: OnboardingEmptyCardKey) {
  const state = useAtomValue(onboardingEmptyCardAtom)
  const dismissed = state[key]?.dismissedAt != null
  return {
    dismissed,
    dismiss: () => window.electronAPI.onboardingEmptyCard.dismiss({ key }),
    replay:  () => window.electronAPI.onboardingEmptyCard.replay({ key }),
  }
}
```

**hydrate + 订阅**（App.tsx 初始化区，参考现有 `onboardingSpotlight` 的 hydrate 模式）：
1. App mount → `get-state()` → 写入 `onboardingEmptyCardAtom`
2. 订阅 `on-changed` 事件 → 收到广播后覆盖写 atom（覆盖多窗口一致性）

### 3.4 显示判定（host 侧组合）

**NotesView**（`apps/electron/src/renderer/components/library/NotesView.tsx`）：
```ts
const { dismissed, replay } = useOnboardingEmptyCard('notesView')
const showOnboardingCard = filtered.length === 0 && !query && !dismissed
// search query 有值时不显示 — "搜了没结果"和"还没建过"是两种语义
```

**PaperNotesPanel**（`apps/electron/src/renderer/components/library/PaperNotesPanel.tsx`）：
```ts
const { dismissed, replay } = useOnboardingEmptyCard('paperNotes')
const showOnboardingCard = notes.length === 0 && !dismissed
```

### 3.5 "重看演示" 入口

- **NotesView**：顶栏（"全部证据集"标题右侧）固定一个 `<HelpCircle />` icon button + tooltip `t('emptyCard.replayTooltip')`；点击 → `replay()`
- **PaperNotesPanel**：notes 区 header 同位置一个 `<HelpCircle />`；点击 → `replay()`

icon button 始终显示（不依赖卡片当前是否在显示）——这是"重看"的本质：随时可触发。

---

## 4. SVG 主示意（120×120）

### 4.1 EvidenceSetIntro（NotesView 卡）

**语义**：N 篇论文 → 抽出片段 → 收束成一个集合。

**草图**：
```
  ┌─────────┐ ┌─────────┐ ┌─────────┐
  │ paper A │ │ paper B │ │ paper C │     ← 三张论文卡（小矩形 + 横线）
  └────┬────┘ └────┬────┘ └────┬────┘
       └───────────┼───────────┘
              ┌────▼────┐
              │ 证据集  │                  ← 聚拢容器（带 stack 阴影）
              │  ▤  ▤   │                  ← 内部两条 evidence bar
              └─────────┘
```

### 4.2 PaperNotesIntro（PaperNotesPanel 卡）

**语义**：在 PDF 上划词 → 弹出气泡 → 落为一条 note。

**草图**：
```
  ┌──────────────────────┐
  │ Lorem ipsum [▒▒▒▒] ─ │       ← PDF 页带高亮段
  │ dolor sit amet...    │
  └────────┬─────────────┘
           │
           ▼
       ╭─────────╮                 ← 笔记气泡（圆角矩形 + 角标）
       │  ✏ note │
       ╰─────────╯
```

### 4.3 实施约束

- `<svg viewBox="0 0 120 120">` + `stroke="currentColor"` + `fill="none"` / `fill="currentColor" fill-opacity="0.1"`，**跟随主题色，亮/暗双主题自动适配**
- 容器 stroke 用 `text-muted-foreground/50`，强调要素用 `text-foreground/80`
- **零 Tailwind palette 硬编码**（CLAUDE.md UI 规则 + `asci/no-tailwind-palette` 守门）
- 默认 `aria-hidden`，装饰图形不进无障碍树

---

## 5. i18n 文案

**路径**：`apps/electron/src/renderer/locales/<lang>/onboarding.json` 的根级新增 `emptyCard` 子树（en + zh 双侧同步）。

### 5.1 zh

```json
{
  "emptyCard": {
    "replayTooltip": "重看演示",
    "dismissAriaLabel": "关闭演示",
    "notesView": {
      "title": "证据集 = 跨论文的证据合集",
      "intro": "把多篇论文里支持同一论点的片段集中起来，方便回头查、引、写综述。",
      "steps": {
        "what":   "包含若干论文片段（证据），每条都带原文出处",
        "create": "在 PDF 上划词 → 「加入证据集」；或在 @ 提及里建集",
        "where":  "左栏「全部证据集」按时间倒序看；点开看段落↔论文配对",
        "use":    "写综述 / 写报告时直接引用整集，自动带溯源"
      }
    },
    "paperNotes": {
      "title": "Note = 论文上的轻量批注",
      "intro": "在 PDF 上划词随手记，note 同时收录到证据集里。",
      "steps": {
        "what":   "锚定到 PDF 具体段落的短笔记",
        "create": "选中 PDF 上的文字 → 点弹出气泡里的「记下」",
        "where":  "本论文详情的 Notes 区，或左栏「全部证据集」",
        "use":    "为 @ 引用、综述写作准备可溯源的素材"
      }
    }
  }
}
```

### 5.2 en

```json
{
  "emptyCard": {
    "replayTooltip": "Replay intro",
    "dismissAriaLabel": "Dismiss intro",
    "notesView": {
      "title": "Evidence sets = cross-paper evidence collections",
      "intro": "Group snippets from multiple papers that support the same point — easy to recall, cite, and reuse when writing reviews.",
      "steps": {
        "what":   "Holds several paper snippets (evidence), each with source",
        "create": "Highlight in a PDF → \"Add to evidence set\"; or build one via @ mention",
        "where":  "Left rail \"All evidence sets\" sorted by time; click in to see paragraph↔paper pairs",
        "use":    "Cite the whole set when writing reviews/reports — sources auto-attached"
      }
    },
    "paperNotes": {
      "title": "Note = a lightweight annotation on a paper",
      "intro": "Highlight text in a PDF to jot a quick note — also indexed into evidence sets.",
      "steps": {
        "what":   "Short notes anchored to a specific paragraph in the PDF",
        "create": "Select text in the PDF → click \"Save\" in the popup",
        "where":  "In the Notes panel of this paper, or in left rail \"All evidence sets\"",
        "use":    "Prepare traceable raw material for @ citations and review writing"
      }
    }
  }
}
```

**key-parity** 测试现成覆盖。

---

## 6. 测试与验收

### 6.1 测试矩阵

| 层 | 文件 | 覆盖 |
|---|---|---|
| 主进程单元 | `apps/electron/src/main/lib/onboarding-empty-card-service.test.ts` | `getState` / `dismiss` / `replay` 三态、`subscribe` 通知、settings 字段缺失兼容、重复 dismiss 幂等、replay 后立即 dismiss 仍生效 |
| 共享类型 | (无) | TypeScript 编译即守门 |
| renderer 组件 | (无) | 视觉组件，靠 `bun run dev` 手工验收 |
| i18n | 现成 `key-parity.test.ts` | 自动覆盖新加 key 的 en/zh 对齐 |

### 6.2 Done When（汇总）

1. [ ] `OnboardingEmptyCard` 通用组件 + 两张 SVG 主示意完成
2. [ ] 主进程 service + IPC 四联通道完成（CLAUDE.md §5）
3. [ ] settings.json 类型扩 `onboardingEmptyCard`，老用户字段缺失兼容
4. [ ] NotesView 接入：列表空 + 无 query + 未 dismiss → 显示；顶栏 HelpCircle 重看
5. [ ] PaperNotesPanel 接入：notes 空 + 未 dismiss → 显示；header HelpCircle 重看
6. [ ] i18n key 落 `onboarding.json` 根级 `emptyCard.*`，en + zh 同步
7. [ ] `bun run typecheck` 通过
8. [ ] `bun test` 通过（含 key-parity + 新增 service 测试）
9. [ ] 版本号由 pre-commit 钩子自动 bump（钉到 `origin/main` patch+1），无需手动递增
10. [ ] `bun run dev` 实跑验收：
   - [ ] 全新装（清 `~/.asci-dev/`）→ 进 NotesView 看到卡 / `×` 关闭后不再出现 / `i` 重看出现
   - [ ] PaperNotesPanel 同上验证
   - [ ] 设置页切 zh↔en 各走一遍，无 raw key
11. [ ] issue #438 acceptance criteria 全部勾选，PR 关联 close

---

## 7. 实施顺序建议

写成 implementation plan 时建议分 phase（每 phase 末尾跑一次 typecheck）：

1. **类型 + 主进程 service**（含单元测试）：纯逻辑，独立可验
2. **IPC 四联通道**：shared 常量 → main 注册 → preload 桥接 → renderer atom + hook + hydrate
3. **通用组件 `OnboardingEmptyCard`**：靠 props 渲染，独立可看
4. **两张 SVG 主示意**：纯静态，独立可看
5. **i18n key 落 `onboarding.json`** 双语
6. **NotesView 接入** + **PaperNotesPanel 接入**：组合所有
7. **dev 实跑 golden path** + 双语切换验收

---

## 8. 风险与边界条件

| 风险 | 应对 |
|---|---|
| spotlight 引导期间空状态卡同时显示，视觉打架 | 显示判定可加 `&& !spotlightActive` 守卫——但 spotlight 不指向 NotesView/Library notes，重叠概率低，**先不加，dev 实测如有问题再加** |
| 多窗口场景 dismiss 不同步 | IPC `on-changed` 广播覆盖；hydrate + 订阅双保险 |
| 用户点 replay 后立即又 dismiss，状态机错乱 | service 实现幂等：`replay` = `delete state[key]`；`dismiss` = `state[key] = { dismissedAt: nowMs() }`。互相覆盖即可 |
| `~/.asci/` 老用户升级首次进 NotesView 突然弹卡 | 这是预期行为：老用户首次进入空 NotesView 才弹（如果列表已经有内容则不弹）；卡是教学性的、可关闭，无打断感 |
| key-parity 漏 key | i18n 改动开 PR 前必跑 `bun test`——key-parity 是必跑项 |

---

## 9. 后续可能的迭代（非本期）

- **EvidenceSetDetailSheet 内空状态提示**（已建空集时的"如何加 paired card"指引）—— issue #438 暂不覆盖，留作后续
- **PaperContainingEvidenceSetsPanel 反向提示**—— 看见即懂，不做
- **dismissed 几天后自动重显**——`dismissedAt: number` 已为此预留字段
- **统计 onboarding 触达/转化**—— 0.3.0 公开发布后再看是否需要埋点

---

## 附：与现有机制的关系

| 机制 | 触发 | 范围 | 持久化 | 与本 spec 关系 |
|---|---|---|---|---|
| `SpotlightOverlay V2` | 真·首次安装自动 + 头像菜单"重看引导" | 全局蒙版，跨视图贯穿 | `settings.onboardingSpotlight` | **独立**——不复用状态字段、不复用状态机 |
| `WelcomeEmptyState` | 主视图（conversations）无对话时 | 主视图欢迎卡 | 无 | 视觉语言参考（吉祥物+greeting 风格），不复用组件 |
| `OnboardingEmptyCard`（本 spec） | NotesView/PaperNotesPanel 数据空 + 未 dismiss | 视图内空状态 | `settings.onboardingEmptyCard.<key>` | **新增** |
