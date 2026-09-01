import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Migrasjon `0013_gruppeledere-og-omtaler.sql` (#81) kjørt mot ekte SQLite.
 *
 * Tre ting skal bevises her, og alle er vanskelige å se ved lesing:
 *
 * 1. **Migrasjonen er rent additiv.** Kun `CREATE TABLE`/`CREATE INDEX`. En
 *    generert rebuild (`CREATE __new_x` + `DROP TABLE x`) ville i D1 cascadet
 *    til barnetabellene inne i transaksjonen, der PRAGMA-en er en no-op — se
 *    AGENTS.md.
 * 2. **`reply_to_id` er `ON DELETE SET NULL`.** Klausulen står i CREATE TABLE
 *    (der drizzle-kit skriver den; det er i ADD COLUMN den faller bort, jf.
 *    0012). Uten den ville sletting av en melding med svar feilet på
 *    fremmednøkkelen med `PRAGMA foreign_keys = ON` — altså i D1.
 * 3. **Gruppelederdataene er egne.** Migrasjonen rører ingen `board_`-tabell,
 *    og en fjernet leiarbinding tar ikke historikken med seg.
 */

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../../migrations/0013_gruppeledere-og-omtaler.sql', import.meta.url)),
  'utf8',
)

/** Tabellene migrasjonen peker på, slik de allerede finnes. */
const SCHEMA_BEFORE = `
  CREATE TABLE user (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL
  );
  CREATE TABLE parts (
    id TEXT PRIMARY KEY NOT NULL,
    name_no TEXT NOT NULL
  );
  CREATE TABLE section_leaders (
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    part_id TEXT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, part_id)
  );
  -- Styrets chat finnes fra 0012. Den skal stå helt urørt etterpå.
  CREATE TABLE board_messages (
    id TEXT PRIMARY KEY NOT NULL,
    channel TEXT NOT NULL,
    author_id TEXT REFERENCES user(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`

function migratedDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA_BEFORE)
  db.exec(`
    INSERT INTO user (id, name) VALUES ('u1', 'Ingrid'), ('u2', 'Karim');
    INSERT INTO parts (id, name_no) VALUES ('solo-cornet', 'Solokornett');
    INSERT INTO section_leaders (user_id, part_id) VALUES ('u1', 'solo-cornet');
    INSERT INTO board_messages (id, channel, author_id, body, created_at)
      VALUES ('b1', 'general', 'u1', 'Styrets egen melding', 1000);
  `)
  for (const statement of MIGRATION.split('--> statement-breakpoint')) {
    const sql = statement.trim()
    if (sql) db.exec(sql)
  }
  return db
}

describe('migrasjon 0013 (gruppelederområdet)', () => {
  it('bare legger til — den bygger ingen tabell på nytt', () => {
    expect(MIGRATION).not.toMatch(/DROP TABLE/i)
    expect(MIGRATION).not.toMatch(/__new_/)
    expect(MIGRATION).not.toMatch(/ALTER TABLE/i)
  })

  it('lager tre egne tabeller og rører ingen styretabell', () => {
    const db = migratedDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'leader%' ORDER BY name")
      .all()
    expect(tables).toEqual([
      { name: 'leader_channel_reads' },
      { name: 'leader_channels' },
      { name: 'leader_messages' },
    ])
    // Meldingen i styrechatten skal være akkurat der den var.
    expect(db.prepare('SELECT body FROM board_messages WHERE id = ?').get('b1')).toEqual({
      body: 'Styrets egen melding',
    })
    expect(MIGRATION).not.toMatch(/board_/)
    db.close()
  })

  it('nullstiller svarreferansen når originalen slettes — uten å feile på fremmednøkkelen', () => {
    const db = migratedDb()
    db.exec(`
      INSERT INTO leader_channels (id, kind, name, created_at) VALUES ('c1', 'custom', 'Slagverk-rigg', 3000);
      INSERT INTO leader_messages (id, channel, author_id, body, created_at)
        VALUES ('m1', 'custom:c1', 'u1', 'Originalen', 4000);
      INSERT INTO leader_messages (id, channel, author_id, body, reply_to_id, created_at)
        VALUES ('m2', 'custom:c1', 'u2', 'Svaret', 'm1', 5000);
    `)

    // Slik `deleteMessage` gjør det: merk svarene FØR originalen forsvinner.
    db.exec("UPDATE leader_messages SET reply_to_id = NULL, reply_to_deleted = 1 WHERE reply_to_id = 'm1';")
    expect(() => db.exec("DELETE FROM leader_messages WHERE id = 'm1';")).not.toThrow()

    expect(db.prepare('SELECT reply_to_id, reply_to_deleted FROM leader_messages WHERE id = ?').get('m2')).toEqual({
      reply_to_id: null,
      reply_to_deleted: 1,
    })
    db.close()
  })

  it('lar en hel kanal slettes uten at svar innad i den blokkerer', () => {
    // Uten ON DELETE SET NULL ville rekkefølgen innad i én DELETE-setning
    // avgjort om den gikk gjennom eller feilet.
    const db = migratedDb()
    db.exec(`
      INSERT INTO leader_messages (id, channel, author_id, body, created_at)
        VALUES ('m3', 'general', 'u1', 'Original', 6000);
      INSERT INTO leader_messages (id, channel, author_id, body, reply_to_id, created_at)
        VALUES ('m4', 'general', 'u2', 'Svar', 'm3', 7000);
    `)
    expect(() => db.exec("DELETE FROM leader_messages WHERE channel = 'general';")).not.toThrow()
    db.close()
  })

  it('lar historikken stå når leiarbindingen fjernes', () => {
    // Tilgangen skal forsvinne med én gang (`isGroupLeader`), men meldingen er
    // skrevet av en person — den skal fortsatt vise navnet hens.
    const db = migratedDb()
    db.exec(
      "INSERT INTO leader_messages (id, channel, author_id, body, created_at) VALUES ('m5', 'general', 'u1', 'Vi tar rigg på torsdag', 8000);",
    )
    db.exec("DELETE FROM section_leaders WHERE user_id = 'u1';")
    expect(
      db
        .prepare(
          'SELECT m.author_id AS author_id, u.name AS name FROM leader_messages m LEFT JOIN user u ON u.id = m.author_id WHERE m.id = ?',
        )
        .get('m5'),
    ).toEqual({ author_id: 'u1', name: 'Ingrid' })
    db.close()
  })

  it('gir en melding tomme svarfelt som standard', () => {
    const db = migratedDb()
    db.exec(
      "INSERT INTO leader_messages (id, channel, author_id, body, created_at) VALUES ('m6', 'general', 'u2', 'Hei', 9000);",
    )
    expect(db.prepare('SELECT reply_to_id, reply_to_deleted FROM leader_messages WHERE id = ?').get('m6')).toEqual({
      reply_to_id: null,
      reply_to_deleted: 0,
    })
    db.close()
  })
})
