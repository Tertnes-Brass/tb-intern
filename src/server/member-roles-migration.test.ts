import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { effectiveRoleIds, unionRolePermissions } from '../lib/roles'

/**
 * Migrasjon `0016_flere-roller-per-medlem.sql` (#48) kjørt mot ekte SQLite.
 *
 * Fire ting skal bevises her, og ingen av dem er synlige ved lesing:
 *
 * 1. **Migrasjonen er rent additiv.** Kun `CREATE TABLE`/`CREATE INDEX` og en
 *    `INSERT ... SELECT`. Ingen `DROP`, ingen `DELETE`, ingen `UPDATE`, ingen
 *    rebuild (`__new_`) — en rebuild ville i D1 cascadet til barnetabellene
 *    inne i transaksjonen, der `PRAGMA foreign_keys=OFF` er en no-op (AGENTS.md).
 * 2. **Backfillen er FK-trygg og fullstendig.** Hvert medlem og hver invitasjon
 *    får nøyaktig den rollen de hadde. «Migrert uten tap av tilgang» er
 *    akseptansekriteriet i #48, og det er denne setningen som bærer det.
 * 3. **De deprecated kolonnene står urørt.** Verdien i `member_profiles.role_id`
 *    skal være den samme før og etter.
 * 4. **Migrasjonen kan kjøres om igjen.** `INSERT OR IGNORE` betyr at en ny
 *    kjøring ikke dupliserer eller feiler.
 */

// #48 ble squashet inn i runde-migrasjonen sammen med #13, #14/#25 og
// #9/#10/#29 — testen kjører derfor HELE runde-migrasjonen, med de andre
// grenenes tabeller i før-skjemaet.
const MIGRATION = readFileSync(
  fileURLToPath(new URL('../../migrations/0016_backlog-runde-1.sql', import.meta.url)),
  'utf8',
)

/**
 * Migrasjonen uten kommentarlinjer. Kommentarene her NEVNER `DROP TABLE` og
 * `__new_` for å forklare hvorfor de ikke står i SQL-en — det er selve setningene
 * som skal granskes, ikke begrunnelsen for dem.
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
  CREATE TABLE member_profiles (
    auth_user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES roles(id),
    is_active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE invitations (
    email TEXT PRIMARY KEY NOT NULL,
    role_id TEXT NOT NULL REFERENCES roles(id),
    accepted_at INTEGER
  );
  -- Tabellene de andre squashede grenene rører (#13-FK-er, #9/#10-backfillen).
  CREATE TABLE parts (
    id TEXT PRIMARY KEY NOT NULL,
    name_no TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE event_meta (
    occurrence_key TEXT PRIMARY KEY NOT NULL,
    linked_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    created_by TEXT REFERENCES user(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL DEFAULT 0
  );
`

/** Et lite, men realistisk korps: fem roller, fire medlemmer, to invitasjoner. */
const DATA_BEFORE = `
  INSERT INTO roles (id, name, is_system) VALUES
    ('admin', 'Administrator', 1),
    ('board', 'Styremedlem', 1),
    ('conductor', 'Dirigent', 1),
    ('member', 'Musiker', 1);
  INSERT INTO role_permissions (role_id, permission) VALUES
    ('admin', '*'),
    ('board', 'scores.view'),
    ('board', 'board.manage'),
    ('board', 'posts.publish'),
    ('conductor', 'projects.manage'),
    ('member', 'scores.view');
  INSERT INTO user (id, name) VALUES
    ('u-admin', 'Sindre'),
    ('u-board', 'Hilde'),
    ('u-member', 'Ingrid'),
    ('u-conductor', 'Eirik');
  INSERT INTO member_profiles (auth_user_id, role_id) VALUES
    ('u-admin', 'admin'),
    ('u-board', 'board'),
    ('u-member', 'member'),
    ('u-conductor', 'conductor');
  INSERT INTO invitations (email, role_id, accepted_at) VALUES
    ('ny@example.com', 'member', NULL),
    ('gammel@example.com', 'board', 1000);
`

function applyMigration(db: DatabaseSync): void {
  for (const statement of MIGRATION.split('--> statement-breakpoint')) {
    const sql = statement.trim()
    if (sql) db.exec(sql)
  }
}

function migratedDb(seed = DATA_BEFORE): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  // Fremmednøkler PÅ: D1 håndhever dem, så en backfill som bryter en FK skal
  // feile her — ikke i produksjon.
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA_BEFORE)
  if (seed) db.exec(seed)
  applyMigration(db)
  return db
}

function rolesOf(db: DatabaseSync, userId: string): string[] {
  return db
    .prepare('SELECT role_id FROM member_roles WHERE auth_user_id = ? ORDER BY role_id')
    .all(userId)
    .map((row) => row.role_id as string)
}

