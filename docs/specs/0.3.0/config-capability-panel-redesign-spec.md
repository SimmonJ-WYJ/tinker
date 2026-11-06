# 配置页 能力包卡片重做（Codex 风:用户向摘要 + 渐进展开）

> 状态:设计已批准,待实现
> 关联 milestone:0.3（Epic 2 能力包配置化,`docs/specs/0.3.0/0.3.0-prd.md`）
> 关联 spec:`docs/specs/0.3.0/config-skill-panel-spec.md`(Skill 板块,本 spec 与之视觉对齐)
> 领域语言事实源:0.3 PRD §1

## 背景与问题

配置页「能力包」板块（`CapabilityPackPanel`）当前把 manifest 的 `scenarioAgent.description`（写给 LLM 的英文 Agent 路由 prompt,如 `Route here whenever…` / `Turn 1 dispatches…` / `terminal_skill`）原样铺给用户看。问题:

1. **描述是 Agent 路由 prompt,不是用户向能力介绍** —— 用户读不懂、也不需要读。
2. **无渐进展开** —— 整段长文一次性铺开,两个包占满整屏,无法快速扫读。
3. **元信息是 `dl` 键值文字** —— 密度高、不扫读、与 Skill 板块风格不统一。
4. **没有"开箱即用"状态表达** —— 用户不清楚"没有启停开关是有意设计"(Codex 风默认启用、不可禁用)。

## 目标

对齐 0.3 PRD「Codex 风开箱即用 + 只读总览」与 Skill 板块视觉:卡片显示**用户向一句话摘要 + 渐进展开 + 内置徽章 + 标签化元信息**。其余功能逻辑不变(能力包仍默认启用、不可禁用/卸载/导入)。

非目标:不动 Agent prompt(summary 仅 UI 展示,不注入 prompt);不动 Skill 板块;不动 `schema/manifest.schema.json`(那是数据导出 ExportManifest 的 schema,与能力包无关)。

## 方案

### 数据层(P0:用户向摘要 `summaryI18n`)

照搬 Skill 的 `nameI18n` 模式(`{ zh?, en? }` 内嵌 manifest,与包定义同源)。

| 单元 | 改动 |
|------|------|
| `packages/shared/src/schemas/capability-pack.ts` | `CapabilityPackManifest`(`.strict()` zod)加 `summaryI18n: z.object({ zh: z.string().optional(), en: z.string().optional() }).optional()` |
| `packages/shared/src/types/capability-pack-ipc.ts` | `CapabilityPackListItem` 加 `summaryI18n?: { zh?: string; en?: string }` |
| `apps/electron/src/main/lib/capability-pack-service.ts` | 列表转换时透传 `summaryI18n`(仅 `manifestValid` 包) |
| `apps/electron/default-capability-packs/lit-review/manifest.json` | 加 `summaryI18n`(中英一句话:把已整理的论文写成文献综述 / Write a literature review from curated papers） |
| `apps/electron/default-capability-packs/lit-search/manifest.json` | 加 `summaryI18n`(中英一句话:按主题/作者/引用检索发现论文 / Search & discover papers by topic, author, or citations） |

渲染回退:`summaryI18n[lang] ?? description`(旧包/无摘要仍显示原 description,向后兼容)。抽纯函数 `resolvePackSummary(pack, lang)`(可单测)。

### UI 层(Codex 风 master-detail:列表 → 详情页)

`CapabilityPackPanel` 持本地导航 state `selectedPackId: string | null`(不引路由):`null` → 列表,否则 → 该包详情。返回置 `null`。

**一级 — 列表(`CapabilityPackList`)**:紧凑卡片,整卡可点进详情。
- 正常包:`[图标] packId` + 一句话 summary + `🔒 内置·默认启用` 徽章 + 右侧 chevron。
- 坏包(`!manifestValid`):卡片显示 manifestError 标签;可点进详情看错误详情。

**二级 — 详情(`CapabilityPackDetail`)**:
- 顶部:`← 返回` + packId + `v{version}` + `内置·默认启用` 徽章。
- **说明**:summary + 「完整说明」(原 `description` / Agent 路由 prompt 全文,详情页里完整展开,不折叠)。
- **Includes**(只读行,Codex 风):
  - 场景 Agent:`[Boxes] scenarioAgentName`
  - 每个 `skillRefs`:`[Puzzle] <slug>`(来自能力包→锁定态,不可单独禁用,行尾 🔒 提示)
  - 每个 `mcpRefs`:`[Plug] <name>` + ⚙ 按钮 → `setSettingsTab('mcp'); setSettingsOpen(true)` 跳 Settings MCP tab
- 坏包详情:显示 manifestError 全文 + manifestErrorHint,不显示 Includes。
- **裁掉**:Hero 示例气泡、Information 表(开发者/官网/隐私/ToS)、包内偏好编辑(无对应数据/IPC,留后续)。

**P2 徽章**(列表+详情):`🔒 内置·默认启用`,讲清"无启停开关是有意的"。
**P4 对齐**:卡片密度/徽章/行样式与 `SkillPanel` 统一。
**Skill tab**:保持现状不动(系统内置 Skill 的启停/来源/反向链接/过滤)。

### i18n（`apps/electron/src/renderer/locales/{en,zh}/config.json`,key-parity 守门）

新增:`capabilityPacks.builtinBadge`(内置·默认启用)、`capabilityPacks.fullDescription`(完整说明)、`capabilityPacks.back`(返回)、`capabilityPacks.includes`(包含)、`capabilityPacks.skillLockedHint`(由能力包提供,默认启用)、`capabilityPacks.openMcpSettings`(MCP 设置)。chip/行标签复用现有 `metaScenarioAgent` / `metaSkills` / `metaMcps`。

## 数据流

```
manifest.summaryI18n
  → zod parse（capability-pack.ts，可选字段）
  → capability-pack-service 透传
  → CapabilityPackListItem.summaryI18n（IPC）
  → capabilityPack.list()
  → CapabilityPackPanel: resolvePackSummary(pack, lang) = summaryI18n[lang] ?? description
```

## 测试

- `resolvePackSummary` 纯函数单测:有 summaryI18n[lang] / 缺当前语言回退另一语言或 description / 全缺回退 description。
- zod schema:含 `summaryI18n` 的 manifest 解析通过;不含时也通过(optional)。
- key-parity:新 config.json 键 en/zh 对齐。
- 手验:`bun run dev` 折叠/展开、切 zh↔en、坏包分支。

## 受影响文件

- 改:`packages/shared/src/schemas/capability-pack.ts`、`packages/shared/src/types/capability-pack-ipc.ts`、`apps/electron/src/main/lib/capability-pack-service.ts`、`apps/electron/default-capability-packs/{lit-review,lit-search}/manifest.json`、`apps/electron/src/renderer/components/config/CapabilityPackPanel.tsx`、`locales/{en,zh}/config.json`
- 新增:`resolvePackSummary` 纯函数(panel 同目录 utils 或文件内)+ 单测
