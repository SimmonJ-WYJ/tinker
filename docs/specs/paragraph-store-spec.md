# 论文段落库 Spec（Paragraph / Block Store）

> **状态**：草稿 · 待 review
> **关联 issue**：待建
> **关联 PR**：待开
> **依赖输入**：现有 structured `.txt` 链路（`zotero-structured-txt/`、`zotero-pdf-parser/strategies/structured/`）、`config-paths.ts`
> **领域语言事实源**：本 spec §2 术语表

---

## 1. 背景与目标

### 1.1 诉求

把整篇 PDF **确定性地分段存进数据库**，之后能**随时、快速、零 LLM、零生成 token**地按"论文 + 章节 / 段落"取回原文内容。

### 1.2 先厘清两个事实（消除误解）

- **`read_article_section` 读 `.txt` 时不是 LLM**：structured `.txt` 是 pdfjs 确定性解析产物，按节读取是毫秒级文件读，不调模型。慢 / 耗 token 的只有"生成 `.article.md` 摘要"那一层，与取段落无关。
- **现有 `chunks` 表是「检索优化的有损子集」**：经 `isLowQualityText` 过滤、`truncateAtReferences` 截断、短段合并 / 长段切分，实测覆盖率仅 53–68%。**不能当完整段落库用**。

### 1.3 现有产物

| 产物 | 完整性 | 用途 |
|------|--------|------|
| `~/.asci/zotero/wiki/{key}.txt` | **完整**（pdfjs 全文 + 结构） | 全文取原文（本 spec 的数据源） |
| `vector-index.db` 的 `chunks` 表 | 有损（检索子集） | 语义 / FTS 检索 |

### 1.4 已决定（用户拍板）

- 形态：**程序化 SQL 查 → 新建段落表**（非"够用就读文件"）。
- 范围：**全存忠实全文** —— 含参考文献 / 公式 / 表格等"噪声段"，不复用 `isLowQualityText` 过滤。
- 暴露面：**先只做 service 层函数**，暂不加 MCP 工具 / IPC（消费方明确后再加）。

### 1.5 关键发现（驱动粒度设计）

实测 LoRA 的 structured `.txt`：**20 个 `<p id>` 段落，但有 31 个 heading + 13 个列表行**。大量内容（章节标题、列表、表格、参考文献条目）**不在 `<p id>` 里**。

→ **结论：只存 `<p id>` 段落 ≠ 忠实全文，会漏掉过半结构。** 段落库必须按"结构块（block）"存，而非仅 `<p>` 段落。

### 1.5.1 数据准确度边界（重要）

段落库是 structured `.txt` 的**忠实镜像**：**既不增加也不修复解析错误，准确度天花板 = txt 解析准确度**（garbage in, garbage out）。基于库内 65 篇实测：

| 现象 | 实测 | 性质 |
|------|------|------|
| section 号空洞 / 错号 | **0/65** | 章节边界结构可靠 → `getSection` 不会指错章 |
| 声明 section 无对应 `<p id>` 段落 | 15/65 (23%) | **多非错误**：该章内容是表格/列表/图（无 prose）→ **正是"全存 block"覆盖的场景；只存 `<p>` 会丢整章** |
| 公式/表格区乱码（数学粗体 / 替换符） | 10/65 (15%) | **真实损失**：pdfjs 对公式/表格抽取差，乱码会**原样入库**，影响**局部 block 文本**，正文 prose 不受影响 |

**取舍**：
- 章节定位可靠 → 段落库的"按节取原文"核心价值成立；受损的是部分 block 的文本内容（公式/表格），非结构。
- 库 rebuildable → 后续改进 pdfjs 抽取器，重建即回溯修复（**修抽取器是另一独立工作，不在本 spec**）。
- 存 `byte_range` + raw → 可随时对照 / 重导。
- **加每篇解析质量标记**（见 §3.2 `block_source`）→ 消费方能识别哪些论文/章节内容可信、哪些存疑，而非盲信。

### 1.6 非目标

- 不替代向量库检索（语义 / FTS 仍走 `chunks`）；段落库只负责"确定性按位置取原文"。
- 不生成任何 LLM 摘要（与 `.article.md` 无关）。
- 不改 structured `.txt` 的生成逻辑（段落库是其只读派生）。

---

## 2. 术语表

| 术语 | 含义 |
|------|------|
| **block（结构块）** | structured txt body 里的一个结构单元：heading / paragraph(`<p id>`) / list / table / preamble |
| **section_index** | 章节号（= `<p id="pS_P">` 的 S，= heading "N." 前缀的 N；preamble = 0） |
| **para_id** | 段落锚点 `pS_P`（仅 paragraph 块有；与 chunks/锚点、`read_article_section` 一致） |

---

## 3. 设计

### 3.1 数据源与派生关系

```
PDF → (pdfjs) structured .txt   ← 已有，确定性、完整
        │  本 spec 只读解析它，不改它
        ▼
   解析 body → 结构块序列 → upsert 到 blocks 表（确定性，无 LLM）
```

向量库 `chunks`（检索）与本表（取原文）**用 attachment_key + para_id 对齐**：语义检索命中 chunk → 看其 anchor 的 S → 本表按 section_index 取整节。

### 3.2 表结构（faithful blocks）

落独立库 `~/.asci/zotero/paragraphs.db`（**模型无关**，仅依赖 txt；与 embedding 生命周期解耦，换嵌入模型不重建）。

