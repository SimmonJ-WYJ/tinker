/**
 * Object Store / Migration / SQL schema 集成测试（v0.2 证据列表重构后）
 *
 * 注意 driver：Bun 测试运行时不支持 better-sqlite3 native binding
 * （oven-sh/bun#4290），但 SQL 行为本身在两个 driver 下走的都是
 * 同一份 SQLite C lib，结果一致。所以测试侧用 `bun:sqlite` + 一个
 * 极薄的 MigrationDb 适配器；生产侧 better-sqlite3 的接通则在
 * Electron 冒烟里覆盖。
 */

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { MIGRATIONS } from './migrations/index.ts'
import { runMigrations, type MigrationDb } from './migration-runner.ts'

const EXPECTED_TABLES = [
  'citation_relations',
  'evidence_refs',
  'evidence_set_notes',
  'evidence_set_refs',
  'evidence_set_tags',
  'evidence_sets',
  'notes',
  'papers',
  'proposals',
  'reviews',
]

const ISO = '2026-05-19T10:00:00.000Z'

/** 测试公用：seed 一个 review（很多 FK 测试要先有 review 才能插 evidence_refs） */
function seedReview(db: Database, id: string = 'rev-1'): void {
  db.prepare(
    `INSERT INTO reviews (id, title, intent, source_capability, created_at, updated_at)
     VALUES (?, 't', 'i', 'cap', ?, ?)`,
  ).run(id, ISO, ISO)
}

/** 测试公用：seed 一个 note（B4 后无 kind / hypothesis_status） */
function seedNote(db: Database, id: string = 'note-1'): void {
  db.prepare(
    `INSERT INTO notes (id, body, created_at, updated_at)
     VALUES (?, 'b', ?, ?)`,
  ).run(id, ISO, ISO)
}

/** 把 bun:sqlite Database 适配成 MigrationDb，仅测试用 */
function asMigrationDb(db: Database): MigrationDb {
  return {
    exec: (sql) => {
      db.exec(sql)
    },
    getUserVersion: () => {
      const row = db.query('PRAGMA user_version').get() as { user_version: number } | null
      return row?.user_version ?? 0
    },
    setUserVersion: (v) => {
      db.exec(`PRAGMA user_version = ${v}`)
    },
    transaction: <T>(fn: () => T): T => db.transaction(fn)(),
  }
}

/** 模拟生产 openDb 的 PRAGMA 序列（bun:sqlite 没 pragma 快捷方法，走 exec） */
function openTestDb(): Database {
  const db = new Database(':memory:')
  db.exec('PRAGMA journal_mode = MEMORY') // 内存 DB 不能开 WAL
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

describe('migration-runner：幂等与版本推进', () => {
  test('首启：apply 全部 manifest → user_version 推到末尾', () => {
    const db = openTestDb()
    const m = asMigrationDb(db)
    runMigrations(m, MIGRATIONS)
    expect(m.getUserVersion()).toBe(MIGRATIONS[MIGRATIONS.length - 1]!.version)
  })

  test('再次启动：已是最新 → noop', () => {
    const db = openTestDb()
    const m = asMigrationDb(db)
    runMigrations(m, MIGRATIONS)
    expect(() => runMigrations(m, MIGRATIONS)).not.toThrow()
    expect(m.getUserVersion()).toBe(MIGRATIONS[MIGRATIONS.length - 1]!.version)
  })

  test('manifest 顺序错误（version 倒退）→ 抛错保护', () => {
    const db = openTestDb()
    const m = asMigrationDb(db)
    expect(() =>
      runMigrations(m, [
        { version: 2, name: 'b', sql: 'CREATE TABLE x (id TEXT)' },
        { version: 1, name: 'a', sql: 'CREATE TABLE y (id TEXT)' },
      ]),
    ).toThrow(/顺序错误/)
  })
})

describe('001-initial：schema 完整性', () => {
  test('建好 10 张表（003：新增 evidence_set_notes + evidence_set_tags）', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    const rows = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>
    expect(rows.map((r) => r.name)).toEqual(EXPECTED_TABLES)
  })

  test('索引也建好（抽查 papers + proposals + evidence_refs 新形态）', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    const rows = db
      .query("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")
      .all() as Array<{ name: string }>
    const names = rows.map((r) => r.name)
    expect(names).toContain('idx_papers_doi')
    expect(names).toContain('idx_proposals_status')
    expect(names).toContain('idx_evidence_refs_target')
    expect(names).toContain('idx_evidence_refs_source')
    expect(names).toContain('idx_reviews_capability')
  })
})

