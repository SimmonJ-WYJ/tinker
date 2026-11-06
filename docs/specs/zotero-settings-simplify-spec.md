# Zotero 设置页简化 Spec

> **状态**：草稿 · 待 review
> **关联 issue**：（暂无）
> **关联 PR**：（待开）
> **目标分支**：`main`
> **领域语言事实源**：本 spec（未引入新术语）
> **变更范围**：仅渲染层 + i18n 文案；不动 IPC、不动主进程、不动 Zotero 探测逻辑

---

## 1. 背景

### 1.1 现状问题

设置 → Zotero tab 在默认（已正确探测到 Zotero）状态下信息密度过高：

- **7 个 row** 全部展开常驻：Agent 访问 / OCR / ASR / 安装位置 / 数据目录 / PDF 同步 / 生成结构化 TXT
- 每行带 1–3 行 secondary 描述文字
- 两个路径行额外带 input + browse + save，纵向占用最大
- 99% 用户走默认安装位置，**这两块体积换来的几乎都是无用信息**

### 1.2 目标

让默认场景下的 Zotero 设置页**只显示用户日常会切换的部分**，且每行文字成本最低。极端情况（探测失败）下不丢失修复能力。

---

## 2. 现状结构（事实参考）

源码：`apps/electron/src/renderer/components/settings/ZoteroSettings.tsx`（778 行，已偏大）

当前单一 `<SettingsSection title="Zotero 文献库">` 内顺序排布：

| 顺序 | 内容 | 控件 |
|---|---|---|
| 1 | Zotero Agent 访问（含状态 pill + 启动 / 文档按钮） | 主开关 |
| 2 | 图片识别（OCR） | 子开关 + badge "内置" |
| 3 | 语音识别（ASR） | 子开关 + badge "需下载 1GB" |
| 4 | Zotero 安装位置 | input + 浏览 + 保存 + 当前识别副文 |
| 5 | Zotero 数据目录 | input + 浏览 + 保存 |
| 6 | PDF 同步 | 立即同步按钮 |
| 7 | 生成结构化 TXT（实验） | 生成全部按钮 |
| — | `<ZoteroMediaPanel />` `<ZoteroArticlePanel />` | 子面板（**本次不改**） |

i18n：namespace `settings`，键根 `zotero.*`，文件 `locales/{en,zh}/settings/zotero.json`。

---

## 3. 设计方案：B + A 组合

### 3.1 默认视图（99% 场景）

仅显示 **核心三开关** + 一条 **"高级"折叠条**：

```
┌─ Zotero 文献库 ────────────────────────────┐
│  本机搜索文献、读取 PDF，仅本机通信        │
│                                            │
│  [行] Agent 访问            [已连接] [ON]  │
│       允许 Agent 调用 Zotero               │
│                                            │
│  [行] 图片识别 OCR          [内置]   [ON]  │
│       附件含图时自动提取文字               │
│                                            │
│  [行] 语音识别 ASR          [1GB]    [OFF] │
│       附件含音频时转写                     │
│                                            │
│  ┌─ ▶ 高级 · 路径 / 同步 / 实验工具 ─┐    │
│  └────────────────────────────────────┘    │
└────────────────────────────────────────────┘
```

设计要点：

- **删除标题中的"Zotero"前缀**：section 已叫"Zotero 文献库"，每行再 "Zotero Agent 访问" / "Zotero 安装位置" / "Zotero 数据目录" 是噪声。改为"Agent 访问" / "安装位置" / "数据目录"
- **副文压缩**：从一句话整句改成短提示——zh 目标 ≤ 14 个汉字 / en 目标 ≤ 6 个 words（如 "允许 Agent 调用 Zotero" / "Allow agent to call Zotero"）
- **status pill 不动**："已连接 Zotero" → "已连接"（同样去 Zotero 前缀）
- **OCR / ASR 的 badge 文案**："内置" 保留；"需下载 1GB" → "1GB"（badge 本身就在 ASR 行内，含义明确）

