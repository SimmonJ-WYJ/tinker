# 数据导出（DO-2）Spec：一键导出 zip + ajv 校验

> **状态**：已实现 · 待 PR review（grill 会话 2026-06-02 产出，同日实现）
> **变更（2026-07-02）**：CitationRelation 0.4 功能废弃（#718），导出契约由 6 类收敛为 5 类
> （移除 `citation-relations.json` 与内嵌 `citation-relation.schema.json`；`exportFormatVersion`
> 保持 1）。详见 [`0.4.0/remove-citation-relation-spec.md`](./0.4.0/remove-citation-relation-spec.md)；
> 本文正文保留历史 6 类口径不改写。
> **关联 issue**：#419（DO-2）· #243（O1 文档化，本 spec 为其解除 schema 本体阻塞）· #214（A-1，schema 推迟决策来源）
> **关联 PR**：待开（分支 `feat/issue-419-do2-export-zip`）
> **领域语言事实源**：[`CONTEXT.md`](../../CONTEXT.md) §数据所有权（Data Ownership）
> **PRD 来源**：[`docs/specs/0.3.0/0.3.0-prd.md`](./0.3.0/0.3.0-prd.md) Epic 4 切片 4.2

---

## 1. 目标与验收

用户在 Settings 账户 tab 点"导出我的数据"→ 得到 zip **导出包**，覆盖全部 6 类持久研究对象，
内容符合 **O1 对象标准**（开放 JSON Schema）且导出时经 ajv 校验通过——数据是行业可解析
标准格式而非私有 dump（GDPR Art.20 可携带权）。

| # | 验收（来自 issue / PRD） |
|---|------|
| DO-2 | 点"导出我的数据" → 得 zip 包 → 用 ajv 对 O1 schema 校验通过 |
| DO-O1 | 对象 JSON Schema 在仓库 `schema/` 可查，覆盖全部导出对象类型 |

## 2. 关键决策（grill 会话裁决）

| # | 决策点 | 裁决 | 理由 |
|---|--------|------|------|
| D1 | schema 本体归属 | **纳入本分支**（#419 不再等 #243） | 依赖链实为"schema 本体 → #419 导出 / #243 文档化"，本体此前无人认领；导出与 schema 同 PR 联调，ajv 校验有真实标的。#243 解除阻塞后只剩 README 文档化 |
| D2 | schema 生成方式 | **`ts-json-schema-generator` 从 TS interface 生成**（`objects/index.ts` 头注释预研的选项 A） | TS 保持唯一真相源；选项 B（zod）违反 `@asci/shared` 零运行时依赖原则 |
| D3 | 软删对象 | **全部导出，保留 `visibility` 字段** | 导出是完整携出而非视图；排除软删会令 EvidenceRef 出现悬空 ID；schema 本含三态 |
| D4 | 文件粒度 | **每类型一个 JSON 数组文件** | 与 Zotero 等工具导出惯例一致，任何语言一行可解析；科研数据量级（MB）内存无压力 |
| D5 | ajv 失败行为 | **中止导出 + 明确报错**（含失败对象类型/ID），不产出半成品 zip | 校验失败 = 数据与 schema 漂移，属 bug；靠 drift 测试在 CI 拦截，线上几乎不触发；守住"导出即合规"承诺 |
| D6 | zip / ajv 选型 | **fflate 0.8.x**（zip）+ **ajv 8.x**，均打进 `main.cjs`（不进 external） | fflate 零依赖纯 JS、`zipSync` 一步到位；yazl 需流式拼装，archiver/jszip 依赖树重且旧 |
| D7 | 交互形态 | **同步 IPC**：按钮 → `showSaveDialog` → loading 态 → toast + `shell.showItemInFolder` | 与现有 `SAVE_IMAGE_AS` 模式一致；MB 级数据 <1s，无需进度事件通道 |
| D8 | 范围裁决 | workspace 级 `papers.jsonl` **不纳入**（Agent 会话产物，非 O1 对象）；Proposal **只生成 schema 不导出**（0.3 已将 Proposal 功能移出，见 PRD Epic 3 Out of Scope） | issue 列表即 6 类导出对象；schema 生成 7 个全覆盖成本为零，供 #243 用。注：`proposals` 表存在（001-initial.sql），但功能已移出 0.3，导出范围按 issue |

## 3. 代码事实（设计依据）

- 6 类对象 TS 类型：`packages/shared/src/types/objects/*.ts`（7 个对象 + `common.ts` 原语）
- 存储：SQLite `~/.asci/asci.db`（`papers` / `evidence_refs` / `notes` / `evidence_sets` /
  `citation_relations` / `reviews` + `evidence_set_refs` join 表）；repository 层在
  `apps/electron/src/main/lib/objects/repositories/`，已把 join 拍平进 TS 类型（如 `EvidenceSet.evidenceRefIds`）
- Review 正文外存：`Review.bodyPath` 为**绝对路径**（或空时兜底 `~/.asci/reviews/{id}.{md,html}`）
- 仅 EvidenceSet 按 `workspaceId` 隔离（导出跨全部 workspace，保留该字段）
- `ObjectId` 是 branded string（`common.ts:12`），生成 schema 时需后处理降级为 `{"type":"string"}`
- 现无 zip / ajv 依赖；Save As 模式参照 `ipc.ts` 的 `ATTACHMENT_IPC_CHANNELS.SAVE_IMAGE_AS`

## 4. 设计

### 4.1 O1 Schema 生成（仓库根 `schema/`）