describe('001-initial：业务 CHECK 约束', () => {
  test('EvidenceSet persisted=1 必须有 name + saved_at', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    seedNote(db, 'note-x')
    expect(() =>
      db
        .prepare(
          `INSERT INTO evidence_sets (id, note_id, persisted, name, saved_at, created_at, updated_at, workspace_id)
           VALUES (?, ?, 1, NULL, NULL, ?, ?, 'ws-test')`,
        )
        .run('set-1', 'note-x', ISO, ISO),
    ).toThrow(/CHECK/i)
  })

  test('EvidenceSet persisted=0 不能携带 name', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    seedNote(db, 'note-x')
    expect(() =>
      db
        .prepare(
          `INSERT INTO evidence_sets (id, note_id, persisted, name, saved_at, created_at, updated_at, workspace_id)
           VALUES (?, ?, 0, 'oops', NULL, ?, ?, 'ws-test')`,
        )
        .run('set-2', 'note-x', ISO, ISO),
    ).toThrow(/CHECK/i)
  })

  test('EvidenceSet.source=user-highlight 时禁止 note_id=NULL（CHECK 约束守门）', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    expect(() =>
      db
        .prepare(
          `INSERT INTO evidence_sets (id, note_id, persisted, source, created_at, updated_at, workspace_id)
           VALUES ('set-x', NULL, 0, 'user-highlight', ?, ?, 'ws-test')`,
        )
        .run(ISO, ISO),
    ).toThrow(/CHECK/i)
  })

  test('EvidenceSet.source=agent-assembled 时禁止 note_id 非空（CHECK 约束守门）', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    seedNote(db, 'note-x')
    expect(() =>
      db
        .prepare(
          `INSERT INTO evidence_sets (id, note_id, persisted, source, created_at, updated_at, workspace_id)
           VALUES ('set-x', 'note-x', 0, 'agent-assembled', ?, ?, 'ws-test')`,
        )
        .run(ISO, ISO),
    ).toThrow(/CHECK/i)
  })

  test('EvidenceSet.note_id 可空（无 source 标记的兜底路径）', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    expect(() =>
      db
        .prepare(
          `INSERT INTO evidence_sets (id, note_id, persisted, created_at, updated_at, workspace_id)
           VALUES ('set-x', NULL, 0, ?, ?, 'ws-test')`,
        )
        .run(ISO, ISO),
    ).not.toThrow()
  })

  test('EvidenceSet.note_id UNIQUE：同一 note 不可重复绑定', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    seedNote(db, 'note-x')
    db.prepare(
      `INSERT INTO evidence_sets (id, note_id, persisted, created_at, updated_at, workspace_id)
       VALUES ('set-1', 'note-x', 0, ?, ?, 'ws-test')`,
    ).run(ISO, ISO)
    expect(() =>
      db
        .prepare(
          `INSERT INTO evidence_sets (id, note_id, persisted, created_at, updated_at, workspace_id)
           VALUES ('set-2', 'note-x', 0, ?, ?, 'ws-test')`,
        )
        .run(ISO, ISO),
    ).toThrow(/UNIQUE/i)
  })

  test('EvidenceRef target_kind=review 时 target_anchor 必填', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    db.prepare(
      `INSERT INTO papers (id, title, authors_json, created_at, updated_at)
       VALUES ('p-1', 't', '[]', ?, ?)`,
    ).run(ISO, ISO)
    seedReview(db)
    expect(() =>
      db
        .prepare(
          `INSERT INTO evidence_refs
           (id, source_kind, source_id, source_anchor, target_kind, target_id, target_anchor, created_at, updated_at)
           VALUES ('r-1', 'paper', 'p-1', 'a', 'review', 'rev-1', NULL, ?, ?)`,
        )
        .run(ISO, ISO),
    ).toThrow(/CHECK/i)
  })

  test('EvidenceRef target_kind=evidence-set 时 target_anchor 必空', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    db.prepare(
      `INSERT INTO papers (id, title, authors_json, created_at, updated_at)
       VALUES ('p-1', 't', '[]', ?, ?)`,
    ).run(ISO, ISO)
    seedNote(db, 'note-x')
    db.prepare(
      `INSERT INTO evidence_sets (id, note_id, persisted, created_at, updated_at, workspace_id)
       VALUES ('s-1', 'note-x', 0, ?, ?, 'ws-test')`,
    ).run(ISO, ISO)
    expect(() =>
      db
        .prepare(
          `INSERT INTO evidence_refs
           (id, source_kind, source_id, source_anchor, target_kind, target_id, target_anchor, created_at, updated_at)
           VALUES ('r-1', 'paper', 'p-1', 'a', 'evidence-set', 's-1', 'b', ?, ?)`,
        )
        .run(ISO, ISO),
    ).toThrow(/CHECK/i)
  })

  test('EvidenceRef source_kind 当前只允许 "paper"', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    db.prepare(
      `INSERT INTO papers (id, title, authors_json, created_at, updated_at)
       VALUES ('p-1', 't', '[]', ?, ?)`,
    ).run(ISO, ISO)
    seedReview(db)
    expect(() =>
      db
        .prepare(
          `INSERT INTO evidence_refs
           (id, source_kind, source_id, source_anchor, target_kind, target_id, target_anchor, created_at, updated_at)
           VALUES ('r-1', 'pdf', 'p-1', 'a', 'review', 'rev-1', 'b', ?, ?)`,
        )
        .run(ISO, ISO),
    ).toThrow(/CHECK/i)
  })

  test('Proposal reasoning 空串被拒', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    expect(() =>
      db
        .prepare(
          `INSERT INTO proposals
           (id, kind, source_capability, payload_json, reasoning, status, target_kind, target_id, dismiss_policy, created_at, updated_at)
           VALUES (?, 'citation-relation', 'cap', '{}', '', 'pending', 'paper', 'p-1', 'once', ?, ?)`,
        )
        .run('prop-1', ISO, ISO),
    ).toThrow(/CHECK/i)
  })

  test('CitationRelation (from, to, type) UNIQUE 防重复', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    db.prepare(
      `INSERT INTO papers (id, title, authors_json, created_at, updated_at)
       VALUES ('p-1', 't', '[]', ?, ?), ('p-2', 't', '[]', ?, ?)`,
    ).run(ISO, ISO, ISO, ISO)
    db.prepare(
      `INSERT INTO citation_relations (id, from_paper, to_paper, type, created_at, updated_at)
       VALUES ('c-1', 'p-1', 'p-2', 'supports', ?, ?)`,
    ).run(ISO, ISO)
    expect(() =>
      db
        .prepare(
          `INSERT INTO citation_relations (id, from_paper, to_paper, type, created_at, updated_at)
           VALUES ('c-2', 'p-1', 'p-2', 'supports', ?, ?)`,
        )
        .run(ISO, ISO),
    ).toThrow(/UNIQUE/i)
  })
})

