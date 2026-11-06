-- 003-evidence-set-topic-container —— 证据集从「1 集 = 1 笔记」(1:1) 升级为研究主题容器 (M:N)
--
-- 背景：ADR-007 / #709。证据集反转为「研究主题容器」：一个容器并列多条笔记 + 多条证据 + 标签。
--   - 笔记 ↔ 集：原 evidence_sets.note_id 1:1 → 新 join 表 evidence_set_notes（M:N）
--   - 证据 ↔ 集：evidence_set_refs 本就是 M:N，不动
--   - 新增 evidence_set_tags（容器级标签 + 库列表按 tag 筛选）
--
-- 为什么是「纯增量」而非 spec §5.1 设想的「表重建删 note_id」：
--   生产 PRAGMA foreign_keys=ON（sqlite-connection.ts），且 migration-runner 把每条迁移裹在
--   一个事务里。实测两条硬约束（/tmp/fk-probe 验证）：
--     1. 事务内 `PRAGMA foreign_keys=OFF` 是 no-op —— 关不掉，标准 12-step rebuild 的第 1 步失效
--     2. FK ON 时 `DROP TABLE evidence_sets` 会隐式 DELETE 全表 → 触发 evidence_set_refs 的
--        ON DELETE CASCADE → **删光所有证据关联**（真实用户数据灾难）
--   故本迁移**不动 evidence_sets 主表**：只建 join / tag 表 + 回填。note_id 列就地冻结为 legacy
--   （新行恒空或与 join 镜像；读取一律走 evidence_set_notes，不再读 note_id）。源↔note_id 的
--   CHECK 也保留——新流程都能满足它（显式容器 source=NULL→不强制；划词路径仍写 note_id）。
--   物理删列 / 去 CHECK 留待后续能安全 rebuild（如 migration-runner 支持事务外关 FK）时再做。

-- ---------------- 笔记 ↔ 集 M:N join ----------------
-- 镜像 evidence_set_refs 的形状：(set_id, position) 复合主键维护容器内笔记顺序。
-- 额外 UNIQUE(set_id, note_id)：同一笔记不应在同一容器里出现两次。
-- 关联表无需 visibility / deleted_at —— 笔记软删走 notes.visibility；从容器移除 = 删本 join 行。
CREATE TABLE evidence_set_notes (
  set_id   TEXT NOT NULL REFERENCES evidence_sets(id) ON DELETE CASCADE,
  note_id  TEXT NOT NULL REFERENCES notes(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (set_id, position),
  UNIQUE (set_id, note_id)
);
CREATE INDEX idx_evidence_set_notes_note ON evidence_set_notes(note_id);

-- 回填：每个有 note 的老证据集 → 一条 position=0 的 join 行（ADR-007 §六：每个老 set = 含 1 条笔记的容器）。
-- agent-assembled 无 note 者 note_id IS NULL → 不回填。
INSERT INTO evidence_set_notes (set_id, note_id, position)
SELECT id, note_id, 0 FROM evidence_sets WHERE note_id IS NOT NULL;

-- ---------------- 容器级标签 ----------------
-- 多值属性独立子表：库列表「按 tag 筛选」走 idx(tag) 一击命中；「列出所有 tag」走 SELECT DISTINCT。
-- PK(set_id, tag) 天然去重（同集同 tag 至多一条）。随主表 CASCADE。
CREATE TABLE evidence_set_tags (
  set_id TEXT NOT NULL REFERENCES evidence_sets(id) ON DELETE CASCADE,
  tag    TEXT NOT NULL,
  PRIMARY KEY (set_id, tag)
);
CREATE INDEX idx_evidence_set_tags_tag ON evidence_set_tags(tag);
