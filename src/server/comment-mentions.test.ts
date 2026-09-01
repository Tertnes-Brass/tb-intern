import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Migrasjon `0013_gruppeledere-og-omtaler.sql` (#83) kjørt mot ekte SQLite.
 *
 * Tre ting skal bevises, og alle er vanskelige å se ved lesing:
 *
 * 1. **Migrasjonen er additiv.** Eksisterende kommentarer og varslingsvalg står
 *    urørt — ingen tabell-rebuild, ingen stille sletting via fremmednøkler (se
 *    AGENTS.md om D1 og `DROP TABLE` i en transaksjon).
 * 2. **Omtalene cascader med kommentaren.** Slettes en kommentar, forsvinner
 *    koblingene — men brukeren står igjen. Sletting av innhold skal aldri
 *    kunne slette folk.
 * 3. **Standarden for det nye varslingsvalget er «på».** Et medlem som aldri
 *    har valgt noe skal få vite at hen er nevnt.
 */

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../../migrations/0013_gruppeledere-og-omtaler.sql', import.meta.url)),
  'utf8',
)

/** Tabellene slik de så ut FØR migrasjonen, med fremmednøklene som betyr noe. */
const SCHEMA_BEFORE = `
  CREATE TABLE user (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL
  );
  CREATE TABLE posts (
    id TEXT PRIMARY KEY NOT NULL,
    body TEXT NOT NULL
  );
  CREATE TABLE post_comments (
    id TEXT PRIMARY KEY NOT NULL,
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_id TEXT REFERENCES user(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE notification_preferences (
    user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    posts TEXT DEFAULT 'all' NOT NULL,
    board_tasks TEXT DEFAULT 'all' NOT NULL
  );
`

function migratedDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA_BEFORE)
  db.exec(`
    INSERT INTO user (id, name) VALUES ('u1', 'Silje Tveit'), ('u2', 'Jonas Helle');
    INSERT INTO posts (id, body) VALUES ('p1', 'Noen som har sett notestativet?');
    INSERT INTO post_comments (id, post_id, author_id, body, created_at, updated_at)
      VALUES ('c1', 'p1', 'u2', 'Perfekt, tusen takk!', 1000, 1000);
    INSERT INTO notification_preferences (user_id, posts, board_tasks) VALUES ('u1', 'important', 'off');
  `)
  for (const statement of MIGRATION.split('--> statement-breakpoint')) {
    const sql = statement.trim()
    if (sql) db.exec(sql)
  }
  return db
}

describe('migrasjon 0013 (omtaler i kommentarer)', () => {
  it('lar eksisterende kommentarer stå urørt', () => {
    const db = migratedDb()
    expect(db.prepare('SELECT id, author_id, body FROM post_comments').all()).toEqual([
      { id: 'c1', author_id: 'u2', body: 'Perfekt, tusen takk!' },
    ])
    db.close()
  })

  it('beholder valgene folk allerede har gjort, og setter omtaler til «på»', () => {
    const db = migratedDb()
    expect(db.prepare('SELECT posts, board_tasks, mentions FROM notification_preferences WHERE user_id = ?').get('u1')).toEqual(
      { posts: 'important', board_tasks: 'off', mentions: 'all' },
    )
    db.close()
  })

  it('bare legger til — den bygger ingen tabell på nytt', () => {
    // En rebuild ville stått som `CREATE TABLE __new_...` + `DROP TABLE`, og i
    // D1 (der PRAGMA-en er en no-op inne i transaksjonen) tatt barnetabellene
    // med seg.
    expect(MIGRATION).not.toMatch(/DROP TABLE/i)
    expect(MIGRATION).not.toMatch(/__new_/)
  })

  it('tillater bare én rad per kommentar og bruker — dobbel omtale er én omtale', () => {
    const db = migratedDb()
    db.exec("INSERT INTO post_comment_mentions (comment_id, user_id) VALUES ('c1', 'u1');")
    expect(() => db.exec("INSERT INTO post_comment_mentions (comment_id, user_id) VALUES ('c1', 'u1');")).toThrow()
    db.close()
  })

  it('rydder omtalene når kommentaren slettes — og lar brukeren stå', () => {
    const db = migratedDb()
    db.exec("INSERT INTO post_comment_mentions (comment_id, user_id) VALUES ('c1', 'u1');")
    db.exec("DELETE FROM post_comments WHERE id = 'c1';")
    expect(db.prepare('SELECT count(*) AS n FROM post_comment_mentions').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM user').get()).toEqual({ n: 2 })
    db.close()
  })

  it('rydder omtalene når hele innlegget slettes (to ledd med cascade)', () => {
    const db = migratedDb()
    db.exec("INSERT INTO post_comment_mentions (comment_id, user_id) VALUES ('c1', 'u1');")
    db.exec("DELETE FROM posts WHERE id = 'p1';")
    expect(db.prepare('SELECT count(*) AS n FROM post_comment_mentions').get()).toEqual({ n: 0 })
    db.close()
  })

  it('lar kommentaren overleve at en omtalt bruker slettes', () => {
    const db = migratedDb()
    db.exec("INSERT INTO post_comment_mentions (comment_id, user_id) VALUES ('c1', 'u1');")
    db.exec("DELETE FROM user WHERE id = 'u1';")
    // Koblingen forsvinner, teksten står. Markøren rendres da som «Ukjent medlem».
    expect(db.prepare('SELECT count(*) AS n FROM post_comment_mentions').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM post_comments').get()).toEqual({ n: 1 })
    db.close()
  })

  it('avviser en omtale som peker på en kommentar eller bruker som ikke finnes', () => {
    const db = migratedDb()
    expect(() => db.exec("INSERT INTO post_comment_mentions (comment_id, user_id) VALUES ('c1', 'ukjent');")).toThrow()
    expect(() => db.exec("INSERT INTO post_comment_mentions (comment_id, user_id) VALUES ('ukjent', 'u1');")).toThrow()
    db.close()
  })
})