describe('001-initial：外键级联', () => {
  function seedPapers(db: Database): void {
    db.prepare(
      `INSERT INTO papers (id, title, authors_json, created_at, updated_at)
       VALUES ('p-1', 't', '[]', ?, ?), ('p-2', 't', '[]', ?, ?)`,
    ).run(ISO, ISO, ISO, ISO)
  }

  test('删 paper → evidence_refs **不**级联（2026-05-24 source 多态化后 source_id 撤 FK；应用层 GC）', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    seedPapers(db)
    seedReview(db)
    db.prepare(
      `INSERT INTO evidence_refs
       (id, source_kind, source_id, source_anchor, target_kind, target_id, target_anchor, created_at, updated_at)
       VALUES ('r-1', 'paper', 'p-1', 'a', 'review', 'rev-1', 'b', ?, ?)`,
    ).run(ISO, ISO)
    db.prepare('DELETE FROM papers WHERE id = ?').run('p-1')
    // ref 仍在 —— 这是预期行为，应用层 paper 删除入口需先调 deleteRefsBySource('paper', id)
    const count = (db.query('SELECT COUNT(*) AS n FROM evidence_refs').get() as { n: number }).n
    expect(count).toBe(1)
  })

  test('删 paper → citation_relations 级联删（from 与 to 都触发）', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    seedPapers(db)
    db.prepare(
      `INSERT INTO citation_relations (id, from_paper, to_paper, type, created_at, updated_at)
       VALUES ('c-1', 'p-1', 'p-2', 'supports', ?, ?)`,
    ).run(ISO, ISO)
    db.prepare('DELETE FROM papers WHERE id = ?').run('p-1')
    const count = (db.query('SELECT COUNT(*) AS n FROM citation_relations').get() as { n: number })
      .n
    expect(count).toBe(0)
  })

  test('删 note → evidence_set 级联删（note_id FK CASCADE）', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    seedNote(db, 'note-x')
    db.prepare(
      `INSERT INTO evidence_sets (id, note_id, persisted, created_at, updated_at, workspace_id)
       VALUES ('s-1', 'note-x', 0, ?, ?, 'ws-test')`,
    ).run(ISO, ISO)
    db.prepare('DELETE FROM notes WHERE id = ?').run('note-x')
    const count = (db.query('SELECT COUNT(*) AS n FROM evidence_sets').get() as { n: number }).n
    expect(count).toBe(0)
  })

  test('删 evidence_set → evidence_set_refs 级联删', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    seedPapers(db)
    seedReview(db)
    seedNote(db, 'note-x')
    db.prepare(
      `INSERT INTO evidence_sets (id, note_id, persisted, created_at, updated_at, workspace_id)
       VALUES ('s-1', 'note-x', 0, ?, ?, 'ws-test')`,
    ).run(ISO, ISO)
    db.prepare(
      `INSERT INTO evidence_refs
       (id, source_kind, source_id, source_anchor, target_kind, target_id, target_anchor, created_at, updated_at)
       VALUES ('r-1', 'paper', 'p-1', 'a', 'review', 'rev-1', 'b', ?, ?)`,
    ).run(ISO, ISO)
    db.prepare(
      `INSERT INTO evidence_set_refs (set_id, ref_id, position) VALUES ('s-1', 'r-1', 0)`,
    ).run()
    db.prepare('DELETE FROM evidence_sets WHERE id = ?').run('s-1')
    const count = (db.query('SELECT COUNT(*) AS n FROM evidence_set_refs').get() as {
      n: number
    }).n
    expect(count).toBe(0)
  })
})

