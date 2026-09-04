import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ROUND2_STUB_SCHEMA } from './migration-test-stubs'

/**
 * Migrasjon `0017_backlog-runde-2.sql` kjørt mot ekte SQLite —
 * prosjektvarsling (#18 + #51) og prosjektkommentarer (#27).
 *
 * Fem ting skal bevises, og ingen av dem er synlige ved å lese skjemaet:
 *
 * 1. **Migrasjonen er additiv.** Ingen tabell bygges på nytt, så ingen
 *    barnetabell tømmes i stillhet (se AGENTS.md om D1 og `DROP TABLE` i en
 *    transaksjon), og eksisterende rader står urørt.
 * 2. **Varslingsvalget får «all» for alle som allerede finnes.** Fravær av et
 *    valg skal aldri bety «ingen varsler».
 * 3. **Idempotensnøkkelen holder.** Én rad per (prosjekt, mottaker, varseltype)
 *    — men `published` og `update` er to ulike rader for samme person.
 * 4. **Kommentarene cascader riktig.** Slettes prosjektet, forsvinner tråden;
 *    slettes tråden, forsvinner svarene; slettes BRUKEREN, blir kommentaren
 *    stående uten forfatter. Innhold som slettes skal aldri slette folk, og en
 *    person som slutter skal ikke rive med seg historikken.
 * 5. **Varsler og endringer henger på prosjektet**, ikke omvendt.
 */

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../../migrations/0017_backlog-runde-2.sql', import.meta.url)),
  'utf8',
)

/** Tabellene slik de så ut FØR migrasjonen, med det som betyr noe her. */
const SCHEMA_BEFORE = `
  CREATE TABLE user (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL
  );
  CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    is_published INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE notification_preferences (
    user_id TEXT PRIMARY KEY NOT NULL,
    posts TEXT NOT NULL DEFAULT 'all',
    board_tasks TEXT NOT NULL DEFAULT 'all',
    mentions TEXT NOT NULL DEFAULT 'all'
  );
`

function migratedDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA_BEFORE)
  db.exec(ROUND2_STUB_SCHEMA)
  db.exec(`
    INSERT INTO user (id, name) VALUES ('u1', 'Ingrid Vik'), ('u2', 'Jonas Helle');
    INSERT INTO projects (id, name, is_published) VALUES ('p1', 'Julekonsert 2026', 1);
    -- Et medlem som allerede har valgt noe FØR kolonnen fantes.
    INSERT INTO notification_preferences (user_id, posts, mentions) VALUES ('u1', 'important', 'off');
  `)
  for (const statement of MIGRATION.split('--> statement-breakpoint')) {
    const sql = statement.trim()
    if (sql) db.exec(sql)
  }
  return db
}

describe('migrasjon 0017 (prosjektvarsling og kommentarer)', () => {
  it('lar eksisterende rader stå urørt', () => {
    const db = migratedDb()
    expect(db.prepare('SELECT id, name FROM projects').all()).toEqual([
      { id: 'p1', name: 'Julekonsert 2026' },
    ])
    // Valgene medlemmet allerede hadde gjort skal ikke nullstilles av en ny kolonne.
    expect(db.prepare('SELECT posts, mentions FROM notification_preferences WHERE user_id = ?').get('u1')).toEqual({
      posts: 'important',
      mentions: 'off',
    })
  })

  it('er additiv — ingen tabell bygges på nytt', () => {
    expect(MIGRATION).not.toMatch(/__new_/)
    expect(MIGRATION).not.toMatch(/\bDROP\b/i)
    expect(MIGRATION).not.toMatch(/PRAGMA/i)
  })

  it('gir alle som allerede finnes «all» for prosjektvarsler', () => {
    const db = migratedDb()
    expect(db.prepare('SELECT projects FROM notification_preferences WHERE user_id = ?').get('u1')).toEqual({
      projects: 'all',
    })
  })

  it('lar en ny rad få standarden uten å nevne kolonnen', () => {
    const db = migratedDb()
    db.exec(`INSERT INTO notification_preferences (user_id) VALUES ('u2')`)
    expect(db.prepare('SELECT projects FROM notification_preferences WHERE user_id = ?').get('u2')).toEqual({
      projects: 'all',
    })
  })
})