describe('migrasjon 0016 (flere roller per medlem)', () => {
  it('er rent additiv — ingen DROP, DELETE, UPDATE eller tabell-rebuild', () => {
    expect(STATEMENTS).not.toMatch(/DROP TABLE/i)
    expect(STATEMENTS).not.toMatch(/DROP COLUMN/i)
    expect(STATEMENTS).not.toMatch(/__new_/)
    // Anker på linjestart: `ON DELETE cascade` inne i en fremmednøkkel er
    // nettopp det vi VIL ha, mens en `DELETE FROM` som setning er forbudt.
    expect(STATEMENTS).not.toMatch(/^\s*DELETE\b/im)
    expect(STATEMENTS).not.toMatch(/^\s*UPDATE\b/im)
    // Runde-migrasjonen har ALTER-e, men KUN `ADD` — aldri rebuild/drop.
    expect(STATEMENTS).not.toMatch(/ALTER TABLE(?!.*ADD)/i)
  })

  it('backfiller hvert medlem med nøyaktig rollen det hadde', () => {
    const db = migratedDb()
    expect(rolesOf(db, 'u-admin')).toEqual(['admin'])
    expect(rolesOf(db, 'u-board')).toEqual(['board'])
    expect(rolesOf(db, 'u-member')).toEqual(['member'])
    expect(rolesOf(db, 'u-conductor')).toEqual(['conductor'])
    expect(db.prepare('SELECT count(*) AS n FROM member_roles').get()).toEqual({ n: 4 })
    db.close()
  })

  it('backfiller invitasjoner — også de aksepterte, som rollematrisen fortsatt teller', () => {
    const db = migratedDb()
    expect(db.prepare('SELECT email, role_id FROM invitation_roles ORDER BY email').all()).toEqual([
      { email: 'gammel@example.com', role_id: 'board' },
      { email: 'ny@example.com', role_id: 'member' },
    ])
    db.close()
  })

  it('lar de deprecated kolonnene stå helt urørt', () => {
    const db = migratedDb()
    expect(db.prepare('SELECT auth_user_id, role_id FROM member_profiles ORDER BY auth_user_id').all()).toEqual([
      { auth_user_id: 'u-admin', role_id: 'admin' },
      { auth_user_id: 'u-board', role_id: 'board' },
      { auth_user_id: 'u-conductor', role_id: 'conductor' },
      { auth_user_id: 'u-member', role_id: 'member' },
    ])
    expect(db.prepare('SELECT email, role_id FROM invitations ORDER BY email').all()).toEqual([
      { email: 'gammel@example.com', role_id: 'board' },
      { email: 'ny@example.com', role_id: 'member' },
    ])
    db.close()
  })

  it('går gjennom i en tom database — INSERT ... SELECT velger ingenting i stedet for å bryte en FK', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON;')
    db.exec(SCHEMA_BEFORE)
    expect(() => applyMigration(db)).not.toThrow()
    expect(db.prepare('SELECT count(*) AS n FROM member_roles').get()).toEqual({ n: 0 })
    db.close()
  })

  it('kan kjøres om igjen uten å duplisere eller feile', () => {
    const db = migratedDb()
    // Andre kjøring: tabellene finnes allerede, så bare backfillen gjentas.
    for (const statement of MIGRATION.split('--> statement-breakpoint')) {
      const sql = statement.trim()
      if (sql.startsWith('INSERT')) db.exec(sql)
    }
    expect(db.prepare('SELECT count(*) AS n FROM member_roles').get()).toEqual({ n: 4 })
    db.close()
  })

  it('ingen mister en tilgang: rettighetene etter migrasjonen er de samme som før', () => {
    const db = migratedDb()
    const permissionsByRole = new Map<string, string[]>()
    for (const row of db.prepare('SELECT role_id, permission FROM role_permissions').all()) {
      const roleId = row.role_id as string
      permissionsByRole.set(roleId, [...(permissionsByRole.get(roleId) ?? []), row.permission as string])
    }
    for (const row of db.prepare('SELECT auth_user_id, role_id FROM member_profiles').all()) {
      const userId = row.auth_user_id as string
      const before = unionRolePermissions([row.role_id as string], permissionsByRole)
      const after = unionRolePermissions(effectiveRoleIds(rolesOf(db, userId), null), permissionsByRole)
      expect(after).toEqual(before)
    }
    db.close()
  })

  it('nekter å slette en rolle som fortsatt er i bruk — koblingsraden har ingen ON DELETE', () => {
    const db = migratedDb()
    // Uten dette ville en sletting i rollematrisen tatt medlemmenes tilganger
    // med seg i stillhet. `deleteRole` teller radene og stopper først; dette er
    // det siste nettet under.
    expect(() => db.exec("DELETE FROM roles WHERE id = 'board';")).toThrow()
    db.close()
  })

  it('rydder rollene når selve medlemmet eller invitasjonen forsvinner', () => {
    const db = migratedDb()
    db.exec("DELETE FROM member_profiles WHERE auth_user_id = 'u-board';")
    db.exec("DELETE FROM user WHERE id = 'u-board';")
    expect(rolesOf(db, 'u-board')).toEqual([])

    db.exec("DELETE FROM invitations WHERE email = 'ny@example.com';")
    expect(db.prepare('SELECT count(*) AS n FROM invitation_roles').get()).toEqual({ n: 1 })
    db.close()
  })

  it('gir et medlem flere roller etter migrasjonen — det er hele poenget', () => {
    const db = migratedDb()
    db.exec("INSERT INTO member_roles (auth_user_id, role_id) VALUES ('u-member', 'board');")
    expect(rolesOf(db, 'u-member')).toEqual(['board', 'member'])

    const permissionsByRole = new Map([
      ['board', ['scores.view', 'board.manage', 'posts.publish']],
      ['member', ['scores.view']],
    ])
    // Musikeren beholder `scores.view` og får styret på toppen (#48).
    expect(unionRolePermissions(rolesOf(db, 'u-member'), permissionsByRole)).toEqual([
      'board.manage',
      'posts.publish',
      'scores.view',
    ])
    db.close()
  })
})