describe('003-evidence-set-topic-container：M:N 容器化', () => {
  /** 003 走纯增量：seed 老数据后单独跑 001+002，再跑 003，验回填 */
  function runThrough(version: number, db: Database): void {
    runMigrations(
      asMigrationDb(db),
      MIGRATIONS.filter((m) => m.version <= version),
    )
  }

  test('evidence_set_notes / evidence_set_tags 建表 + 索引', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    const tables = (
      db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
    ).map((r) => r.name)
    expect(tables).toContain('evidence_set_notes')
    expect(tables).toContain('evidence_set_tags')
    const idx = (
      db
        .query("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
        .all() as Array<{ name: string }>
    ).map((r) => r.name)
    expect(idx).toContain('idx_evidence_set_notes_note')
    expect(idx).toContain('idx_evidence_set_tags_tag')
  })

  test('回填：每个有 note 的老 set → position=0 的 join 行；无 note 的不回填', () => {
    const db = openTestDb()
    // 先只跑到 002，造老数据（含 1:1 note 与 agent-assembled 无 note）
    runThrough(2, db)
    seedNote(db, 'note-a')
    db.prepare(
      `INSERT INTO evidence_sets (id, note_id, persisted, name, saved_at, source, created_at, updated_at, workspace_id)
       VALUES ('s-with-note', 'note-a', 1, 'n', ?, 'user-highlight', ?, ?, 'ws')`,
    ).run(ISO, ISO, ISO)
    db.prepare(
      `INSERT INTO evidence_sets (id, note_id, persisted, source, created_at, updated_at, workspace_id)
       VALUES ('s-no-note', NULL, 0, 'agent-assembled', ?, ?, 'ws')`,
    ).run(ISO, ISO)
    // 再跑 003
    runThrough(3, db)
    const rows = db
      .query('SELECT set_id, note_id, position FROM evidence_set_notes ORDER BY set_id')
      .all() as Array<{ set_id: string; note_id: string; position: number }>
    expect(rows).toEqual([{ set_id: 's-with-note', note_id: 'note-a', position: 0 }])
  })

  test('UNIQUE(set_id, note_id)：同一笔记不可在同一容器出现两次', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    seedNote(db, 'note-a')
    db.prepare(
      `INSERT INTO evidence_sets (id, persisted, name, saved_at, created_at, updated_at, workspace_id)
       VALUES ('s-1', 1, 'n', ?, ?, ?, 'ws')`,
    ).run(ISO, ISO, ISO)
    db.prepare(
      `INSERT INTO evidence_set_notes (set_id, note_id, position) VALUES ('s-1', 'note-a', 0)`,
    ).run()
    expect(() =>
      db
        .prepare(`INSERT INTO evidence_set_notes (set_id, note_id, position) VALUES ('s-1', 'note-a', 1)`)
        .run(),
    ).toThrow(/UNIQUE/i)
  })

  test('删 evidence_set → evidence_set_notes / evidence_set_tags 级联删', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    seedNote(db, 'note-a')
    db.prepare(
      `INSERT INTO evidence_sets (id, persisted, name, saved_at, created_at, updated_at, workspace_id)
       VALUES ('s-1', 1, 'n', ?, ?, ?, 'ws')`,
    ).run(ISO, ISO, ISO)
    db.prepare(`INSERT INTO evidence_set_notes (set_id, note_id, position) VALUES ('s-1', 'note-a', 0)`).run()
    db.prepare(`INSERT INTO evidence_set_tags (set_id, tag) VALUES ('s-1', '小样本')`).run()
    db.prepare('DELETE FROM evidence_sets WHERE id = ?').run('s-1')
    const notes = (db.query('SELECT COUNT(*) AS n FROM evidence_set_notes').get() as { n: number }).n
    const tags = (db.query('SELECT COUNT(*) AS n FROM evidence_set_tags').get() as { n: number }).n
    expect(notes).toBe(0)
    expect(tags).toBe(0)
  })

  test('evidence_set_tags PK(set_id, tag)：同集同 tag 去重', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    db.prepare(
      `INSERT INTO evidence_sets (id, persisted, name, saved_at, created_at, updated_at, workspace_id)
       VALUES ('s-1', 1, 'n', ?, ?, ?, 'ws')`,
    ).run(ISO, ISO, ISO)
    db.prepare(`INSERT INTO evidence_set_tags (set_id, tag) VALUES ('s-1', '在读')`).run()
    expect(() =>
      db.prepare(`INSERT INTO evidence_set_tags (set_id, tag) VALUES ('s-1', '在读')`).run(),
    ).toThrow(/UNIQUE|PRIMARY/i)
  })
})

