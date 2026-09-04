import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ROUND2_STUB_SCHEMA } from './migration-test-stubs'

/**
 * Migrasjon `0017_backlog-runde-2.sql` (#32) kjørt mot ekte SQLite.
 *
 * Tre ting skal bevises her, og ingen av dem er synlige ved lesing:
 *
 * 1. **Migrasjonen er rent additiv.** Kun `CREATE TABLE`/`CREATE INDEX` og to
 *    `INSERT OR IGNORE ... SELECT`. Ingen `DROP`, ingen `DELETE`, ingen
 *    rebuild (`__new_`) — en rebuild ville i D1 cascadet til barnetabellene
 *    inne i transaksjonen, der `PRAGMA foreign_keys=OFF` er en no-op (AGENTS.md).
 * 2. **`ON DELETE`-klausulene står der.** drizzle-kit mister dem ofte, og en
 *    manglende `SET NULL` ville her betydd at et slettet prosjekt drar
 *    konsertopptaket med seg. Testen sletter faktisk et prosjekt og et verk og
 *    ser hva som skjer med raden — den leser ikke SQL-teksten.
 * 3. **Rettighetsseedingen er FK-trygg og idempotent.** `INSERT OR IGNORE`
 *    dekker ikke fremmednøkler, derfor `SELECT ... FROM roles`: en database
 *    uten seedede roller skal velge null rader i stedet for å feile.
 */

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../../migrations/0017_backlog-runde-2.sql', import.meta.url)),
  'utf8',
)

/**
 * Migrasjonen uten kommentarlinjer. Kommentarene NEVNER `DROP TABLE` og
 * `__new_` for å forklare hvorfor de ikke står i SQL-en — det er selve
 * setningene som skal granskes, ikke begrunnelsen for dem.
 */
const STATEMENTS = MIGRATION.replace(/^\s*--.*$/gm, '')

/** Tabellene migrasjonen peker på, slik de fantes før den. */
const SCHEMA_BEFORE = `
  CREATE TABLE user (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL
  );
  CREATE TABLE roles (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    is_system INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE role_permissions (
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    PRIMARY KEY (role_id, permission)
  );
  CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE works (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL DEFAULT ''
  );
`

const DATA_BEFORE = `
  INSERT INTO roles (id, name, is_system) VALUES
    ('admin', 'Administrator', 1),
    ('board', 'Styremedlem', 1),
    ('member', 'Musiker', 1);
  INSERT INTO role_permissions (role_id, permission) VALUES
    ('admin', '*'),
    ('board', 'board.manage'),
    ('member', 'scores.view');
  INSERT INTO user (id, name) VALUES ('u-1', 'Sindre');
  INSERT INTO projects (id, name) VALUES ('p-1', 'Julekonsert 2025');
  INSERT INTO works (id, title) VALUES ('w-1', 'Gaelforce');
`

function applyMigration(db: DatabaseSync): void {
  for (const statement of MIGRATION.split('--> statement-breakpoint')) {
    const sql = statement.trim()
    if (sql) db.exec(sql)
  }
}

function migratedDb(seed = DATA_BEFORE): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  // Fremmednøkler PÅ: D1 håndhever dem, så en FK-feil skal dukke opp her og
  // ikke i produksjon.
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA_BEFORE)
  db.exec(ROUND2_STUB_SCHEMA)
  if (seed) db.exec(seed)
  applyMigration(db)
  return db
}

