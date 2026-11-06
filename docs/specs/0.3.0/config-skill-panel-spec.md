# 配置页 Skill 板块 Spec（Config Skill Panel）

> **状态**：草稿 · 待 review
> **关联 issue**：#421（Epic 2 切片 2.2 / CP-2）
> **关联 PR**：（开 PR 时回填）
> **依赖输入**：#414（2 内置包 A3 契约接入，已 CLOSED）· `docs/specs/0.3.0/0.3.0-prd.md` §1（能力包 vs Skill）/§Epic 2 · `docs/specs/capability-package-spec.md`
> **领域语言事实源**：0.3.0-prd.md §1「能力包 vs Skill」

---

## 1. 概述与定位

左侧「配置」页（[`ConfigView`](../../../apps/electron/src/renderer/components/config/ConfigView.tsx) 已存在）的 **Skill 板块**。当前为 `comingSoon` 占位，本 spec 落地为可用面板：

- 展示当前工作区的**所有 Skill**，标注**来源两类**（系统内置 / 来自能力包）
- 单 Skill **启用/禁用**开关
- 按**来源 / 状态**过滤 + 搜索
- 每个 Skill 的**反向链接**：被哪些能力包引用
- 与能力包板块平级,Settings 不再承载 Skill 管理（消除双入口）

### 1.1 Non-scope（明确不做）

- ❌ 不暴露「从其他工作区导入 / 从源同步」入口（PRD §199：`importSource` 是内部机制，不暴露为「用户自装」）
- ❌ 不开放第三方 Skill 自装（0.3 范围外）
- ❌ 不做批量启停（`skills.json` 已有 `header.*` key，但 #421 AC 未要求，YAGNI）
- ❌ 不做删除入口（启停足够；删除属高级管理，不在本切片）
- ❌ 不做「打开文件夹」按钮（当前无 `shell.openPath` IPC，新增需四联同步；AC 未要求，YAGNI）

## 2. 关键设计决策

### 2.1 「来源两类」由能力包交叉引用派生（不读 `importSource`）

`SkillMeta` 上的 `importSource` 是工作区同步的内部元数据，PRD 明确不暴露。来源判定改为与能力包做交叉引用：

```
被某能力包 manifest.skillRefs 引用 → source = 'capability-package'（来自能力包）
否则                              → source = 'builtin'（系统内置）
```

**好处**：零后端改动；与反向链接同源（同一份 refIndex）。

### 2.2 反向链接 = 同一份交叉引用,自动随能力包刷新（满足 AC3）

「被哪些能力包使用」用同一份反向索引派生。面板挂载 / 收到 `CAPABILITIES_CHANGED` 事件时重新拉取并重建索引，因此卸载/切换能力包后反向链接自动更新——无需额外逻辑。

### 2.3 来自能力包的 Skill 锁定为开启，不可单独禁用

能力包默认启用、不可禁用、开箱即用（#414 Codex 风）。若其引用的 Skill 可被单独禁用，能力包就会缺能力、无法工作——这与「不可禁用」矛盾。因此：

- **来自能力包**的 Skill（`usedByPacks.length > 0`）→ 开关锁定（disabled），由能力包托管；行内显示 🔒 + tooltip「由能力包提供，默认启用、不可单独禁用」。`onToggle` 同时做防御性拦截。
- **系统内置**（无任何有效能力包引用）的 Skill → 才可自由启停。

> 这让「来源两类 + 反向链接」具备实际约束意义，而非纯展示。
> 边界：若某能力包引用了一个磁盘上已禁用的 Skill（数据不一致），开关如实反映 `enabled` 状态但仍锁定；修复该不一致不在本面板职责内。
> manifest 校验失败的包不计入引用（`buildSkillRefIndex` 跳过），其「被引用」的 Skill 视为系统内置、可启停——因为坏包本就不提供能力。

## 3. 架构与数据流

**零新增 IPC**——复用既有通道：

| 数据 | 通道 / API | 现状 |
|------|-----------|------|
| Skill 列表（含 active+inactive） | `window.electronAPI.getWorkspaceSkills(slug)` → `agent:get-skills` | ✅ 已有 |
| 单 Skill 启停 | `window.electronAPI.toggleWorkspaceSkill(slug, skillSlug, enabled)` → `agent:toggle-skill` | ✅ 已有 |
| Skill 目录（打开文件夹） | `window.electronAPI.getWorkspaceSkillsDir(slug)` → `agent:get-skills-dir` | ✅ 已有 |
| 能力包列表（含 `skillRefs[]`） | `window.electronAPI.capabilityPack.list()` | ✅ 已有 |
| 当前工作区 slug | `currentAgentWorkspaceIdAtom` | ✅ 已有 |
| 能力变更事件 | `onCapabilitiesChanged`（`CAPABILITIES_CHANGED`） | ✅ 已有 |