describe('schema 补丁列：deleted_at / abstract / modified_payload_json', () => {
  /** 返回某张表的所有列名（PRAGMA table_info 输出） */
  function columnsOf(db: Database, table: string): string[] {
    const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return rows.map((r) => r.name)
  }

  const MAIN_TABLES = [
    'papers',
    'reviews',
    'evidence_refs',
    'notes',
    'evidence_sets',
    'citation_relations',
    'proposals',
  ] as const

  test('7 张主表都有 deleted_at + visibility；关联表没有', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    for (const t of MAIN_TABLES) {
      expect(columnsOf(db, t)).toContain('deleted_at')
      expect(columnsOf(db, t)).toContain('visibility')
    }
    expect(columnsOf(db, 'evidence_set_refs')).not.toContain('deleted_at')
    expect(columnsOf(db, 'evidence_set_refs')).not.toContain('visibility')
  })

  test('visibility 默认为 visible（INSERT 不带该列时）', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    db.prepare(
      `INSERT INTO papers (id, title, authors_json, created_at, updated_at)
       VALUES ('p-default', 't', '[]', ?, ?)`,
    ).run(ISO, ISO)
    const row = db.query('SELECT visibility FROM papers WHERE id = ?').get('p-default') as {
      visibility: string
    }
    expect(row.visibility).toBe('visible')
  })

  test('visibility CHECK 拒绝非法值', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    expect(() =>
      db
        .prepare(
          `INSERT INTO papers (id, title, authors_json, visibility, created_at, updated_at)
           VALUES ('p-bad', 't', '[]', 'hidden', ?, ?)`,
        )
        .run(ISO, ISO),
    ).toThrow(/CHECK/i)
  })

  test('visibility 接受 archived / deleted 合法值', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    db.prepare(
      `INSERT INTO papers (id, title, authors_json, visibility, created_at, updated_at)
       VALUES ('p-arc', 't', '[]', 'archived', ?, ?), ('p-del', 't', '[]', 'deleted', ?, ?)`,
    ).run(ISO, ISO, ISO, ISO)
    const rows = db
      .query("SELECT id, visibility FROM papers WHERE id LIKE 'p-%' ORDER BY id")
      .all() as Array<{ id: string; visibility: string }>
    expect(rows).toEqual([
      { id: 'p-arc', visibility: 'archived' },
      { id: 'p-del', visibility: 'deleted' },
    ])
  })

  test('papers 新增 abstract 列，可存可读', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    db.prepare(
      `INSERT INTO papers (id, title, authors_json, abstract, created_at, updated_at)
       VALUES ('p-1', 't', '[]', ?, ?, ?)`,
    ).run('Long-context vs RAG: an empirical study', ISO, ISO)
    const row = db.query('SELECT abstract FROM papers WHERE id = ?').get('p-1') as {
      abstract: string
    }
    expect(row.abstract).toMatch(/RAG/)
  })

  test('papers.deleted_at 软删过滤：WHERE deleted_at IS NULL 排除已删', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    db.prepare(
      `INSERT INTO papers (id, title, authors_json, created_at, updated_at)
       VALUES ('p-alive', 't1', '[]', ?, ?), ('p-dead', 't2', '[]', ?, ?)`,
    ).run(ISO, ISO, ISO, ISO)
    db.prepare('UPDATE papers SET deleted_at = ? WHERE id = ?').run(ISO, 'p-dead')

    const alive = db
      .query("SELECT id FROM papers WHERE deleted_at IS NULL ORDER BY id")
      .all() as Array<{ id: string }>
    expect(alive.map((r) => r.id)).toEqual(['p-alive'])

    const dead = db
      .query("SELECT id FROM papers WHERE deleted_at IS NOT NULL")
      .all() as Array<{ id: string }>
    expect(dead.map((r) => r.id)).toEqual(['p-dead'])
  })

  test('proposals.modified_payload_json 与 payload_json 共存（不是替换）', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    db.prepare(
      `INSERT INTO proposals
       (id, kind, source_capability, payload_json, modified_payload_json, reasoning, status,
        target_kind, target_id, dismiss_policy, created_at, updated_at)
       VALUES (?, 'citation-relation', 'cap', ?, ?, 'r', 'modified', 'paper', 'p-1', 'once', ?, ?)`,
    ).run(
      'prop-mod',
      '{"from":"p-1","to":"p-2","type":"supports"}',
      '{"from":"p-1","to":"p-2","type":"method-ref"}',
      ISO,
      ISO,
    )
    const row = db
      .query('SELECT payload_json, modified_payload_json FROM proposals WHERE id = ?')
      .get('prop-mod') as { payload_json: string; modified_payload_json: string }
    expect(JSON.parse(row.payload_json).type).toBe('supports')
    expect(JSON.parse(row.modified_payload_json).type).toBe('method-ref')
  })
})

