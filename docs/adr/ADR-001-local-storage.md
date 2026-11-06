# ADR-001：本地存储后端选型

| 字段 | 内容 |
|------|------|
| **状态** | Accepted |
| **决策时点硬约束** | 0.2 V6e issue 开出之前 |
| **拍板日期** | 2026-05-20 |
| **拍板人** | liningftp |
| **作者** | Dev D |
| **关联** | [0.2 north-star §六 F3](../milestones/0.2/north-star.md)、PR [#284](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/284)、issue [#214](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/214) / [#221](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/221) / [#222](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/222) / [#235](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/235) |

---

## 决策时间线（透明度说明）

本 ADR 是**追溯文档**：SQLite 实现已在 PR [#284](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/284)（2026-05-19 merged）落地，本 ADR（2026-05-20 签字）将该既成事实正式化。

时序倒挂原因：A-1 (#214)、A-2 (#221) 与本 ADR (#215) 在 0.2 Week 1 并行排期，PR #284 评审过程中 SQLite 方向已收敛并被实现，未先等 ADR 签字。

与 [ADR-000](./ADR-000-common-convention.md) 协作规范的关系：违反 "决策先行" 期望。本次例外公开记录于此，后续 ADR 一律先签后实现。

---

## 一、背景

0.2 milestone 引入科研对象模型（Paper / EvidenceRef / Note / EvidenceSet / CitationRelation / Proposal / Review）。其中 V6e 审计标准要求 "100+ Note 时按 Paper 反查关联 Note 的响应时间与 Note 总量无关" —— 这需要**二级索引能力**，纯 JSON 文件做不到。

本 ADR 决策 0.2 起 ASCI 桌面端的本地存储后端方案。结论一旦签字即为后续实现依据；变更需走 ADR 修订流程。

**触发约束**：ADR-001 必须在 V6e 实现 issue（#222 A-3 / #235 C-7）启动之前完成；否则 V6e 验证标准跑不通。

**项目级硬约束（来自旧版 CLAUDE.md §2，已随本 ADR 修订）**：
- 本地优先（JSON 配置 / JSONL 日志）
- 旧文："不采用本地数据库" —— 与 V6e 索引需求冲突，本 ADR 修订该原则（详见 §四 与 CLAUDE.md §2 关系段落）
- 避免默认用 localStorage（保留）

---

## 二、决策维度

| 维度 | 关键问题 |
|------|---------|
| **性能** | 100+ / 1k+ / 10k+ EvidenceRef 下的查询 / 写入延迟基线 |
| **索引能力** | 是否原生支持二级索引、多关系 join、全文检索 |
| **跨平台** | macOS / Windows / Linux 一致性，是否需 native binary 打包 |
| **备份恢复** | 文件级备份 vs 数据库 dump，单文件 vs 目录树 |
| **升级迁移** | schema 演进策略，旧版本数据如何迁移 |
| **离线优先** | 完全离线运行的可靠性 |
| **与 Agent SDK 兼容性** | 是否阻塞 Electron 主进程、与 SDK 子进程的并发模型 |
| **Electron 打包成本** | 二进制大小、code signing 影响 |
| **与 CLAUDE.md §2 原则一致性** | 是否符合 "本地优先 / 不采用数据库 / JSON 配置" 的现有约束；若不符合，是否值得重新评估原则 |

---

## 三、候选方案

### 方案 A：JSON 文件 + 自写 indexer

- **优点**：人类可读 / 零依赖 / 与现有 `~/.asci/` 风格一致 / 备份即文件拷贝
- **缺点**：V6e 100+ Note 反查必须自写 indexer；扩到 1k+ / 10k+ 时索引一致性、并发写、崩溃恢复都要重新发明；schema 迁移也要自写
- **8 维评估**：
  - 性能 ✗（10k+ 数量级要重写 indexer）
  - 索引 ✗（无原生支持）
  - 跨平台 ✓
  - 备份 ✓（目录树拷贝）
  - 升级迁移 自实现（高成本）
  - 离线 ✓
  - Agent SDK 兼容 ✓
  - Electron 打包 ✓（零 native dep）

### 方案 B：SQLite（better-sqlite3 / bun:sqlite）

- **优点**：原生 B-tree + 部分索引、ACID、WAL 读写并发、PRAGMA `user_version` 迁移、Electron 生态成熟、`bun:sqlite` 可在测试时替身、CHECK 约束承担业务不变量
- **缺点**：native binding 增加 Electron 打包成本（Windows 需 `bun run rebuild`）；better-sqlite3 与 Bun 测试运行时不兼容（[bun#4290](https://github.com/oven-sh/bun/issues/4290)），需 driver-agnostic 抽象（`MigrationDb` 接口）
- **8 维评估**：
  - 性能 ✓（B-tree + 部分索引）
  - 索引 ✓（原生）
  - 跨平台 ✓（需 Windows rebuild）
  - 备份 单文件 `.db` + WAL sidecar（`.db-wal` / `.db-shm`）
  - 升级迁移 `user_version` + 事务包裹增量 migration
  - 离线 ✓
  - Agent SDK 兼容 ✓（主进程同步访问，不阻塞 renderer 与 SDK 子进程）
  - Electron 打包 +~2MB native

### 方案 C：DuckDB

OLAP 优势对 V6e 单表反查无收益；Electron 集成案例少、Bun 兼容性未验证；社区规模显著小于 SQLite。**淘汰**。

### 方案 D：自定义二进制格式 + 自实现 indexer

重复造轮子；0.2 时间窗口（Week 1 末必出 ADR + Week 2 落 A-2/A-3）不允许；迁移成本极高。**淘汰**。

### 方案 E：其他

LMDB / RxDB / NeDB 调研后无足够收益跨越 SQLite 的成熟度与 Electron 生态护城河。**淘汰**。

---

## 四、决策

### 拍板结论

| 项 | 决策 | 主要理由 |
|---|------|---------|
| 存储后端 | **SQLite**（生产 `better-sqlite3` / 测试 `bun:sqlite`） | 唯一同时满足 V6e 索引性能、Electron 同进程同步访问、0.2 时间窗口三项约束 |
| 索引策略 | B-tree + 部分索引（`WHERE col IS NOT NULL`） | 见 `apps/electron/src/main/lib/objects/migrations/001-initial.sql`（L33-35 / L55-58 等）；所有 FK 关联键全部建索引，V6e 反查走索引而非 scan |
| 备份格式 | 文件级拷贝 `~/.asci/objects.db` + `.db-wal` + `.db-shm` sidecar | 单文件可移植；备份 SOP 必须带上 WAL sidecar，避免丢失未 checkpoint 数据 |
| 升级迁移 | PRAGMA `user_version` + 事务包裹增量 migration | 见 `apps/electron/src/main/lib/objects/migration-runner.ts`；driver-agnostic `MigrationDb` 接口让生产 / 测试共享同一份 SQL；pre-launch 可改 `001-initial.sql`，post-launch 走 append-only |

### 与 CLAUDE.md §2 "不采用本地数据库" 原则的关系

CLAUDE.md §2 已随本 ADR 修订为：

> **存储**：本地优先：配置走 JSON、追加型日志走 JSONL；**关系型 / 大量结构化数据** 才用 SQLite（better-sqlite3，主进程同步访问，文件落 `~/.asci/`）；避免默认用 localStorage

修订口径与本 ADR 一致：**SQLite 范围严格限定于对象模型层**（`~/.asci/objects.db`）；`channels.json` / `agent-sessions.json` / JSONL 日志保持原状。任何新存储需求若不属于 "关系型 / 大量结构化数据"，默认仍走 JSON / JSONL。

---

## 五、后果

### 正向后果

- V6e P3 查询性能可达标，#222 / #235 解锁
- 迁移路径明确（`user_version`），未来 schema 演进有规范入口
- driver-agnostic `MigrationDb` 接口保留替换底层 driver 的可能性
- `bun:sqlite` 解锁 `bun test` 跑对象层用例（PR #284 已附 27 条 objects 子集）
- WAL 模式下读写并发友好，主进程同步访问不会阻塞 renderer

### 负向后果 / 风险

- native binding 增加 Electron 包体 ~2MB；Windows 首次 `bun install` 后需 `bun run rebuild`（已记入 CLAUDE.md）
- WAL sidecar 备份易被忽略 → 0.2 备份 SOP 文档需明示带上 `.db-wal` / `.db-shm`
- "先实现后 ADR" 先例：本 ADR 公开标注例外，后续 ADR 必须先签后实现
- code signing：macOS / Windows native binding 已在 PR #284 现有 build pipeline 冒烟通过；未来 SDK / better-sqlite3 升级需重新冒烟

### 后续动作

- [x] A-1 (#214) 完整落地（PR #284）
- [x] A-2 (#221) schema + init 落地（PR #284）
- [x] CLAUDE.md §2 原则修订（PR #284 / 后续 PR）
- [ ] A-2 后续：repository 函数 + softDelete API + IPC 四联同步
- [ ] A-3 (#222) 查询接口 —— 本 ADR 签字后解锁
- [ ] C-7 (#235) V6e 性能压测 —— 本 ADR 签字后解锁
- [ ] 0.1 → 0.2 数据迁移脚本设计（单独 issue）
- [x] README.md §123 "无本地数据库" 修订（本 PR 一并改）
