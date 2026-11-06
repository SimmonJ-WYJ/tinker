# ADR-003：UI 设计系统分层

| 字段 | 内容 |
|------|------|
| **状态** | Accepted（方案 B） |
| **决策时点硬约束** | 在 `docs/design.md` 落笔之前，且在 P0 引入 ESLint 调色板色拦截之前 |
| **拍板日期** | 2026-05-20 |
| **拍板人** | Riting |
| **作者** | Yannik |
| **关联** | [CLAUDE.md §2 UI 规则](../../CLAUDE.md)、本次会话 UI 三层分析、参照项目（Multica/AINEOS 类）截图、签字 issue [#170](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/170) / [#291](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/291)、后续 PR 链 [#292](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/292)–[#298](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/298)、spin-off [#299](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/299) |

---

## 一、背景

### 触发

2026-05-12 会话对 ASCI 当前 UI 体系做了"规范层 / 实现层 / 注入层"三层分析，结论：

- **规范层**：只在 `CLAUDE.md §2` 有一行"ShadcnUI 风格，卡片+阴影替代边框，主题饱满色彩"，缺集中的设计规范文档。
- **实现层**：`components/ui/`（shadcn 17 件）+ `components/settings/primitives/`（13 件 + `SettingsUIConstants.ts`）做得扎实；但 token 与非 token 样式（utility class、主题 override、特殊场景 hack）全部混在 `apps/electron/src/renderer/styles/globals.css` 一个 796 行文件里，没有清晰边界。
- **注入层**：TS 严格模式 + i18n 类型补全 + `key-parity.test.ts` 守住了**文案**，但**完全没有守视觉**——业务代码中硬编码 Tailwind 调色板色 ≥124 处（`bg-red-500 / bg-green-500 / bg-zinc-900 / border-blue-500/60 ...`），分布在 15+ 文件。这意味着 ocean / forest / slate 三组共 6 套替代主题"看上去都对"是假象，切到非默认主题时上述硬编码颜色不跟随主题。

参照截图中的优秀项目，UI 设计系统通常被拆成清晰的四层：**规范层（design.md）/ 实现层（tokens.css）/ 注入层（globals.css）/ 工作流层（plan/spec 把 design.md 当真相源）**。本 ADR 决策 ASCI 是否引入类似分层、如何落地。

### 项目级硬约束

- CLAUDE.md §2：ShadcnUI 风格，卡片+阴影替代边框，主题饱满色彩（保留）
- CLAUDE.md §7.3：所有包 `"type": "module"`，导入带 `.ts` 扩展名（影响 packages/ui 是否能直接 import CSS）
- Monorepo 现状：`packages/ui/` 当前只有 React 组件（code-block / mermaid-block / hooks），没有 styles 目录
- 当前 7 套主题切换走 CSS 变量 + body class（`.dark / .theme-ocean-light / .theme-ocean-dark / .theme-forest-* / .theme-slate-*`），不能在重构中被破坏

---

## 二、决策维度

| 维度 | 关键问题 |
|------|---------|
| **真相源单一性** | 颜色 / 间距 / 圆角 / 阴影 / 状态色的语义定义放在哪里？谁说了算？ |
| **代码-文档一致性** | 规范文档（人读）与 token 文件（机器读）如何保持同步，不漂移？ |
| **主题安全性** | 7 套主题切换不跑色的可验证性——靠人眼？lint？VRT？ |
| **业务接入成本** | 业务方写 UI 时认知负担：要查几个文件？默认 import 什么？ |
| **未来 Web 端兼容** | 若未来出 Web 版 / 移动端，token 能否跨 app 复用 |
| **Agent / 新人可读性** | Agent 写 UI 代码时能否仅凭一个文件就能正确使用 token；新人 onboard 时是否有"唯一真相源" |
| **重构破坏面** | 引入分层是否需要大规模 import 修改、构建配置变更 |
| **守门机制** | 是否配套 lint / test，防止硬编码增量 |

---

## 三、候选方案

### 方案 A：四层分层（规范 / 实现 / 注入 / 工作流），token 下沉到 `packages/ui/styles/`

参照截图项目结构：

```
packages/ui/
  styles/
    tokens.css          # 实现层：CSS 变量真相源（7 套主题、状态色、间距、圆角等）
    base.css            # base layer（border-border、body bg/fg）
docs/
  design.md             # 规范层：人/Agent 读的"宪法"——token 字典、组件使用规则、反模式
  adr/ADR-003-*.md      # 本文件
apps/electron/src/renderer/styles/
  globals.css           # 注入层：import @asci/ui/styles/tokens.css + 项目独有 utility（scrollbar-* / mask-fade-y / titlebar-drag-region 等）
```

工作流层：在 `CLAUDE.md §2 UI` 行 + `docs/superpowers/specs/*` spec 模板里明确"视觉相关决策以 design.md 为准；token 以 packages/ui/styles/tokens.css 为准"。

- **优点**：
  - 真相源最清晰：规范看 design.md，token 看 tokens.css，注入只剩"哪里要包一层壳"
  - 为未来 Web 端 / 多 app 共享 token 提前留好接口（`packages/ui` 是天然消费点）
  - Agent 读取 token 只需读 `packages/ui/styles/tokens.css` 一个文件
- **缺点**：
  - 改动面最大：要拆 globals.css（796 行）、动 packages/ui 的 build 产物（需要确认 Vite 能从 workspace 包 import 纯 CSS）
  - 短期内对单 app 项目"过度工程"——目前只有 apps/electron 一个消费者
  - 多人协作时 `packages/ui/styles` 的修改责任不如单文件清晰
- **各维度评估**：真相源 🟢 / 一致性 🟡（仍需 lint）/ 主题安全 🟡 / 接入成本 🟡 / Web 兼容 🟢 / Agent 可读 🟢 / 破坏面 🔴 / 守门 🟡

### 方案 B：三层分层（规范 / 实现 / 注入），token 保留在 `apps/electron`，但**拆文件**

不引入 `packages/ui/styles/`，但把 `globals.css` 拆成多个文件：

```
apps/electron/src/renderer/styles/
  tokens.css            # 实现层：7 套主题 CSS 变量
  base.css              # base layer + body 样式
  utilities.css         # scrollbar / mask-fade-y / shadow-minimal / shell-bg 等项目 utility
  theme-overrides.css   # 各主题对特定组件的细节覆盖（mode-slider / session-item-selected / tabbar-bg 等）
  globals.css           # 注入层：仅做 @import 串联 + @tailwind 三件套
docs/
  design.md             # 规范层
```

- **优点**：
  - 改动面适中：不动 monorepo 包边界，只在 `apps/electron/src/renderer/styles/` 内部拆文件
  - 文件职责清晰，token vs utility vs theme-override 各管各的
  - 仍能写 design.md 把规范层补齐
- **缺点**：
  - 没有给未来 Web 端 / 多 app 留接口；如果以后做 Web 版还要再迁
  - token 与 React 组件没有同包，"组件即设计系统"的故事讲不通
- **各维度评估**：真相源 🟢 / 一致性 🟡 / 主题安全 🟡 / 接入成本 🟢 / Web 兼容 🔴 / Agent 可读 🟢 / 破坏面 🟡 / 守门 🟡

### 方案 C：仅补规范层 + 守门，不动实现/注入结构

维持 `apps/electron/src/renderer/styles/globals.css` 一个文件不拆，只做两件事：

1. 写 `docs/design.md` 作为规范层（含 token 字典、组件使用规则、反模式清单）
2. 加 ESLint 规则拦截硬编码调色板色（`bg-(red|blue|green|...)-\d+` 等）
3. 在 globals.css 头部加段注释说明 token 在哪行起、utility 在哪行起，作为人肉分区

- **优点**：
  - 改动面最小：0.5–1 天内可完成
  - 不引入新构建依赖、不影响打包
  - 规范层补齐 + 增量守门，已经能解决"色彩跑题"问题
- **缺点**：
  - globals.css 仍是 796 行单文件，长期维护负担不减
  - 没有给未来 Web 端留接口
  - token 与 utility 混在一起，"哪些是设计系统、哪些是项目 hack"边界模糊
- **各维度评估**：真相源 🟡 / 一致性 🟡 / 主题安全 🟡 / 接入成本 🟢 / Web 兼容 🔴 / Agent 可读 🟡 / 破坏面 🟢 / 守门 🟢

---

## 四、已排除方案

- **D：完全照搬截图项目的 monorepo 布局（web + desktop 双 app 共享 packages/ui）** — ASCI 当前没有 Web 端规划，过度对齐。若未来出 Web 版，方案 A 的 `packages/ui/styles/` 已经预留入口，届时新增 `apps/web` 即可。
- **E：用 Tailwind v4 `@theme` 指令重写 token** — Tailwind v4 当前对 Electron + Vite 生态兼容度尚未稳定（截至 2026-05），且对现有 CSS 变量 + v3 体系侵入过大，与 0.2 milestone 时间窗口不匹配。
- **F：放弃语义 token，全量使用 Tailwind 调色板** — 与 CLAUDE.md §2 "多主题"约束直接冲突，且会让 7 套现有主题失效。

---

## 五、决策

**结论：选定方案 B**（三层分层 / token 在 `apps/electron` 内拆文件 / 新增 `docs/design.md`）。

### 投票记录（issue #170）

| 角色 | 票 | 关键依据 |
|------|----|---------|
| @xela-G（UI 设计师） | B | 已有 `design(1).md` 初稿可作 ASCI 化基础；`--success` / `--warning` 状态 token 有必要新增 |
| @itpretty（前端开发） | B | repo 实测硬编码 palette 125 处 / 44 文件；A 短期收益不抵成本（无第二消费者）；C 不拆只会持续膨胀；B 是"未来无痛升 A"的中间态 |
| @pantsbang-yannik（草稿作者） | B | 与草稿推荐一致；同步决定清理 6 套扩展主题 dead code，仅保留 light + dark |

### 升 A 条款

若 0.3 milestone 锁定 Web 端规划，则跳过中间态、直接升方案 A（`packages/ui/styles/` 下沉 token）。届时 B 落地拆出的 `tokens.css` 可整体迁包，无需二次重构内容。@liningftp 在 0.3 north-star 起草时复评。

### 后续 PR 链（按依赖序）

| # | 内容 | 负责 | 状态 |
|---|------|------|------|
| #291 | B-1 ADR-003 签字 + CLAUDE.md 文案 + 版本号（本 PR） | @itpretty | 进行中 |
| #292 | B-2 拆 6 文件 + 新增语义 token + tailwind extend + postcss-import | @itpretty | 待启动 |
| #293 | B-3 迁 tool-result-renderers 硬编码 → token（~31 处 / 7 文件） | @itpretty | 待 B-2 |
| #294 | B-4 迁 settings & forms（~20 处 / 6 文件，可与 B-5 并行） | @itpretty | 待 B-2 |
| #295 | B-5 迁剩余业务组件（~74 处 / 28 文件，可与 B-4 并行） | @itpretty | 待 B-2 |
| #296 | B-6 ESLint 调色板拦截 + CI gate | @itpretty | 待 B-3/4/5 |
| #297 | B-7 `docs/design.md` ASCI 化起草 | @xela-G | 与 B-2 同步 |
| #298 | B-8 `token-parity.test.ts` 守门 design.md ↔ tokens.css | @itpretty | 待 B-2/B-7 |

### Spin-off（独立，不阻塞 B 链）

- **#299**：Wire system-preference-driven `.dark` toggle（settings + IPC + atom + UI + i18n 四联同步）。dark mode 实际接通工作。

---

## 六、后果

### 共同后果（无论选 A / B / C）

- 新增文档：`docs/design.md`（规范层，含 token 字典、组件使用规则、反模式清单、提交前检查项）
- 新增守门：ESLint 规则禁用 className 中的 Tailwind 调色板色（`bg|text|border-(red|blue|green|gray|yellow|slate|zinc|amber|orange|emerald|cyan|sky|indigo|violet|purple|pink|rose)-\d+`）
- 新增 token：`--success / --warning` 两组（7 套主题各 +2 行），让现有 124 处硬编码有"语义出口"
- 存量迁移：分文件 PR 把 124 处硬编码迁到语义 token，预估 1–2 天
- 更新 `CLAUDE.md §2 UI` 行，明确"颜色必须用 token，禁止 Tailwind 调色板色；详见 `docs/design.md`"

### 方案 A 额外后果

- 需验证 Vite + Electron renderer 是否能从 workspace 包 `import '@asci/ui/styles/tokens.css'`（理论上可以，但需打包冒烟）
- `packages/ui/package.json` 需暴露 `./styles/*` exports 字段
- `apps/electron` 与 `packages/ui` 版本号同步递增

### 方案 B 额外后果

- 拆文件后用 `@import` 串联，需确认 Vite + PostCSS 处理顺序不影响 `@tailwind base/components/utilities` 的注入顺序
- 7 套主题的细节覆盖（`mode-slider / session-item-selected / tabbar-bg`）需要决策：留在 `theme-overrides.css` 还是迁到对应组件的 CSS module / styled className

### 方案 C 额外后果

- globals.css 继续单文件，需在头部加导航注释；新增 token 时仍可能误改 utility 区
- 长期可能再开一个 ADR 重做拆分

### 风险

| 风险 | 缓解 |
|------|------|
| 拆文件后 PostCSS `@import` 顺序错乱导致 Tailwind layer 失效 | 拆完后跑 `bun run electron:build` 冒烟 + 设置页切 zh↔en 各主题手动验证 |
| 存量 124 处硬编码迁移引入回归 | 分文件 PR，每个 PR 在 `bun run dev` 下逐一切 7 套主题验证目标组件 |
| ESLint 规则误伤合理场景（如 `tool-result-renderers` 的 diff 配色确有语义） | 规则配 allowlist + 在 `docs/design.md` 反模式清单中明确"diff 行底色"等例外语义需走专用 token |
| design.md 与 tokens.css 漂移 | 在 design.md 顶部明确"token 真相源 = `<path>/tokens.css`"；token 字典表用表格形式逐条标注 CSS 变量名 |

### 后续动作

1. 本 ADR 签字 → ✅ #291（本 PR）
2. 落地选定方案的文件结构 → #292（B-2）
3. 写 `docs/design.md` 规范层（建议由 ui-designer Agent 雀尼克承担初稿）→ #297（B-7）
4. 加 ESLint 规则 → #296（B-6）
5. 分文件 PR 迁移存量硬编码 → #293 / #294 / #295（B-3/4/5）
6. token-parity 测试守门 → #298（B-8）
7. dark toggle 接通 → #299（spin-off）
8. （可选）引入 Storybook / Playwright VRT 做 light + dark 截图回归

---

## 七、实际执行轨迹（透明度说明）

本 ADR 是**部分追溯文档**：

| 时点 | 事件 |
|------|------|
| 2026-05-12 | Yannik 提出 UI 三层分析，起草 ADR-003 Draft |
| 2026-04-18（先于签字）| commit [`99c45ea4`](https://github.com/OPENSCI-Labs/ASCI-Alpha/commit/99c45ea4) "refactor: 移除主题切换和品牌 Logo 下载（阶段 4）" 已删除 6 套扩展主题 dead code 及 `renderer/atoms/theme.ts` / `AppearanceSettings.tsx` / `AppSettings.themeMode` / `ThemeStyle` / `GET_SYSTEM_THEME` IPC 等 1173 行 |
| 2026-05-13 | @itpretty 在 #170 审计确认 dead code 清理已完成，原 B-1 PR 范围中 globals.css 清理项已被前置 commit 吸收 |
| 2026-05-20 | 三人投票汇齐（@xela-G / @itpretty / @pantsbang-yannik 皆 B），本 ADR 签字落地 |

**与 [ADR-000](./ADR-000-common-convention.md) 协作规范的关系**：违反「决策先行」期望。dead code 清理由 commit 99c45ea4 在 ADR 签字前 32 天落地，原因是阶段 4 重构与 ADR-003 讨论并行排期、清理动作收敛快于 ADR 评议。比照 [ADR-001](./ADR-001-local-storage.md) §决策时间线模板公开记录，后续 ADR 一律先签后实现。

**对后续 PR 的影响**：B-1（#291）仅剩纯文档收尾（本 ADR 签字 + CLAUDE.md L44 文案更新 + 版本号递增），B-2 起按计划执行，结构不受影响。