describe('reviews 实体：CHECK / FK / 多态 GC', () => {
  test('title / intent / source_capability 任一为空字符串 → CHECK 拒绝', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    for (const fields of [
      { title: '', intent: 'i', cap: 'c' },
      { title: 't', intent: '', cap: 'c' },
      { title: 't', intent: 'i', cap: '' },
    ]) {
      expect(() =>
        db
          .prepare(
            `INSERT INTO reviews (id, title, intent, source_capability, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run('rev-x', fields.title, fields.intent, fields.cap, ISO, ISO),
      ).toThrow(/CHECK/i)
    }
  })

  test('source_evidence_set_id FK：指向不存在的 EvidenceSet 抛 FK 错', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    expect(() =>
      db
        .prepare(
          `INSERT INTO reviews (id, title, intent, source_capability, source_evidence_set_id, created_at, updated_at)
           VALUES ('rev-1', 't', 'i', 'cap', 'nonexistent-set', ?, ?)`,
        )
        .run(ISO, ISO),
    ).toThrow(/FOREIGN KEY/i)
  })

  test('evidence_refs.target_review_id 多态化后无 FK：插入"指向不存在 review 的 ref"不报错', () => {
    // v0.2 重构：target 多态化，DB-FK 消失。应用层 GC 负责清理悬空 refs；
    // 这是设计决策 O3 的副作用，本测试固化文档化该行为。
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    db.prepare(
      `INSERT INTO papers (id, title, authors_json, created_at, updated_at)
       VALUES ('p-1', 't', '[]', ?, ?)`,
    ).run(ISO, ISO)
    expect(() =>
      db
        .prepare(
          `INSERT INTO evidence_refs
           (id, source_kind, source_id, source_anchor, target_kind, target_id, target_anchor, created_at, updated_at)
           VALUES ('r-1', 'paper', 'p-1', 'a', 'review', 'nonexistent-review', 'b', ?, ?)`,
        )
        .run(ISO, ISO),
    ).not.toThrow()
  })

  test('硬删 review → 关联的 evidence_refs **不**级联（多态 target 无 FK），需应用层 GC', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    db.prepare(
      `INSERT INTO papers (id, title, authors_json, created_at, updated_at)
       VALUES ('p-1', 't', '[]', ?, ?)`,
    ).run(ISO, ISO)
    seedReview(db, 'rev-1')
    db.prepare(
      `INSERT INTO evidence_refs
       (id, source_kind, source_id, source_anchor, target_kind, target_id, target_anchor, created_at, updated_at)
       VALUES ('r-1', 'paper', 'p-1', 'a', 'review', 'rev-1', 'b', ?, ?)`,
    ).run(ISO, ISO)
    db.prepare('DELETE FROM reviews WHERE id = ?').run('rev-1')
    // ref 仍然存在 —— 这是预期行为，仓储层 review delete 入口必须先调
    // deleteRefsByTarget('review', reviewId) 清理。
    const count = (db.query('SELECT COUNT(*) AS n FROM evidence_refs').get() as { n: number }).n
    expect(count).toBe(1)
  })

  test('软删 review（UPDATE deleted_at）→ evidence_refs 仍在（不级联）', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    db.prepare(
      `INSERT INTO papers (id, title, authors_json, created_at, updated_at)
       VALUES ('p-1', 't', '[]', ?, ?)`,
    ).run(ISO, ISO)
    seedReview(db, 'rev-1')
    db.prepare(
      `INSERT INTO evidence_refs
       (id, source_kind, source_id, source_anchor, target_kind, target_id, target_anchor, created_at, updated_at)
       VALUES ('r-1', 'paper', 'p-1', 'a', 'review', 'rev-1', 'b', ?, ?)`,
    ).run(ISO, ISO)
    db.prepare('UPDATE reviews SET deleted_at = ? WHERE id = ?').run(ISO, 'rev-1')
    const count = (db.query('SELECT COUNT(*) AS n FROM evidence_refs').get() as { n: number }).n
    expect(count).toBe(1)
  })

  test('source_evidence_set_id 指向真实 EvidenceSet → 可正常插入；删 set 后 SET NULL', () => {
    const db = openTestDb()
    runMigrations(asMigrationDb(db), MIGRATIONS)
    seedNote(db, 'note-x')
    db.prepare(
      `INSERT INTO evidence_sets (id, note_id, persisted, name, saved_at, created_at, updated_at, workspace_id)
       VALUES ('s-1', 'note-x', 1, 'n', ?, ?, ?, 'ws-test')`,
    ).run(ISO, ISO, ISO)
    db.prepare(
      `INSERT INTO reviews (id, title, intent, source_capability, source_evidence_set_id, created_at, updated_at)
       VALUES ('rev-1', 't', 'i', 'cap', 's-1', ?, ?)`,
    ).run(ISO, ISO)
    db.prepare('DELETE FROM evidence_sets WHERE id = ?').run('s-1')
    const row = db
      .query('SELECT source_evidence_set_id FROM reviews WHERE id = ?')
      .get('rev-1') as { source_evidence_set_id: string | null }
    expect(row.source_evidence_set_id).toBeNull()
  })
})
