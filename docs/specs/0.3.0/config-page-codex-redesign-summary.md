# 配置页 Codex 风重做 — 改动总结

> 范围:配置页「能力包」+「Skill」两个板块的交互/视觉重做(对齐 Codex 插件市场的列表→详情心智)。
> 关联:0.3 PRD Epic 2(能力包配置化)、`config-capability-panel-redesign-spec.md`、`config-skill-panel-spec.md`(#421)。
> 状态:已实现、本地验证通过,未开 PR(版本号待开 PR 时统一递增)。

## 目标

把配置页两个板块从"把后端 manifest/SKILL 元数据原样平铺"改成 Codex 风的**紧凑卡片 + 渐进式详情**:
- 列表只给用户向的精简信息;完整/技术细节进二级(详情页 / 弹窗)。
- 明确"内置·默认启用"是有意设计(无启停开关不是缺失)。
- 筛选分主/次级,空间紧凑。

---

## 一、能力包面板(CapabilityPackPanel)

**从「行内展开的长卡片」改为「网格列表 → 详情页」(master-detail)。**

- **数据层 — 新增用户向摘要 `summaryI18n`**(照搬 Skill 的 `nameI18n` 模式,manifest 内嵌 `{ zh?, en? }`):
  - `packages/shared/src/schemas/capability-pack.ts`:Zod `CapabilityPackManifest` 加可选 `summaryI18n`。
  - `packages/shared/src/types/capability-pack-ipc.ts`:`CapabilityPackListItem` 加 `summaryI18n?`。
  - `apps/electron/src/main/lib/capability-pack-service.ts`:列表转换透传。
  - 2 个内置包 manifest(lit-review / lit-search)各加一句中英摘要。
  - 新增纯函数 `resolvePackSummary(pack, lang)`:`summaryI18n[lang] → 另一语言 → description` 回退(向后兼容)+ 单测。
- **一级列表**:响应式网格紧凑卡片(`[包名] + 一句话摘要 + 🔒 内置·默认启用 徽章`),整卡可点。
- **二级详情页**(本地 `selectedPackId` 状态,无路由):返回 + 包名/版本/徽章 + 说明 + **完整说明**(原 Agent 路由 prompt)+ **Includes**(场景 Agent / Skill / MCP 只读行,MCP 行带 ⚙ 跳 Settings 的 MCP tab)。
- **裁掉**:Hero 示例气泡、Information 表(开发者/官网/隐私)、包内偏好编辑(无对应数据,留后续)。
- 关键:**不再把 Agent 路由 prompt 当描述直接给用户看**(收进详情页「完整说明」)。

## 二、Skill 面板(SkillPanel)

**从「单列富行」改为「网格卡片 → 详情弹窗」,开关外露,排序稳定,筛选分层。**

- **网格列表**:响应式网格紧凑卡片(`[Puzzle 图标] 名称 + 来源徽章 + 一行截断描述 + 外露开关`)。
- **开关外露在卡片右侧**:列表里直接启停(点开关只切换);点卡片其余区域 → 详情弹窗。来自能力包的 Skill 开关锁定 🔒(不可单独禁用)。
- **禁用态原地变灰**:关掉后整卡 `opacity` 变灰,**不重排、不消失、不跳位**。
- **稳定排序**:渲染层按名称固定排序(与 enabled 无关),修复"切换后卡片跳到禁用区找不到"的问题。
- **详情弹窗**(`SkillDetailDialog`):名称 + 来源徽章 + 完整描述 + 反向链接(被哪些能力包使用)+ 启停开关(同锁定逻辑)。
- **筛选工具栏(紧凑单行)**:
  - 搜索框 + **状态(主筛选,分段控件)**:全部/已启用/已禁用,计数基于全量。
  - **来源(次级筛选,下拉)**:所有来源/系统内置/来自能力包;**计数随状态联动**(在已选状态范围内统计各来源)。
  - 行尾**结果数**:`N 个 · 未筛选/已筛选`。
  - 移除了旧的平铺 ghost chip + 竖线分隔。

## 三、i18n(en + zh,key-parity 守门)

- `config.json`:能力包详情新增 `builtinBadge` / `fullDescription` / `back` / `includes` / `skillLockedHint` / `openMcpSettings`(及早期的 expand/collapse 占位,未用)。
- `skills.json`:筛选区新增 `statusLabel` / `sourceLabel` / `resultUnit` / `resultStateAll` / `resultStateFiltered`;`filter.all` 文案「全部」→「全部状态 / All statuses」消歧。

## 受影响文件

```
packages/shared/src/schemas/capability-pack.ts          (summaryI18n zod)
packages/shared/src/types/capability-pack-ipc.ts        (summaryI18n 类型)
apps/electron/src/main/lib/capability-pack-service.ts   (透传)
apps/electron/default-capability-packs/lit-review/manifest.json   (摘要)
apps/electron/default-capability-packs/lit-search/manifest.json   (摘要)
apps/electron/src/renderer/components/config/CapabilityPackPanel.tsx  (list→detail)
apps/electron/src/renderer/components/config/capability-pack-utils.ts(+.test)  (resolvePackSummary)
apps/electron/src/renderer/components/config/SkillPanel.tsx  (grid+dialog+toolbar)
apps/electron/src/renderer/locales/{en,zh}/config.json
apps/electron/src/renderer/locales/{en,zh}/skills.json
docs/specs/0.3.0/config-capability-panel-redesign-spec.md  (设计 spec)
```

## 验证

- `bun run typecheck`:全包通过(注:期间补装了 pull 后缺的 `fflate` 依赖,与本改动无关)。
- `bun test`:全量通过(含 i18n key-parity 双语对齐、`resolvePackSummary` 纯函数单测)。
- `eslint`:改动文件干净。
- UI 交互在 `bun run dev` 中逐项手验(列表↔详情、弹窗、开关外露不跳位、筛选联动、切 zh↔en)。

## 备注

- 按更新后的 CLAUDE.md,**版本号只在开 PR 时统一递增一次**,本批改动未 bump。
- 能力包详情页的「包内偏好编辑」、Skill/能力包的 Information 元数据(开发者/官网/隐私/示例 prompt)因无对应数据字段,本轮裁掉,留后续(需 manifest 补字段)。