/** Ett medieelement koblet til både prosjekt og verk. */
function insertItem(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO media_items
      (id, title, kind, visibility, project_id, work_id, r2_key, file_name, size, content_type, uploaded_by, created_at, updated_at)
    VALUES
      ('m-1', 'Gaelforce live', 'lyd', 'intern', 'p-1', 'w-1', 'media/m-1.mp3', 'gaelforce.mp3', 1024, 'audio/mpeg', 'u-1', 1000, 1000);
  `)
}

function permissionsOf(db: DatabaseSync, roleId: string): string[] {
  return db
    .prepare('SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission')
    .all(roleId)
    .map((row) => row.permission as string)
}

describe('migrasjon 0017 (mediearkiv)', () => {
  it('er rent additiv — ingen DROP, DELETE eller tabell-rebuild', () => {
    expect(STATEMENTS).not.toMatch(/DROP TABLE/i)
    expect(STATEMENTS).not.toMatch(/DROP COLUMN/i)
    expect(STATEMENTS).not.toMatch(/DROP INDEX/i)
    expect(STATEMENTS).not.toMatch(/DELETE FROM/i)
    expect(STATEMENTS).not.toMatch(/__new_/)
    expect(STATEMENTS).not.toMatch(/PRAGMA/i)
  })

  it('rører ingen eksisterende tabell — den eneste skrivingen er rettighetene', () => {
    // `INSERT` mot role_permissions er tillatt (og testet under). Alt annet
    // som skriver i en tabell som fantes fra før, ville vært en endring av
    // data noen andre eier.
    expect(STATEMENTS).not.toMatch(/UPDATE\s+`?\w+`?\s+SET/i)
    const inserts = STATEMENTS.match(/INSERT[^;]*INTO\s+`?(\w+)`?/gi) ?? []
    expect(inserts).toHaveLength(2)
    for (const insert of inserts) expect(insert).toMatch(/role_permissions/)
  })

  it('oppretter media_items med de tre indeksene', () => {
    const db = migratedDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'media_items'")
      .all()
    expect(tables).toHaveLength(1)
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'media_items' ORDER BY name")
      .all()
      .map((row) => row.name as string)
      // SQLite lager selv en autoindeks for TEXT PRIMARY KEY; den er ikke vår.
      .filter((name) => !name.startsWith('sqlite_autoindex'))
    expect(indexes).toEqual(['media_items_project_idx', 'media_items_recorded_idx', 'media_items_work_idx'])
  })

  it('gir «intern» som standard tilgangsnivå', () => {
    const db = migratedDb()
    db.exec(`
      INSERT INTO media_items (id, title, kind, r2_key, file_name, content_type, created_at, updated_at)
      VALUES ('m-2', 'Uten nivå', 'bilde', 'media/m-2.jpg', 'b.jpg', 'image/jpeg', 1, 1);
    `)
    const row = db.prepare('SELECT visibility FROM media_items WHERE id = ?').get('m-2')
    expect(row?.visibility).toBe('intern')
  })

  // Den viktigste av dem: en manglende ON DELETE-klausul her ville betydd at et
  // slettet prosjekt tar konsertopptaket med seg i fallet.
  it('beholder opptaket når prosjektet slettes — SET NULL, ikke CASCADE', () => {
    const db = migratedDb()
    insertItem(db)
    db.exec("DELETE FROM projects WHERE id = 'p-1';")
    const row = db.prepare('SELECT project_id, work_id FROM media_items WHERE id = ?').get('m-1')
    expect(row).toBeDefined()
    expect(row?.project_id).toBeNull()
    expect(row?.work_id).toBe('w-1')
  })

  it('beholder opptaket når verket slettes fra arkivet', () => {
    const db = migratedDb()
    insertItem(db)
    db.exec("DELETE FROM works WHERE id = 'w-1';")
    const row = db.prepare('SELECT work_id FROM media_items WHERE id = ?').get('m-1')
    expect(row).toBeDefined()
    expect(row?.work_id).toBeNull()
  })

  it('beholder opptaket når opplasterens konto slettes', () => {
    const db = migratedDb()
    insertItem(db)
    db.exec("DELETE FROM user WHERE id = 'u-1';")
    const row = db.prepare('SELECT uploaded_by FROM media_items WHERE id = ?').get('m-1')
    expect(row).toBeDefined()
    expect(row?.uploaded_by).toBeNull()
  })

  it('seeder media.manage til admin og styret — og ingen andre', () => {
    const db = migratedDb()
    expect(permissionsOf(db, 'admin')).toContain('media.manage')
    expect(permissionsOf(db, 'board')).toContain('media.manage')
    expect(permissionsOf(db, 'member')).not.toContain('media.manage')
  })

  it('tar ikke fra noen en rettighet de hadde', () => {
    const db = migratedDb()
    expect(permissionsOf(db, 'board')).toEqual(['board.manage', 'media.manage'])
    expect(permissionsOf(db, 'member')).toEqual(['scores.view'])
  })

  it('kan kjøres om igjen uten å duplisere eller feile', () => {
    const db = migratedDb()
    // Bare datastegene: CREATE TABLE ville uansett feilet ved gjenkjøring, og
    // migrasjonsloggen i D1 hindrer det. Det er backfillen som må tåle det.
    db.exec("INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'media.manage' FROM roles WHERE id = 'admin';")
    db.exec("INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT id, 'media.manage' FROM roles WHERE id = 'board';")
    expect(permissionsOf(db, 'board')).toEqual(['board.manage', 'media.manage'])
  })

  it('går gjennom i en database uten roller — FK-trygg per konstruksjon', () => {
    // `INSERT OR IGNORE` dekker IKKE fremmednøkler; det er SELECT-en fra
    // `roles` som gjør at ingenting velges når rollen ikke finnes. En
    // VALUES-liste ville feilet her.
    const db = migratedDb('')
    expect(db.prepare('SELECT count(*) AS n FROM role_permissions').get()?.n).toBe(0)
  })
})
