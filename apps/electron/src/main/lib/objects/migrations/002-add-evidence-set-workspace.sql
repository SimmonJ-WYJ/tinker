-- 002-add-evidence-set-workspace —— 证据集 scope 到 workspace（issue #457，post-launch 增量迁移）
--
-- 背景：evidence_sets 此前无归属，跨 workspace 全局共享（在 workspace A 建的证据集
-- 在 B 也可见）。本迁移给它加 workspace_id 归属，配合所有读写路径的 workspace 过滤。
--
-- 为什么是 002 而非改 001：launch 后已有真实用户库，001 不可再改（user_version=1 的库
-- 会跳过 001，老表拿不到新列）。append-only 增量迁移走 ALTER TABLE。
--
-- NOT NULL + DEFAULT ''：SQLite 给非空表 ADD COLUMN NOT NULL 必须带常量 DEFAULT。
--   - 新写入：仓储层（evidence-set-repository.createEvidenceSet）强制传非空 workspaceId，
--     不会落 ''。
--   - 历史行：迁移期统一落 '' 占位；app 启动在 ensureDefaultWorkspace 之后由
--     backfillLegacyEvidenceSetWorkspace() 把 workspace_id='' 的老证据集回填到默认 workspace，
--     保证用户切到默认项目仍能看到历史证据集（不丢数据、不跨 workspace 串）。

ALTER TABLE evidence_sets ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '';

CREATE INDEX idx_evidence_sets_workspace ON evidence_sets(workspace_id);