```
schema/objects/
  paper.schema.json
  evidence-ref.schema.json
  note.schema.json
  evidence-set.schema.json
  citation-relation.schema.json
  review.schema.json
  proposal.schema.json        # 仅 schema，不导出（Proposal 功能 0.3 移出）
```

- 生成脚本：`scripts/generate-object-schemas.ts`（root devDependency `ts-json-schema-generator`）
  - 输入 `packages/shared/src/types/objects/index.ts`，逐对象产出独立 `*.schema.json`
  - 后处理：`ObjectId`（branded string）→ `{"type":"string"}`；`$id` 形如
    `https://opensci.io/asci/schema/objects/paper.schema.json`；draft-07（生成器原生输出，ajv 8 默认支持）
  - 另生成 `schema/manifest.schema.json`（`ExportManifest`，源 `packages/shared/src/types/data-export.ts`）——导入方先校验清单再解析数据
  - **语言中立**：`jsDoc: 'none'`，schema 不输出 `description`，只承载结构；字段语义以 TS 中文注释为准（drift 测试加 `"description"` 守门）
- **drift 守门测试**：`scripts/generate-object-schemas.test.ts` —— 重新生成 ≡ 已提交文件，
  TS 类型改动而 schema 未再生成时 CI 失败

### 4.2 导出服务（主进程）

新文件 `apps/electron/src/main/lib/objects/export-service.ts`：

1. 经 6 个 repository 读全量（含软删；EvidenceSet 跨全部 workspace）
2. 逐条 ajv 校验（schema 经 esbuild `--loader:.json` 内联或文本导入）；任一失败 →
   抛出含 `{ kind, id, errors }` 的错误，**不落盘**
3. Review 正文：按 `bodyPath` / 兜底路径读文件，写入包内 `reviews/bodies/{id}.{md,html}`；
   导出 JSON 中 `bodyPath` **改写为包内相对路径**（不泄漏用户文件系统结构）；正文文件缺失时
   置空并在 manifest `warnings` 记录
4. `fflate.zipSync` 组包 → 写入用户在 save dialog 选定的路径

### 4.3 导出包结构

```
asci-export-2026-06-02.zip
├── manifest.json            # exportFormatVersion / appVersion / exportedAt /
│                            # files[{path, schema, count}] / warnings[]
├── papers.json              # Paper[]
├── notes.json               # Note[]
├── evidence-refs.json       # EvidenceRef[]
├── evidence-sets.json       # EvidenceSet[]
├── citation-relations.json  # CitationRelation[]
├── reviews.json             # Review[]（bodyPath 已改写为包内相对路径）
├── reviews/bodies/{id}.md|html
└── schema/                  # O1 schema 副本（自描述，离线可校验）
```

### 4.4 IPC 四联

| 层 | 位置 | 内容 |
|----|------|------|
| 常量+类型 | `packages/shared/src/types/data-export.ts` | `DATA_EXPORT_IPC_CHANNELS.EXPORT_MY_DATA`；`ExportMyDataResult = { status: 'ok', filePath, counts } \| { status: 'canceled' } \| { status: 'error', message }` |
| main | `apps/electron/src/main/ipc.ts` | handler：`dialog.showSaveDialog`（默认名 `asci-export-<date>.zip`）→ `export-service` → 成功后 `shell.showItemInFolder` |
| preload | `apps/electron/src/preload/index.ts` | `exportMyData(): Promise<ExportMyDataResult>` |
| renderer | `ProfileSettings.tsx` | 按钮调用 + loading / toast |

### 4.5 UI 与 i18n

- `apps/electron/src/renderer/components/settings/ProfileSettings.tsx` 账户 tab 新增
  "数据导出"卡片：说明文案（覆盖范围 + 开放标准一句话）+ "导出我的数据"按钮
- i18n：`settings` ns 下 `profile.dataExport.*`，en + zh 同步（key-parity 守门）

### 4.6 测试

| 测试 | 验证 |
|------|------|
| schema drift（`bun test`） | 生成 ≡ 已提交，TS↔schema 不漂移 |
| export-service 单测 | bun:sqlite 内存库植入 6 类样例（含软删 + 缺正文 Review）→ 导出 → 解 zip 断言结构 / manifest 计数 / bodyPath 改写 / ajv 全过 |
| 校验失败路径 | 植入违规行 → 断言中止、无落盘、错误含 kind+id |

## 5. 实现计划

1. **Phase 1 — schema**：生成脚本 + 7 份 schema + drift 测试（解除 #243 阻塞，可先行 review）
2. **Phase 2 — 导出服务**：fflate/ajv 依赖 + export-service + 单测
3. **Phase 3 — IPC + UI**：四联 + ProfileSettings 卡片 + i18n en/zh
4. **收尾**：`typecheck` / `bun test` / `dist:fast` 冒烟（fflate 进 main.cjs 验证）；
   版本递增：`packages/shared`、`apps/electron`（+ 根 `package.json` 若加 devDependency）

## 6. Out of Scope

- 导入 / 恢复（导出 ≠ 备份，见 CONTEXT.md）
- DO-3 删账户（同 Epic 另一切片）
- workspace 级 `papers.jsonl`、Agent 会话记录、Skill / MCP 配置
- schema 拆独立 repo、第三方 SDK 发布（V1）
- 进度事件通道（数据量级不需要；未来大库再加）

## 7. 残留开放问题

- ~~`manifest.json` 自身是否也配一份 schema？~~ 已配：`schema/manifest.schema.json` 同走生成器 + drift 守门
- `exportedAt` / zip 文件名日期取系统时钟即可（无确定性要求）
