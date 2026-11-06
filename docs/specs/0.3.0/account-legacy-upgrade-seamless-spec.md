# 账户：老用户升级无缝 + 预期管理文案 技术方案（Legacy Upgrade Seamless Spec）

> **状态**：已实现 · 待 review
> **关联 issue**：[#425](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/425)（Epic 1 切片 1.4，U-A4/U-A6）
> **关联 PR**：待开
> **决策落地**：B 段取「**全删**」而非「修复计数」——见 §4.B
> **领域语言事实源**：`docs/specs/0.3.0/0.3.0-prd.md` §1 数据三分 + Epic 1
> **依赖输入**：#420（OPENSCI 登录端到端，已落地：commit `5b98caf9` / `account-oauth-arch-spec.md` §8）
> **阻塞**：无（#420 已合入）

---

## 1. 背景与问题

PRD §3 差异对照里有一条**架构反转**：

| north-star 原假设 | 0.3 PRD 结论 |
|------------------|-------------|
| 研究数据**按账户隔离** | **设备级单一本地库**（对齐 Zotero），账户仅身份标识；老用户旧库**登录即用，无认领流程** |

但当前代码是按"老假设（账户隔离 + 认领）"实现的——登录链路（#420/#531）落地时，连带搭进了一整套 **"老用户认领（attribution）流程"**，与 0.3 已拍板的"设备级、无认领"直接冲突。本方案就是把这套流程**拆除**、补齐 U-A6 预期管理文案，并加守门测试锁死 U-A4。

### 1.1 两个核心发现

**发现一：认领流程是"过时的"（与 PRD 决策冲突）。**
现有 `LoginPage` 在登录页顶部展示 `UpgradeNotice` banner（带一个"将本地数据关联到此账户"复选框），登录时调 `auth.attributeLocalData()` 往 `~/.asci/owner.json` 写 `OwnerMarker{ uid, attributedFrom }`，并保留了一个 `ConflictWarning` 对话框（"本地数据归属于另一账户，如何处理？"）。**这正是 PRD 明令删除的"认领流程"** ——设备级库语义下，"数据归属某账户"这个概念本身不成立（US11：同设备换账户看到同一份库）。

**发现二：认领流程是"坏的"（扫描了错误的存储位置）。**
`auth-upgrade.ts:scanLocalData()` 通过**数 `~/.asci/papers/`、`~/.asci/notes/`、`~/.asci/evidence-sets/` 目录下的 `.json` 文件个数**来判断"有无本地数据"。但研究数据实际存在 **SQLite（`~/.asci/asci.db`，7 张表）**，根本没有这三个 per-object JSON 目录。结论：对所有真实用户 `hasLocalData` 恒为 `false`，banner 永不展示、`AccountMenu` 的"本地数据计数"永远为空——**这段代码当前对真实用户完全是死逻辑**。

> 旁证：`ConflictWarning.tsx` 已经是**纯死代码**（全仓除自身外无任何引用，grep 零命中）。

### 1.2 为什么 U-A4 其实"几乎天然成立"

研究数据（`asci.db` + JSONL + review bodies）与系统底座凭据（`channels.json` / `settings.json` / `mcp.json` / `proxy-settings.json` / `zotero/`）**全部设备级、落 `~/.asci/`、schema 中无任何 `uid/accountId/ownerId` 列、查询只按 `workspace_id` 过滤**（见 `config-paths.ts`、`migrations/001-initial.sql`）。登录只是 UI 门（`RouteGuard`），不迁移、不重定位、不清空任何存储路径。

因此 U-A4（老用户升级 + 首次登录 → 数据/配置直接可见可用）的工程量**不是"做迁移"，而是"拆掉挡在前面的认领流程 + 加测试锁死这个不变量"**。

---

## 2. 目标与非目标

### 目标
1. **U-A4**：老用户升级 + 首次 OPENSCI 登录 → 已有论文库/笔记/证据集直接可见；Zotero/Provider/代理/MCP 立即可用、无需重填、**无认领步骤**。
2. **U-A6**：欢迎页（LoginPage）/账户页（ProfileSettings）含"研究数据仅存本地"明确文案。
3. 拆除过时 + 坏掉的认领流程，消除登录页"关联数据"复选框这一**与"无缝"直接冲突**的摩擦点。

### 非目标
- 跨设备同步（0.4，且**不承诺时间表**）。
- 同机多账户的数据隔离（0.3 = 设备级共享，刻意不做）。
- 对象级 `ownerUid`、服务端身份映射表（归服务端闭源仓 / 0.4）。
- DO2 导出 / DO3 删账户（Epic 4，另 issue）。

---

## 3. ⚠️ 文案口径修订（必须先对齐）

issue #425 正文写的是 *"0.3 研究数据仅存本地、跨设备同步**将在 0.4 提供**"*。但 PRD Epic 1（2026-06-01 grill 修订，spec `account-oauth-arch-spec` 同步）**已撤销"0.4 提供同步"的承诺**：

> ⚠️ 原承诺"跨设备同步将在 0.4 提供"已**撤销**——0.4 不做 sync，且**不再对用户承诺同步时间表**。本 Epic 文案统一为"数据仅本地、不承诺时间表"。

**本方案以 PRD 为准**（CLAUDE.md：PRD 冲突处以 PRD 为准）。所有面向用户文案**只说"研究数据仅存本地；换设备暂时看不到数据是预期行为"，绝不出现"0.4 / 将在……提供"等时间承诺。** 这点需在 review 时与 issue 作者确认。

---

## 4. 技术方案

四块改动：**A 拆认领** / **B 修设备库探测** / **C 预期文案** / **D 守门测试**。

### A. 拆除认领（attribution）流程

| 动作 | 落点 |
|------|------|
| 删组件 | `renderer/components/auth/UpgradeNotice.tsx`、`renderer/components/auth/ConflictWarning.tsx`（后者已是死代码） |
| 删 i18n 段 | `locales/{en,zh}/auth/upgrade.json`、`locales/{en,zh}/auth/conflict.json` |
| 改聚合器 | `locales/{en,zh}/auth.ts`：移除 `upgrade` / `conflict` 的 import 与导出键 |
| 删 IPC 通道 | `shared/types/auth-ipc.ts`：删 `ATTRIBUTE_LOCAL_DATA`（`SCAN_LOCAL_DATA` 保留，见 B） |
| 删主进程 handler | `main/ipc.ts:2784` 的 `ATTRIBUTE_LOCAL_DATA` 注册 |
| 删 preload 桥接 | `preload/index.ts` 的 `attributeLocalData` 方法 + 类型（约 :968 / :1899） |
| 删 service 方法 | `auth-service.ts:attributeLocalData()`（:304-315） |
| 删类型 | `shared/types/auth.ts`：删 `OwnerMarker` interface、`LocalDataSnapshot.attributedTo` 字段 |
| 删 owner.json 读写 | `auth-upgrade.ts`：删 `readOwnerMarker` / `writeOwnerMarker` / `FILE_OWNER` / `OwnerMarker` 引用 |
| 改登录页逻辑 | `LoginPage.tsx`：删 `UpgradeNotice` 渲染、`attributeData` state、`attributeLocalData()` 调用（:37,:54-56,:69-76） |

> **owner.json 清理**：历史上若有用户已写过 `~/.asci/owner.json`（实测路径不命中，几乎不会有），它将变成无人读取的孤儿文件，无副作用、无需主动删除（保守起见可在 review 决定是否加一次性清理；倾向不加，避免动用户目录）。

### B. 全删"设备库探测"子系统（最终决策）

> **决策（2026-06-15）**：原 spec 在"修复计数"与"全删"间留了选择，最终取**全删**——理由：① 用户诉求是"清掉休眠的认领代码"；② 这条计数当前对真实用户恒为空（扫错位置），从没被用户见过，"修复"等于**新增**一个 reassurance 功能而非清理；③ 全删避免给主进程引入 `auth → object-store` 的新耦合。"数据还在"的安抚由 §C 的文案承担即可。

落地为彻底移除整条链路：

- 删 `SCAN_LOCAL_DATA` 通道、`localDataSnapshotAtom`、`auth-service.scanLocalData()`、`auth-upgrade.ts` 整文件、`AuthServiceDeps.userDataPath`。
- 删 `LocalDataSnapshot` 类型本身（不再有任何消费方）。
- `useAuth.ts` 启动初始化去掉 `scanLocalData()` 调用（只留 `getCurrentUser` + `getSessionMeta`）。
- `AccountMenu.tsx` 删"本地数据计数"整块 + `menu.localData` / `menu.localDataCounts` i18n key。

> 净效果：登录初始化更轻（少一次 IPC），主进程零新增耦合。

### C. 预期管理文案（U-A6）

新增 i18n key（en + zh 同步，走 `useT('auth')`）：

- `auth/login.json` 增 `localDataNotice`：登录页登录按钮下方一行小字脚注。
  - en: `"Your research data stays on this device only. Switching devices won't show it — that's expected."`
  - zh: `"你的研究数据仅存本地。换设备暂时看不到数据属于预期行为。"`
- `auth/profile.json` 增 `dataLocality.title` + `dataLocality.body`：账户 tab（`ProfileSettings`）内一块只读说明卡。
  - title en: `"Where your data lives"` / zh: `"你的数据存在哪里"`
  - body en: `"Research data (papers, notes, evidence sets) is stored locally in ~/.asci/ on this device. It is not uploaded and does not sync across devices."`
  - body zh: `"研究数据（论文、笔记、证据集）仅保存在本机 ~/.asci/，不会上传，也不跨设备同步。"`

落点：
- `LoginPage.tsx`：在登录按钮区块下方加 `localDataNotice`（非 oauthPending 态展示）。
- `ProfileSettings.tsx`：在账户信息区下方加 `dataLocality` 只读卡（用语义 token，卡片+柔和背景，符合 `docs/design.md`）。

> 文案严守 §3 口径：**不提任何同步时间表**。

### D. 验证（实际执行）

因 B 段取全删、认领子系统连同 `auth-upgrade.ts` + 其单测一并移除，原计划的"scanLocalData 真实计数"测试**失去对象、不再适用**。实际验证以"删除不破坏既有契约"为准：

1. `bun run typecheck`：全 monorepo 通过（含 shared 类型删除的连锁）。
2. `bun test`：全量 **2535 pass / 0 fail**（含原 9 个 auth 测试文件 80 pass——确认删通道/方法未破坏登录链路）。
3. `key-parity.test.ts`：通过（删 `upgrade`/`conflict` 段 + `menu.localData*` key、增 `login.localDataNotice` + `profile.dataLocality.*` 后 en/zh 仍对齐）。
4. grep 级零残留：`scanLocalData|attributeLocalData|LocalDataSnapshot|OwnerMarker|UpgradeNotice|ConflictWarning|localDataSnapshotAtom|SCAN_LOCAL_DATA|ATTRIBUTE_LOCAL_DATA|auth-upgrade` 在 `apps/electron/src` + `packages/shared/src` 命中 0。

> U-A4"存储设备级、登录不重定位"这一不变量本就由 `config-paths.ts`（路径只随 `ASCI_DEV` 切换、无 uid 段）保证，本次未改动该层，无需新增冗余路径测试。

---

## 5. IPC 四联同步影响

| 层 | 改动 |
|----|------|
| `shared/types/auth-ipc.ts` | 删 `ATTRIBUTE_LOCAL_DATA` + `SCAN_LOCAL_DATA` 常量 |
| `shared/types/auth.ts` | 删 `LocalDataSnapshot` + `OwnerMarker` |
| `main/ipc.ts` | 删 `ATTRIBUTE_LOCAL_DATA` + `SCAN_LOCAL_DATA` handler |
| `preload/index.ts` | 删 `auth.attributeLocalData` + `auth.scanLocalData`（类型 + 桥接 + `LocalDataSnapshot` import） |
| `renderer` | `LoginPage` 去认领 + 加 `localDataNotice`；`AccountMenu` 去计数；`auth-atoms` 删 `localDataSnapshotAtom`；`useAuth` 去 `scanLocalData` 调用 |

---

## 6. 文件改动清单

**删除**
- `apps/electron/src/renderer/components/auth/UpgradeNotice.tsx`
- `apps/electron/src/renderer/components/auth/ConflictWarning.tsx`
- `apps/electron/src/renderer/locales/{en,zh}/auth/upgrade.json`
- `apps/electron/src/renderer/locales/{en,zh}/auth/conflict.json`
- `apps/electron/src/main/lib/auth-upgrade.ts`
- `apps/electron/src/main/lib/auth-upgrade.test.ts`

**修改**
- `packages/shared/src/types/auth.ts`（删 `LocalDataSnapshot` + `OwnerMarker`）
- `packages/shared/src/types/auth-ipc.ts`（删 `ATTRIBUTE_LOCAL_DATA` + `SCAN_LOCAL_DATA`）
- `apps/electron/src/main/lib/auth-service.ts`（删 `scanLocalData`/`attributeLocalData` + `userDataPath` dep + 相关 import）
- `apps/electron/src/main/index.ts`（去 `AuthService` 的 `userDataPath` 注入）
- `apps/electron/src/main/ipc.ts`（删 2 个 handler）
- `apps/electron/src/preload/index.ts`（删桥接 + 类型 + import）
- `apps/electron/src/renderer/atoms/auth-atoms.ts`（删 `localDataSnapshotAtom`）
- `apps/electron/src/renderer/hooks/useAuth.ts`（去 `scanLocalData` 调用）
- `apps/electron/src/renderer/components/auth/LoginPage.tsx`（去认领 + 加 `localDataNotice`）
- `apps/electron/src/renderer/components/auth/AccountMenu.tsx`（删本地数据计数块）
- `apps/electron/src/renderer/components/settings/ProfileSettings.tsx`（加 `dataLocality` 卡）
- `apps/electron/src/renderer/locales/{en,zh}/auth.ts`（聚合器去 upgrade/conflict）
- `apps/electron/src/renderer/locales/{en,zh}/auth/login.json`（加 `localDataNotice`）
- `apps/electron/src/renderer/locales/{en,zh}/auth/menu.json`（删 `localData`/`localDataCounts`）
- `apps/electron/src/renderer/locales/{en,zh}/auth/profile.json`（加 `dataLocality.*`）

**版本号递增（已做）**
- `apps/electron`：`0.1.466 → 0.1.467`
- `packages/shared`：`0.1.107 → 0.1.108`（因 auth 类型/通道改动）

---

## 7. 验收映射

| 验收 | 本方案如何满足 |
|------|---------------|
| U-A4（数据 + 配置登录即用、无重填、无认领） | A 拆掉认领 banner/复选框/对话框 → 登录后直达；存储天然设备级（D 测试锁死路径不变量 + scan 真实计数）；config 设备级共享天然满足 |
| U-A6（欢迎页/账户页"仅本地"文案） | C 在 LoginPage（`localDataNotice`）+ ProfileSettings（`dataLocality` 卡）落文案，en/zh 同步，**不承诺同步时间表** |

---

## 8. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 删类型/通道触及 #420 骨架，编译连锁 | 改动集中在 attribution 子集；`bun run typecheck` 全量校验；`SCAN_LOCAL_DATA` 保留降低面 |
| `scanLocalData` 改读对象库引入主进程 → 对象库耦合 | 仅 `import` 既有 repository list 函数 + 取长度，无新建查询；DB 未初始化兜底返回 0 |
| 文案口径与 issue 正文不一致 | §3 已显式标注，review 时与作者对齐，以 PRD 为准 |
| 历史 owner.json 孤儿文件 | 无副作用（无人读）；倾向不主动清理用户目录 |

回滚：本方案为减法 + 文案，单 PR squash；如需回滚直接 revert PR。

---

**Spec 版本**：v1 · 2026-06-15 · 草稿待 review
