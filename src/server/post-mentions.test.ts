import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Migrasjon `0014_mentions-everywhere.sql` kjørt mot ekte SQLite — omtaler i
 * selve innlegget.
 *
 * Fire ting skal bevises, og alle er vanskelige å se ved lesing:
 *
 * 1. **Migrasjonen er additiv.** Ingen tabell bygges på nytt, så ingen
 *    barnetabell tømmes i stillhet (se AGENTS.md om D1 og `DROP TABLE` i en
 *    transaksjon).
 * 2. **Omtalene cascader med innlegget** — og med brukeren. Innhold som slettes
 *    skal aldri kunne slette folk.
 * 3. **Én rad per (innlegg, bruker).** Nevnes noen tre ganger i teksten, er det
 *    fortsatt én omtale og én e-post.
 * 4. **`notified_at` starter tom** og er det som gjør varslingen idempotent.
 */

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../../migrations/0014_mentions-everywhere.sql', import.meta.url)),
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
    body TEXT NOT NULL,
    published_at INTEGER
  );
`

function migratedDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA_BEFORE)
  db.exec(`
    INSERT INTO user (id, name) VALUES ('u1', 'Silje Tveit'), ('u2', 'Jonas Helle');
    INSERT INTO posts (id, body, published_at) VALUES ('p1', 'Hei @[u:u1], tar du notestativet?', 1000);
  `)
  for (const statement of MIGRATION.split('--> statement-breakpoint')) {
    const sql = statement.trim()
    if (sql) db.exec(sql)
  }
  return db
}

describe('migrasjon 0014 (omtaler i innlegg)', () => {
  it('lar eksisterende innlegg stå urørt', () => {
    const db = migratedDb()
    expect(db.prepare('SELECT id, body FROM posts').all()).toEqual([
      { id: 'p1', body: 'Hei @[u:u1], tar du notestativet?' },
    ])
    db.close()
  })

  it('bare legger til — den bygger ingen tabell på nytt', () => {
    expect(MIGRATION).not.toMatch(/DROP TABLE/i)
    expect(MIGRATION).not.toMatch(/__new_/)
  })

  it('starter uten varslingsmerke — utkast varsler aldri', () => {
    const db = migratedDb()
    db.exec("INSERT INTO post_mentions (post_id, user_id) VALUES ('p1', 'u1');")
    expect(db.prepare('SELECT notified_at FROM post_mentions').get()).toEqual({ notified_at: null })
    db.close()
  })

  it('tillater bare én rad per innlegg og bruker — dobbel omtale er én omtale', () => {
    const db = migratedDb()
    db.exec("INSERT INTO post_mentions (post_id, user_id) VALUES ('p1', 'u1');")
    expect(() => db.exec("INSERT INTO post_mentions (post_id, user_id) VALUES ('p1', 'u1');")).toThrow()
    db.close()
  })

  it('rydder omtalene når innlegget slettes — og lar brukeren stå', () => {
    const db = migratedDb()
    db.exec("INSERT INTO post_mentions (post_id, user_id) VALUES ('p1', 'u1');")
    db.exec("DELETE FROM posts WHERE id = 'p1';")
    expect(db.prepare('SELECT count(*) AS n FROM post_mentions').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM user').get()).toEqual({ n: 2 })
    db.close()
  })

  it('lar innlegget overleve at en omtalt bruker slettes', () => {
    const db = migratedDb()
    db.exec("INSERT INTO post_mentions (post_id, user_id) VALUES ('p1', 'u1');")
    db.exec("DELETE FROM user WHERE id = 'u1';")
    // Koblingen forsvinner, teksten står. Markøren rendres da som «Ukjent medlem».
    expect(db.prepare('SELECT count(*) AS n FROM post_mentions').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM posts').get()).toEqual({ n: 1 })
    db.close()
  })

  it('avviser en omtale som peker på et innlegg eller en bruker som ikke finnes', () => {
    const db = migratedDb()
    expect(() => db.exec("INSERT INTO post_mentions (post_id, user_id) VALUES ('p1', 'ukjent');")).toThrow()
    expect(() => db.exec("INSERT INTO post_mentions (post_id, user_id) VALUES ('ukjent', 'u1');")).toThrow()
    db.close()
  })

  it('lar merket settes, og beholder det ved neste publisering', () => {
    const db = migratedDb()
    db.exec("INSERT INTO post_mentions (post_id, user_id) VALUES ('p1', 'u1');")
    db.exec("UPDATE post_mentions SET notified_at = 5000 WHERE post_id = 'p1' AND user_id = 'u1';")
    // Slik `syncPostMentions` skriver ved en ny lagring: raden finnes, og
    // `onConflictDoNothing` skal IKKE nullstille merket.
    db.exec("INSERT OR IGNORE INTO post_mentions (post_id, user_id) VALUES ('p1', 'u1');")
    expect(db.prepare('SELECT notified_at FROM post_mentions').get()).toEqual({ notified_at: 5000 })
    db.close()
  })
})