### 3.2 展开"高级"

点击"高级"折叠条后展开 4 项：

| 项 | 默认隐藏的副文化策略 |
|---|---|
| 安装位置 | 默认 placeholder + 已识别状态副文；非默认位置时显示当前值 |
| 数据目录 | 留空 placeholder + "默认"提示 |
| PDF 同步 | "检测 Zotero 库 PDF 变动" 一句 + 立即同步按钮 |
| 结构化 TXT（实验） | 一句话描述 + 生成全部按钮 |

`ZoteroMediaPanel` / `ZoteroArticlePanel` 不动（属于附件解析参数，独立判断是否需要后续简化）。

### 3.3 自动展开规则（trade-off 消解）

**当出现任一以下情况时，"高级"组**默认初始为展开状态\*\*：

1. Zotero 未自动探测到（`installPath` 探测状态非 `detected-default`）
2. 用户配置过非空 `installPath`（即 `installPath !== ''`，无论是否等于默认路径——用户**显式**设过就值得让他看到）
3. 用户配置过非空 `dataDir`

同时 "高级"条变成黄色（warning token），文案 "⚠ 自动展开 — 请检查安装位置"。

> **设计意图**：让"路径出问题时要多一步点击"的代价仅在用户实际需要修路径时存在，而不是常态。

### 3.4 折叠状态记忆

用户主动展开 / 折叠后，状态持久化（Jotai atom + 本地 JSON 配置），下次进入页面保留。但 3.3 的"未探测/非默认值"规则**覆盖**用户记忆——即使用户上次折叠了，下次出问题时仍强制展开。

---

## 4. 实现范围

### 4.1 In scope

- `apps/electron/src/renderer/components/settings/ZoteroSettings.tsx` 重排
  - 抽取一个 `<AdvancedGroup>` 子组件（Radix `Collapsible` 包装）
  - 借机把内联的 `ZoteroSubCapabilityRow` / `ZoteroModuleRow` / `ConnectionMasterRow` / `StatusPill` / `CapabilityPill` 抽出到独立文件（**顺手降低 778 行的文件膨胀**，但不重写逻辑）
- `locales/{en,zh}/settings/zotero.json` 同步更新文案 key
- 新增折叠状态 atom（`zoteroAdvancedOpenAtom`），持久化进现有 settings 文件

### 4.2 Out of scope（不做）

- 不改 Zotero 探测 / 路径 IPC 逻辑
- 不改 OCR / ASR 启停业务
- 不动 `ZoteroMediaPanel` / `ZoteroArticlePanel`
- 不引入新 UI 组件库依赖（Radix Collapsible 已在依赖中）

---

## 5. 验收

| # | 标准 |
|---|---|
| 1 | 默认（Zotero 已识别 + 用户走默认路径）进入设置页 Zotero tab，视口里只看到 4 行：section header + Agent 访问 + OCR + ASR + 一条"高级"折叠条 |
| 2 | 折叠状态在 zh / en 两侧文案都正确，`key-parity.test.ts` 通过 |
| 3 | Zotero 探测失败时（卸载 Zotero 或改路径制造），"高级"自动展开 + 黄色提示 |
| 4 | 手动展开 → 退出设置页 → 再进入，保持展开 |
| 5 | `bun run typecheck` + `bun test` 通过 |
| 6 | `bun run dev` 中亮 / 暗主题、zh / en 各走一遍无 raw key |

---

## 6. 待确认（开 spec review 时一并定）

1. ~~**PR 目标分支**~~：已定 `main`
2. **是否同时简化 `ZoteroMediaPanel` / `ZoteroArticlePanel`**？两者各 150–290 行，逻辑可能也有冗余，但属于附件解析参数面板，单独看与本次"页面简洁"目标关联度较低。建议本次不动。
3. **结构化 TXT（实验）是否值得继续保留**？该 row 在折叠后地位降低，但"生成全部"按钮的存在感会更低；是否考虑挪进单独的"实验功能"区？
