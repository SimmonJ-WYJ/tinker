/**
 * Migration manifest —— 显式列出所有 SQL 迁移，不靠 fs 扫描
 *
 * **已 launch，append-only 生效（当前阶段）**：用户真实数据已进场，切换到 append-only：
 *   - 写 NNN-<name>.sql（NNN 递增，不复用、不重排）
 *   - 在下方数组末尾追加一条 { version: NNN, name, sql }
 *   - 永远不要改老 SQL 文件——改字段 / 加列必须写新 migration
 *   - 加 FK 走 SQLite "12-step rebuild"（create _new + INSERT SELECT + DROP + RENAME）
 *   - ADD COLUMN ... NOT NULL 必须带常量 DEFAULT（SQLite 限制）；历史行如需真实归属，
 *     在 app 启动跑完迁移后做 app-layer backfill（见 backfillLegacyEvidenceSetWorkspace）
 *
 * （历史：launch 前曾允许直接改 001 自由迭代 schema，该窗口已关闭。）
 *
 * SQL 文件通过 esbuild `--loader:.sql=text` 在编译时被 inline，运行时无 fs 读。
 */

import type { Migration } from '../migration-runner.ts'

import initialSql from './001-initial.sql'
import addEvidenceSetWorkspaceSql from './002-add-evidence-set-workspace.sql'
import evidenceSetTopicContainerSql from './003-evidence-set-topic-container.sql'

export const MIGRATIONS = [
  { version: 1, name: 'initial', sql: initialSql },
  { version: 2, name: 'add-evidence-set-workspace', sql: addEvidenceSetWorkspaceSql },
  { version: 3, name: 'evidence-set-topic-container', sql: evidenceSetTopicContainerSql },
] as const satisfies readonly Migration[]