describe('idempotens for prosjektvarsler', () => {
  const insert = (db: DatabaseSync, kind: string) =>
    db.exec(
      `INSERT INTO project_notifications (project_id, user_id, kind, sent_at, outcome)
       VALUES ('p1', 'u1', '${kind}', 1000, 'sent')`,
    )

  it('godtar ÉN rad per prosjekt, mottaker og varseltype', () => {
    const db = migratedDb()
    insert(db, 'published')
    // Nøyaktig det som gjør avpubliser/republiser trygt: raden finnes allerede.
    expect(() => insert(db, 'published')).toThrow()
  })

  it('holder publiseringsvarsel og endringsvarsel fra hverandre', () => {
    const db = migratedDb()
    insert(db, 'published')
    insert(db, 'update')
    expect(db.prepare('SELECT count(*) AS n FROM project_notifications').get()).toEqual({ n: 2 })
  })

  it('lar endringsvarselet få nytt tidspunkt uten en ny rad', () => {
    const db = migratedDb()
    insert(db, 'update')
    db.exec(
      `INSERT INTO project_notifications (project_id, user_id, kind, sent_at, outcome)
       VALUES ('p1', 'u1', 'update', 2000, 'logged')
       ON CONFLICT (project_id, user_id, kind) DO UPDATE SET sent_at = excluded.sent_at, outcome = excluded.outcome`,
    )
    expect(db.prepare('SELECT sent_at, outcome FROM project_notifications').all()).toEqual([
      { sent_at: 2000, outcome: 'logged' },
    ])
  })

  it('rydder varsler og endringer bort med prosjektet', () => {
    const db = migratedDb()
    insert(db, 'published')
    db.exec(
      `INSERT INTO project_changes (id, project_id, kind, subject, detail, actor_user_id, created_at)
       VALUES ('c1', 'p1', 'work_added', 'Where Eagles Sing', NULL, 'u1', 1000)`,
    )
    db.exec(`DELETE FROM projects WHERE id = 'p1'`)
    expect(db.prepare('SELECT count(*) AS n FROM project_notifications').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM project_changes').get()).toEqual({ n: 0 })
    // Folk slettes aldri av at innhold slettes.
    expect(db.prepare('SELECT count(*) AS n FROM user').get()).toEqual({ n: 2 })
  })

  it('beholder endringen når den som gjorde den forsvinner', () => {
    const db = migratedDb()
    db.exec(
      `INSERT INTO project_changes (id, project_id, kind, subject, detail, actor_user_id, created_at)
       VALUES ('c1', 'p1', 'work_added', 'Where Eagles Sing', NULL, 'u1', 1000)`,
    )
    db.exec(`DELETE FROM user WHERE id = 'u1'`)
    expect(db.prepare('SELECT subject, actor_user_id FROM project_changes').all()).toEqual([
      { subject: 'Where Eagles Sing', actor_user_id: null },
    ])
  })
})

describe('prosjektkommentarer', () => {
  function withThread(): DatabaseSync {
    const db = migratedDb()
    db.exec(`
      INSERT INTO project_comments (id, project_id, parent_id, author_id, body, created_at, updated_at)
      VALUES ('q1', 'p1', NULL, 'u1', 'Kva tid er lastinga?', 1000, 1000);
      INSERT INTO project_comments (id, project_id, parent_id, author_id, body, created_at, updated_at)
      VALUES ('a1', 'p1', 'q1', 'u2', 'Klokka 09 på lørdag.', 2000, 2000);
    `)
    return db
  }

  it('lar en tråd ha svar under seg', () => {
    const db = withThread()
    expect(db.prepare('SELECT count(*) AS n FROM project_comments WHERE parent_id = ?').get('q1')).toEqual({ n: 1 })
  })

  it('tar svarene med når tråden slettes — en tråd modereres som en tråd', () => {
    const db = withThread()
    db.exec(`DELETE FROM project_comments WHERE id = 'q1'`)
    expect(db.prepare('SELECT count(*) AS n FROM project_comments').get()).toEqual({ n: 0 })
  })

  it('tar hele tråden med når prosjektet slettes', () => {
    const db = withThread()
    db.exec(`DELETE FROM projects WHERE id = 'p1'`)
    expect(db.prepare('SELECT count(*) AS n FROM project_comments').get()).toEqual({ n: 0 })
  })

  it('beholder kommentaren når forfatteren slettes', () => {
    const db = withThread()
    db.exec(`DELETE FROM user WHERE id = 'u1'`)
    const row = db.prepare('SELECT body, author_id FROM project_comments WHERE id = ?').get('q1')
    // Teksten står; navnet blir «Ukjent» ved visning. Historikken går aldri tapt.
    expect(row).toEqual({ body: 'Kva tid er lastinga?', author_id: null })
  })

  it('starter uavklart, og glemmer hvem som avklarte når kontoen forsvinner', () => {
    const db = withThread()
    expect(db.prepare('SELECT resolved_at, resolved_by FROM project_comments WHERE id = ?').get('q1')).toEqual({
      resolved_at: null,
      resolved_by: null,
    })
    db.exec(`UPDATE project_comments SET resolved_at = 3000, resolved_by = 'u2' WHERE id = 'q1'`)
    db.exec(`DELETE FROM user WHERE id = 'u2'`)
    expect(db.prepare('SELECT resolved_at, resolved_by FROM project_comments WHERE id = ?').get('q1')).toEqual({
      resolved_at: 3000,
      resolved_by: null,
    })
  })
})
