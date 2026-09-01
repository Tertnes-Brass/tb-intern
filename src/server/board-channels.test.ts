import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Migrasjon `0012_markdown-og-chatkanaler.sql` (#80) kjørt mot ekte SQLite.
 *
 * To ting skal bevises her, og begge er vanskelige å se ved lesing:
 *
 * 1. **Migrasjonen er additiv.** Eksisterende meldinger i fellesekanalen og i
 *    prosjekttrådene skal stå urørt etterpå — ingen tabell-rebuild, ingen
 *    stille sletting via fremmednøkler (se AGENTS.md om D1 og `DROP TABLE`).
 * 2. **`reply_to_id` er `ON DELETE SET NULL`.** drizzle-kit skriver ikke
 *    `ON DELETE` i `ADD COLUMN`, så klausulen står for hånd i migrasjonen. Uten
 *    den ville sletting av en melding med svar feilet på fremmednøkkelen med
 *    `PRAGMA foreign_keys = ON` — altså i D1.
 */

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../../migrations/0012_markdown-og-chatkanaler.sql', import.meta.url)),
  'utf8',
)

/** Tabellene slik de så ut FØR migrasjonen, med fremmednøklene som betyr noe. */
const SCHEMA_BEFORE = `
  CREATE TABLE user (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL
  );
  CREATE TABLE board_projects (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'active' NOT NULL
  );
  CREATE TABLE board_messages (
    id TEXT PRIMARY KEY NOT NULL,
    channel TEXT NOT NULL,
    author_id TEXT REFERENCES user(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX board_messages_channel_idx ON board_messages (channel, created_at);
`

function migratedDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA_BEFORE)
  db.exec(`
    INSERT INTO user (id, name) VALUES ('u1', 'Hilde');
    INSERT INTO board_projects (id, title, status) VALUES ('p1', 'Nye uniformer', 'active');
    INSERT INTO board_messages (id, channel, author_id, body, created_at)
      VALUES ('m1', 'general', 'u1', 'Første melding', 1000),
             ('m2', 'project:p1', 'u1', 'Tilbudet er inne', 2000);
  `)
  for (const statement of MIGRATION.split('--> statement-breakpoint')) {
    const sql = statement.trim()
    if (sql) db.exec(sql)
  }
  return db
}

describe('migrasjon 0012 (kanaler og svar)', () => {
  it('lar eksisterende meldinger stå urørt', () => {
    const db = migratedDb()
    const rows = db.prepare('SELECT id, channel, author_id, body FROM board_messages ORDER BY created_at').all()
    expect(rows).toEqual([
      { id: 'm1', channel: 'general', author_id: 'u1', body: 'Første melding' },
      { id: 'm2', channel: 'project:p1', author_id: 'u1', body: 'Tilbudet er inne' },
    ])
    db.close()
  })

  it('gir gamle meldinger tomme svarfelt', () => {
    const db = migratedDb()
    const row = db.prepare('SELECT reply_to_id, reply_to_deleted FROM board_messages WHERE id = ?').get('m1')
    expect(row).toEqual({ reply_to_id: null, reply_to_deleted: 0 })
    db.close()
  })

  it('bare legger til — den bygger ingen tabell på nytt', () => {
    // En rebuild ville stått som `CREATE TABLE __new_...` + `DROP TABLE`, og i
    // D1 (der PRAGMA-en er en no-op inne i transaksjonen) tatt barnetabellene
    // med seg.
    expect(MIGRATION).not.toMatch(/DROP TABLE/i)
    expect(MIGRATION).not.toMatch(/__new_/)
  })

  it('nullstiller svarreferansen når originalen slettes — uten å feile på fremmednøkkelen', () => {
    const db = migratedDb()
    db.exec(`
      INSERT INTO board_channels (id, kind, name, created_at) VALUES ('c1', 'custom', 'Uniformer 2027', 3000);
      INSERT INTO board_messages (id, channel, author_id, body, created_at)
        VALUES ('m3', 'custom:c1', 'u1', 'Originalen', 4000);
      INSERT INTO board_messages (id, channel, author_id, body, reply_to_id, created_at)
        VALUES ('m4', 'custom:c1', 'u1', 'Svaret', 'm3', 5000);
    `)

    // Slik `deleteMessage` gjør det: merk svarene FØR originalen forsvinner.
    db.exec("UPDATE board_messages SET reply_to_id = NULL, reply_to_deleted = 1 WHERE reply_to_id = 'm3';")
    db.exec("DELETE FROM board_messages WHERE id = 'm3';")

    expect(db.prepare('SELECT reply_to_id, reply_to_deleted FROM board_messages WHERE id = ?').get('m4')).toEqual({
      reply_to_id: null,
      reply_to_deleted: 1,
    })
    db.close()
  })

  it('sletter en hel kanal uten at svar innad i den blokkerer', () => {
    // Prosjekttråden slettes med prosjektet (`deleteBoardProject`), og da går
    // både originalen og svaret i samme setning. Med `ON DELETE SET NULL` er
    // rekkefølgen innad i setningen likegyldig.
    const db = migratedDb()
    db.exec(`
      INSERT INTO board_messages (id, channel, author_id, body, created_at)
        VALUES ('m5', 'project:p1', 'u1', 'Original', 6000);
      INSERT INTO board_messages (id, channel, author_id, body, reply_to_id, created_at)
        VALUES ('m6', 'project:p1', 'u1', 'Svar', 'm5', 7000);
    `)
    expect(() => db.exec("DELETE FROM board_messages WHERE channel = 'project:p1';")).not.toThrow()
    expect(db.prepare("SELECT count(*) AS n FROM board_messages WHERE channel = 'project:p1'").get()).toEqual({ n: 0 })
    db.close()
  })

  it('lar en egendefinert kanal overleve at et styreprosjekt slettes', () => {
    const db = migratedDb()
    db.exec(
      "INSERT INTO board_channels (id, kind, name, board_project_id, created_at) VALUES ('c2', 'custom', 'Jubileum', 'p1', 8000);",
    )
    db.exec("DELETE FROM board_projects WHERE id = 'p1';")
    expect(db.prepare('SELECT board_project_id FROM board_channels WHERE id = ?').get('c2')).toEqual({
      board_project_id: null,
    })
    db.close()
  })
})