```sql
CREATE TABLE blocks (
  id             INTEGER PRIMARY KEY,
  attachment_key TEXT NOT NULL,
  section_index  INTEGER NOT NULL,         -- S；preamble=0
  section_title  TEXT,                     -- 来自 OUTLINE / heading 文本
  block_order    INTEGER NOT NULL,         -- 篇内全局顺序（重建原文用）
  block_type     TEXT NOT NULL CHECK (block_type IN ('heading','paragraph','list','table','preamble')),
  para_id        TEXT,                      -- "p3_1"，仅 paragraph 有
  content        TEXT NOT NULL,             -- 块原文（trim）
  byte_start     INTEGER, byte_end INTEGER  -- 在 .txt 内的字节范围
);
CREATE INDEX idx_blocks_key_section ON blocks(attachment_key, section_index, block_order);
CREATE UNIQUE INDEX idx_blocks_para ON blocks(attachment_key, para_id) WHERE para_id IS NOT NULL;

-- 增量 + 解析质量标记（§1.5.1）：消费方据此识别可信度
CREATE TABLE block_source (
  attachment_key   TEXT PRIMARY KEY,
  txt_hash         TEXT NOT NULL,
  built_at         INTEGER NOT NULL,
  format_version   INTEGER,                 -- txt frontmatter 的 format_version
  block_count      INTEGER NOT NULL,
  garble_ratio     REAL NOT NULL,           -- 乱码字符占比（数学粗体/替换符等），高=公式表格区不可信
  sections_no_prose INTEGER NOT NULL        -- 声明了但无 <p> 段落的章节数（多为表格/图章节）
);
```

> `garble_ratio` / `sections_no_prose` 是**确定性派生指标**（解析时顺手算），零额外成本，用于在查询侧给出"本篇/本章内容可信度"提示。

> 全存：references / 公式 / 表格作为 `list`/`table`/`paragraph` 块照常入库，**不过滤**。

### 3.3 查询 API（service 层，纯 SQL，无 token）

`zotero-paragraph-store/index.ts` 暴露：

```ts
getSection(key, sectionIndex | sectionTitle): Block[]   // 按节取全块，block_order 升序
getParagraph(key, paraId): Block | null                 // 按锚点精确取
listSections(key): {index, title}[]                     // 章节目录
getFullText(key): Block[]                               // 整篇按 block_order
```

### 3.4 写入时机（确定性，跟随 txt 生成）

structured `.txt` 写完即派生（与 `generateStructuredTxtForOne` / 全量入口同时机）：解析 txt body → 结构块 → 按 `txt_hash` 增量 upsert。**不挂在 embedding worker 上**（段落库须独立于"是否开启语义检索"而可用）。

### 3.5 对外暴露（已定：仅 service 层）

**本期只暴露 §3.3 的 service 函数**，不加 MCP 工具 / IPC。后续消费方明确后再加：
- 若 Agent 要用 → MCP 工具 `papers_read_section`（确定性、替代 `read_article_section` 的 txt 路，更快且完整）；
- 若 UI 要展示 → IPC 四联同步。

---

## 4. 开放问题

**已定**：暴露面 = 仅 service 层（§3.5）。

**待 review 拍板**（已给推荐默认，可推翻）：

1. **块解析来源**：解析已持久化的 `.txt` body（解耦、稳）vs 复用 classifier 的 token 流（结构更准但需重跑 pdfjs）。倾向**解析 txt body**。
2. **库归属**：独立 `paragraphs.db`（推荐，模型无关）vs 复用 `vector-index.db`（对齐方便但随换模型被连带重建）。
3. **list/table 粒度**：列表整段存一行，还是逐条？表格存原始文本块即可还是要结构化？倾向**先整块存原文**，不结构化。

---

## 5. 实现计划

| 阶段 | 内容 | 产出 |
|------|------|------|
| P0 | `paragraphs.db` schema + open/ensureSchema（参照 vector-db.ts 的 better-sqlite3 封装） | 建库可用 |
| P1 | txt body → 结构块解析器（heading/`<p id>`/list/table/preamble + section/byteRange）+ 单测 | 纯函数，覆盖各块型 |
| P2 | 派生写入：txt-ready hook + `txt_hash` 增量 upsert | 库随 txt 自动填充 |
| P3 | 查询 service（getSection / getParagraph / listSections / getFullText）+ 单测 | 可 SQL 取原文（本期交付终点） |
| P4 | 全量回填脚本（对已有库的所有 .txt 建表，dev 工具，参照 rag-reindex） | 一键回填 |

> 暴露面仅 service 层（§3.5）；MCP 工具 / IPC 暂不做，待消费方明确。

### 5.1 受影响的包与版本号

- `apps/electron`：新增段落库服务 + 写入 hook → patch 递增（开 PR 时一次）。
- 本期不涉 IPC / MCP（仅 service 层）；不涉 i18n（无面向用户文案）。

### 5.2 风险

- structured `.txt` 格式（`format_version`）变更会影响块解析器 → 解析器按 `format_version` 容错，未知版本告警降级。
- 全存导致体积上升（含 references）：纯文本、单篇几十~几百 KB，可接受；`paragraphs.db` 与 vector-index.db 同量级。

---

## 6. Done When

1. [ ] 解析器单测覆盖 heading / paragraph / list / table / preamble + 多级 section。
2. [ ] 任一已解析论文：`getSection(key,'PROBLEM STATEMENT')` 与 `getFullText` 返回完整、顺序正确、含 references。
3. [ ] 增量：txt 未变不重建；txt 变更后表同步。
4. [ ] 段落库独立于 embedding 开关可用（语义检索关掉也能查）。
5. [ ] `bun run typecheck` / `bun test` 通过。
6. [ ] 暴露面仅 service 层（无 MCP/IPC）。
7. [ ] 版本号 patch 已递增（开 PR 时）。