**数据流**：

```
挂载 / CAPABILITIES_CHANGED →
  并行 [ capabilityPack.list(), getWorkspaceSkills(currentWorkspaceId) ]
  → 构建 refIndex: Map<skillSlug, packId[]>
  → 派生 SkillRowVM { ...skillMeta, source, usedByPacks }
  → 渲染（应用 search / sourceFilter / statusFilter）
```

## 4. 组件单元（单一职责）

| 单元 | 职责 | 依赖 |
|------|------|------|
| `SkillPanel`（新增 `components/config/SkillPanel.tsx`） | 拉数据、维护 `search`/`sourceFilter`/`statusFilter` state、订阅 `CAPABILITIES_CHANGED`、loading/error/empty 三态 | `currentAgentWorkspaceIdAtom`、`electronAPI`、`useT('skills')` |
| `SkillRow`（同文件内子组件） | 单 Skill 行：名称（`nameI18n[lang] ?? name`）、描述、来源徽章、`usedByPacks` 行内 chip、`Switch` 启停 | props |
| `filterSkills(skills, {search, source, status})`（纯函数，可单测） | 过滤逻辑 | 无 |
| `buildSkillRefIndex(packs)`（纯函数，可单测） | 构建 `Map<skillSlug, packId[]>` | 无 |

三态、卡片+阴影、语义 token 样式对齐现有 [`CapabilityPackPanel`](../../../apps/electron/src/renderer/components/config/CapabilityPackPanel.tsx)。

## 5. 交互（已确认）

- 顶部：搜索框（`view.searchAll`）
- 两组 chip 过滤器：
  - **来源**：全部 / 系统内置 / 来自能力包
  - **状态**：全部 / 启用 / 禁用（复用 `view.filter.*`）
- 列表：每行展示来源徽章 + 反向链接行内 chip（`来自能力包` 的 skill 显示「被使用：包A、包B」；`系统内置` 仅显示来源徽章无 chip）+ 启停 `Switch`
- 启停：调 `toggleWorkspaceSkill` + 乐观更新；失败回滚 + inline 错误 + 重新拉取校正

## 6. 错误处理

| 场景 | 处理 |
|------|------|
| `currentWorkspaceId` 为空 | 显示「无活动工作区」提示，不调 API |
| `getWorkspaceSkills` / `list()` 抛错 | error 态（对齐 CapabilityPackPanel 的 `loadError` 样式） |
| `toggleWorkspaceSkill` 失败 | 回滚开关态 + inline 错误 + reload 校正 |
| 列表为空 | empty 态（`view.empty.category`） |
| 过滤后为空 | `view.empty.filtered` |

## 7. i18n（en + zh 同步，`skills` ns）

`skills` ns 已有大部分 key（`view.*`/`row.*`/`filter.*`/`categories.*`）。需补：

- `source.builtin` = 系统内置 / Built-in
- `source.fromPack` = 来自能力包 / From capability pack
- 来源过滤标签：`view.filter.sourceAll` / `sourceBuiltin` / `sourceFromPack`（或复用 `source.*`）
- `view.usedBy` = 被使用：{{packs}} / Used by: {{packs}}

`config.json` 的 `skillsPanel.comingSoon` 不再引用 → 删除（en+zh 同步）。改动受 `key-parity.test.ts` 守门。

## 8. 测试（BDD/TDD）

- `filterSkills` 纯函数单测：搜索 / 来源 / 状态 / 组合
- `buildSkillRefIndex` 纯函数单测：多包引用同一 skill、无引用、空列表
- 组件交互在 `bun run dev` 手验 golden path + 切 zh↔en 无 raw key

## 9. AC 映射

| AC | 满足方式 |
|----|---------|
| 展示全部 Skill 含来源 | `getWorkspaceSkills` × `refIndex` 派生 source |
| 单启停 + 来源/状态过滤 | `toggleWorkspaceSkill` + `filterSkills` |
| 反向链接随能力包更新 | `CAPABILITIES_CHANGED` 触发 reload（自动） |
| Settings 无双入口 | 复核确认（探查显示 `settings-tab.ts` 已无 agent/skill tab，大概率已满足；PR 描述说明） |

## 10. 受影响包 / 版本

- `apps/electron`：新增 `SkillPanel.tsx`、改 `ConfigView.tsx`、改 locale `skills`/`config`、新增纯函数单测 → `package.json` patch +1（仅开 PR 时一次）
