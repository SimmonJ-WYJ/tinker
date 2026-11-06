-- 0.2 北极星核心对象首版 schema
-- 见 docs/milestones/0.2/north-star.md §一 对象表 + issue #214
--
-- 命名约定：
--   - 表 / 列：snake_case
--   - 主键：TEXT（branded ObjectId）
--   - 时间戳：TEXT 存 ISO 8601
--   - boolean：INTEGER (0/1) + CHECK
--   - 数组：拆关联表 + position 保序
--   - 多态对象：`_json` 后缀 TEXT 列
--   - 可见性：visibility 三态枚举 + deleted_at 审计时间戳分工
--     (visibility 描述"现在状态"，deleted_at 记录"何时转入 deleted")
--
-- CHECK 约束承担与 TS interface / JSON Schema if/then 同等的业务不变量保护。

-- ---------------- Paper ----------------
CREATE TABLE papers (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL CHECK (length(title) > 0),
  authors_json TEXT NOT NULL,
  abstract     TEXT,
  year         INTEGER,
  venue        TEXT,
  doi          TEXT,
  url          TEXT,
  zotero_key   TEXT,
  visibility   TEXT NOT NULL DEFAULT 'visible'
                 CHECK (visibility IN ('visible','archived','deleted')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX idx_papers_doi        ON papers(doi)        WHERE doi        IS NOT NULL;
CREATE INDEX idx_papers_zotero_key ON papers(zotero_key) WHERE zotero_key IS NOT NULL;
CREATE INDEX idx_papers_visibility ON papers(visibility);

-- ---------------- Review ----------------
-- source_evidence_set_id 引用了后面才建的 evidence_sets —— SQLite FK 在 INSERT
-- 时才校验，CREATE TABLE 时允许 forward reference。
-- 注：evidence_refs 已改为多态 target，不再持有指向 reviews 的 FK；删 review
-- 时由应用层 GC `evidence_refs WHERE target_kind='review' AND target_id=?`。
-- body 不在本表：正文文件由 body_path 引用，绝对路径直接落到产出方写的位置：
--   - cwd 模式（litreview / literature-review-result skill 真实链路，v0.19.0+）：
--     ~/.asci{-dev}/agent-workspaces/<ws>/agent-sessions/<sid>/reviews/xxx.html
--     （历史版本可能落 .md；review-body-service 按 bodyPath 直读，不挑扩展名）
--   - inline 模式（兜底 <asci-review-artifact>）：~/.asci{-dev}/reviews/{id}.html
-- body_path 可空：兼容旧行为（按 id 推导默认 ~/.asci/reviews/{id}.{html,md}，
-- 优先 .html 再回退 .md）。
--
-- topic：可空；UI 列表副标题 / 主题标签（synthesizer artifact frontmatter 给出）。
-- agent_session_id：可空；指向产出该综述的 Agent 会话（agent-sessions.json 索引），
-- 用于幂等去重（同会话二次完成 → update 覆写）与 UI 跳转回会话。
-- 不加 FK：agent-sessions 是 JSON 索引而非 SQLite 表，软引用即可。
CREATE TABLE reviews (
  id                     TEXT PRIMARY KEY,
  title                  TEXT NOT NULL CHECK (length(title) > 0),
  intent                 TEXT NOT NULL CHECK (length(intent) > 0),
  source_capability      TEXT NOT NULL CHECK (length(source_capability) > 0),
  source_evidence_set_id TEXT REFERENCES evidence_sets(id) ON DELETE SET NULL,
  topic                  TEXT,
  agent_session_id       TEXT,
  body_path              TEXT,
  visibility             TEXT NOT NULL DEFAULT 'visible'
                           CHECK (visibility IN ('visible','archived','deleted')),
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  deleted_at             TEXT
);
CREATE INDEX idx_reviews_source_evidence_set ON reviews(source_evidence_set_id)
  WHERE source_evidence_set_id IS NOT NULL;
CREATE INDEX idx_reviews_capability ON reviews(source_capability);
CREATE INDEX idx_reviews_agent_session ON reviews(agent_session_id)
  WHERE agent_session_id IS NOT NULL;
CREATE INDEX idx_reviews_visibility ON reviews(visibility);

-- ---------------- Note ----------------
-- 必须在 evidence_sets 之前建：evidence_sets.note_id 引用 notes(id)。
-- B4 之后：彻底移除 hypothesis 概念（kind / hypothesis_status 列已删）；与新数据模型设计稿对齐。
-- 不带 target_kind / target_id：note 是纯文本对象，所属关系由 evidence_sets.note_id 反向解析
-- （1:1，删 note 级联删 set），与 paper 的段落级关系由 evidence_refs(source=paper, target=set) 承载。
CREATE TABLE notes (
  id                TEXT PRIMARY KEY,
  body              TEXT NOT NULL,
  visibility        TEXT NOT NULL DEFAULT 'visible'
                      CHECK (visibility IN ('visible','archived','deleted')),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT
);
CREATE INDEX idx_notes_visibility ON notes(visibility);

-- ---------------- EvidenceSet ----------------
-- note_id 关系（B2 之后）：
--   - 用户主动 highlight 建出的 set 仍 1:1 绑定 note（"动机/标题"载体）
--   - Agent 自动组建的临时 set 允许无 note（note_id IS NULL）
--   - UNIQUE 仍守门"一 note 至多一 set"；NULL 可多（SQLite UNIQUE+NULL 行为）
--   - ON DELETE CASCADE：note 物理删除时随之删 set
--   - 应用层 GC：删 set 时需先 DELETE evidence_refs WHERE target_kind='evidence-set' AND target_id=?
-- persisted=1 → name + saved_at 必填；persisted=0 → name + saved_at 必空（"临时集合"语义）
-- source（可空）：标记 set 的创建来源
--   - 'user-highlight'：用户在 PDF/综述里划词建笔记的 createNoteFromPaper/ReviewHighlight 路径（必带 note）
--   - 'agent-assembled'：Agent 自动组装的临时证据集（必无 note；B2 起接入）
--   - NULL：未标记来源的历史路径（如 createEvidenceSetWithPaper "+ Add 新建" 入口；按现状必带 note）
CREATE TABLE evidence_sets (
  id         TEXT PRIMARY KEY,
  note_id    TEXT UNIQUE REFERENCES notes(id) ON DELETE CASCADE,
  persisted  INTEGER NOT NULL CHECK (persisted IN (0,1)),
  name       TEXT,
  saved_at   TEXT,
  source     TEXT CHECK (source IS NULL OR source IN ('user-highlight','agent-assembled')),
  visibility TEXT NOT NULL DEFAULT 'visible'
               CHECK (visibility IN ('visible','archived','deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (
    (persisted = 1 AND name IS NOT NULL AND saved_at IS NOT NULL) OR
    (persisted = 0 AND name IS NULL     AND saved_at IS NULL)
  ),
  -- 业务不变量：source 与 note_id 联动
  --   user-highlight  → note_id 必非空（划词建笔记一气呵成）
  --   agent-assembled → note_id 必空（Agent 产物，待用户认可后再 promote 为 note）
  --   未标记（NULL）   → 不强制（兼容历史路径）
  CHECK (
    source IS NULL OR
    (source = 'user-highlight'   AND note_id IS NOT NULL) OR
    (source = 'agent-assembled'  AND note_id IS NULL)
  )
);
CREATE INDEX idx_evidence_sets_visibility ON evidence_sets(visibility);
CREATE INDEX idx_evidence_sets_source     ON evidence_sets(source) WHERE source IS NOT NULL;
-- 注：UNIQUE(note_id) 已隐含索引，无需额外建
-- 注：workspace_id 列 + 索引在 002-add-evidence-set-workspace.sql 增量加（issue #457，post-launch）

-- ---------------- EvidenceRef ----------------
-- 通用引用关系：source（来源对象的段落锚点）→ target（引用承载方）。**双侧多态**。
--
-- source 端：source_kind ∈ {'paper','review','conversation'}
--   - 'paper'        → 论文段落（type='md' / 'pdf' anchor）
--   - 'review'       → 综述句子（type='html' anchor，含 sectionId/paragraphIndex/citeIndex）
--   - 'conversation' → Agent 会话 Q&A 快照（type='conversation' anchor，含 sessionId/messageUuid）
--     source_id 用 agent session id（agent-sessions.json 索引 id；非 ObjectId 形状，无 FK）
--   source_id 不再持硬 FK（多态化后跨表 FK 不可用）→ 应用层 GC：
--     - 删 papers 行 → 必须先 DELETE evidence_refs WHERE source_kind='paper' AND source_id=?
--     - 删 reviews 行 → 同理（source_kind='review'，同时还要清 target_kind='review'）
--     - 删 agent session → 当前不做级联清理（依赖 snapshotText 作为快照兜底；UI 端 messageExists=false 时禁用跳转按钮）
--   入口统一封装在仓储 / 服务层 delete 方法里。
--
-- target 端：target_kind ∈ {'review','evidence-set'}，同样多态、无 FK，应用层 GC。
--   - 删 reviews 行 → DELETE evidence_refs WHERE target_kind='review' AND target_id=?
--   - 删 evidence_sets 行 → DELETE evidence_refs WHERE target_kind='evidence-set' AND target_id=?
--
-- anchor 列存 **Anchor JSON**（不是简单字符串），由 anchor-codec.ts 负责序列化 / 反序列化。
--   - source_anchor (NOT NULL)：定位来源对象内的原文段落（paper 时 md/pdf；review 时 html）
--   - target_anchor (nullable，CHECK 与 target_kind 联动)：
--       * target_kind='review'        → 必填（定位综述句子；type='html'）
--       * target_kind='evidence-set'  → 必空（evidence_set 非文本载体，无 anchor 可言）
-- 老 `quote` 字段已删除：snapshot_text 现在嵌在 source_anchor JSON 内。
CREATE TABLE evidence_refs (
  id            TEXT PRIMARY KEY,
  source_kind   TEXT NOT NULL CHECK (source_kind IN ('paper','review','conversation')),
  source_id     TEXT NOT NULL,
  source_anchor TEXT NOT NULL,  -- Anchor JSON
  target_kind   TEXT NOT NULL CHECK (target_kind IN ('review','evidence-set')),
  target_id     TEXT NOT NULL,
  target_anchor TEXT,           -- Anchor JSON; review 必填, evidence-set 必空
  visibility    TEXT NOT NULL DEFAULT 'visible'
                  CHECK (visibility IN ('visible','archived','deleted')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  CHECK (
    (target_kind = 'review'       AND target_anchor IS NOT NULL) OR
    (target_kind = 'evidence-set' AND target_anchor IS NULL)
  )
);
CREATE INDEX idx_evidence_refs_source     ON evidence_refs(source_kind, source_id);
CREATE INDEX idx_evidence_refs_target     ON evidence_refs(target_kind, target_id);
CREATE INDEX idx_evidence_refs_visibility ON evidence_refs(visibility);

-- ---------------- EvidenceSet ↔ EvidenceRef 关联表 ----------------
-- 保序：用 (set_id, position) 复合主键维护 ref 在集合内的展示顺序。
-- 关联表无需 visibility / deleted_at：随主表 CASCADE 即可。
-- 注：evidence_set_papers 已废弃 —— paper ↔ set 关系完全由 evidence_refs 承载
-- （source_kind='paper', target_kind='evidence-set'），段落级 anchor 是唯一表达粒度。
CREATE TABLE evidence_set_refs (
  set_id   TEXT NOT NULL REFERENCES evidence_sets(id) ON DELETE CASCADE,
  ref_id   TEXT NOT NULL REFERENCES evidence_refs(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (set_id, position)
);
CREATE INDEX idx_evidence_set_refs_ref ON evidence_set_refs(ref_id);

-- ---------------- CitationRelation ----------------
CREATE TABLE citation_relations (
  id         TEXT PRIMARY KEY,
  from_paper TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  to_paper   TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('supports','contradicts','method-ref')),
  reasoning  TEXT,
  visibility TEXT NOT NULL DEFAULT 'visible'
               CHECK (visibility IN ('visible','archived','deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (from_paper, to_paper, type)
);
CREATE INDEX idx_citation_relations_from       ON citation_relations(from_paper);
CREATE INDEX idx_citation_relations_to         ON citation_relations(to_paper);
CREATE INDEX idx_citation_relations_visibility ON citation_relations(visibility);

-- ---------------- Proposal ----------------
-- reasoning 必填且非空（对齐 B-4 V2b "无 reasoning 不展示"）
-- payload_json：Agent 原始候选；modified_payload_json：status='modified' 时
-- 用户改后版本（业务约束由 app 层强制，DB 不约束）
-- 注意：visibility（显示态）与 status（业务决策态）是两个正交字段
CREATE TABLE proposals (
  id                    TEXT PRIMARY KEY,
  kind                  TEXT NOT NULL CHECK (kind IN ('citation-relation','evidence-set')),
  source_capability     TEXT NOT NULL CHECK (length(source_capability) > 0),
  payload_json          TEXT NOT NULL,
  modified_payload_json TEXT,
  reasoning             TEXT NOT NULL CHECK (length(reasoning) > 0),
  status                TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected','modified')),
  target_kind           TEXT NOT NULL CHECK (target_kind IN ('paper','evidence-set','note')),
  target_id             TEXT NOT NULL,
  dismiss_policy        TEXT NOT NULL CHECK (dismiss_policy IN ('once','scoped','silence-this-kind')),
  decided_at            TEXT,
  visibility            TEXT NOT NULL DEFAULT 'visible'
                          CHECK (visibility IN ('visible','archived','deleted')),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  deleted_at            TEXT
);
CREATE INDEX idx_proposals_status     ON proposals(status);
CREATE INDEX idx_proposals_target     ON proposals(target_kind, target_id);
CREATE INDEX idx_proposals_kind       ON proposals(kind);
CREATE INDEX idx_proposals_visibility ON proposals(visibility);
