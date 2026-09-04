import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Migrasjon `0017_solister-slagverk-ovingsstatus.sql` (#50, #34, #30) kjørt mot
 * ekte SQLite med `PRAGMA foreign_keys = ON` — altså slik D1 kjører den.
 *
 * Fire ting skal bevises her, og ingen av dem er synlige ved lesing av SQL-en:
 *
 * 1. **Migrasjonen er additiv.** Ingen tabell-rebuild, ingen stille sletting via
 *    fremmednøkler (se AGENTS.md om D1 og `DROP TABLE`). Eksisterende
 *    prosjektverk står urørt etterpå.
 * 2. **Den sammensatte fremmednøkkelen virker.** Solister (#50) og øvingsstatus
 *    (#30) peker på `project_works(project_id, work_id)`, ikke på verket. Tas
 *    stykket ut av programmet, skal begge forsvinne — ellers ville en solist
 *    blitt hengende igjen på et verk som ikke er i programmet lenger, og dukket
 *    opp igjen dagen stykket ble lagt inn på nytt.
 * 3. **Et menneske som forsvinner tar ikke programmet med seg.** `user_id` på en
 *    solist er SET NULL (raden består, som i tidsplanen), mens en øvingsstatus
 *    er CASCADE (den var personens egen ytring og skal ikke bli stående).
 * 4. **Instrumentlista overlever en besetningsendring.** `work_percussion.part_id`
 *    er SET NULL: slettes stemmen, står instrumentet igjen uten stemme i stedet
 *    for å forsvinne fra riggelista.
 */

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../../migrations/0017_solister-slagverk-ovingsstatus.sql', import.meta.url)),
  'utf8',
)

/** Tabellene slik de så ut FØR migrasjonen, med fremmednøklene som betyr noe. */
const SCHEMA_BEFORE = `
  CREATE TABLE user (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL
  );
  CREATE TABLE parts (
    id TEXT PRIMARY KEY NOT NULL,
    name_no TEXT NOT NULL,
    section TEXT NOT NULL
  );
  CREATE TABLE works (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL
  );
  CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL
  );
  CREATE TABLE project_works (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    note TEXT,
    percussion_setup TEXT,
    PRIMARY KEY (project_id, work_id)
  );
`

function migratedDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA_BEFORE)
  db.exec(`
    INSERT INTO user (id, name) VALUES ('u1', 'Ingrid'), ('u2', 'Karim');
    INSERT INTO parts (id, name_no, section) VALUES ('percussion-2', 'Slagverk 2', 'perc');
    INSERT INTO works (id, title) VALUES ('w1', 'Gaelforce'), ('w2', 'Napoli');
    INSERT INTO projects (id, name) VALUES ('p1', 'Julekonsert');
    INSERT INTO project_works (project_id, work_id, position, percussion_setup)
      VALUES ('p1', 'w1', 1, 'Timpani – Silje'), ('p1', 'w2', 2, NULL);
  `)
  for (const statement of MIGRATION.split('--> statement-breakpoint')) {
    const sql = statement.trim()
    if (sql) db.exec(sql)
  }
  return db
}

/** Fyller de tre nye tabellene med én rad hver på (p1, w1). */
function withRows(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO project_work_soloists (id, project_id, work_id, user_id, external_name, role, sort_order, created_at, updated_at)
      VALUES ('s1', 'p1', 'w1', 'u1', NULL, 'Kornettsolist', 1, 1000, 1000),
             ('s2', 'p1', 'w1', NULL, 'Kåre Vik', 'vikar', 2, 1000, 1000);
    INSERT INTO project_work_practice (project_id, work_id, user_id, status, comment, created_at, updated_at)
      VALUES ('p1', 'w1', 'u1', 'needs_help', 'takt 40', 1000, 1000),
             ('p1', 'w2', 'u2', 'practicing', NULL, 1000, 1000);
    INSERT INTO work_percussion (id, work_id, instrument, note, part_id, sort_order, created_at, updated_at)
      VALUES ('i1', 'w1', 'Pauker', 'må lånes', 'percussion-2', 1, 1000, 1000);
  `)
}

const count = (db: DatabaseSync, table: string): number =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n

describe('migrasjon 0017 (solister, slagverksinstrumenter, øvingsstatus)', () => {
  it('er additiv — eksisterende prosjektverk står urørt', () => {
    const db = migratedDb()
    expect(db.prepare('SELECT project_id, work_id, position, percussion_setup FROM project_works ORDER BY position').all()).toEqual([
      { project_id: 'p1', work_id: 'w1', position: 1, percussion_setup: 'Timpani – Silje' },
      { project_id: 'p1', work_id: 'w2', position: 2, percussion_setup: null },
    ])
    db.close()
  })

  it('oppretter kun de tre nye tabellene, uten å røre noe annet', () => {
    const db = migratedDb()
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map(
      (r) => r.name,
    )
    expect(names).toContain('project_work_soloists')
    expect(names).toContain('project_work_practice')
    expect(names).toContain('work_percussion')
    // En tabell-rebuild ville etterlatt et `__new_`-navn eller fjernet originalen.
    expect(names.filter((n) => n.startsWith('__new_'))).toEqual([])
    expect(names).toContain('project_works')
    db.close()
  })

  it('lar solist og øvingsstatus følge KOBLINGEN prosjekt↔verk', () => {
    const db = migratedDb()
    withRows(db)
    // Stykket tas ut av programmet — men blir liggende i arkivet.
    db.exec("DELETE FROM project_works WHERE project_id = 'p1' AND work_id = 'w1';")

    expect(count(db, 'project_work_soloists')).toBe(0)
    expect(
      (db.prepare('SELECT work_id FROM project_work_practice').all() as Array<{ work_id: string }>).map((r) => r.work_id),
    ).toEqual(['w2'])
    // Verket selv, og instrumentlista som følger det, er urørt.
    expect(count(db, 'works')).toBe(2)
    expect(count(db, 'work_percussion')).toBe(1)
    db.close()
  })

  it('rydder alt for prosjektet når prosjektet slettes', () => {
    const db = migratedDb()
    withRows(db)
    db.exec("DELETE FROM projects WHERE id = 'p1';")
    expect(count(db, 'project_works')).toBe(0)
    expect(count(db, 'project_work_soloists')).toBe(0)
    expect(count(db, 'project_work_practice')).toBe(0)
    // Instrumentlista hører til verket, ikke prosjektet.
    expect(count(db, 'work_percussion')).toBe(1)
    db.close()
  })

  it('lar solisten stå igjen uten medlemsreferanse når kontoen forsvinner', () => {
    const db = migratedDb()
    withRows(db)
    db.exec("DELETE FROM user WHERE id = 'u1';")

    const soloists = db.prepare('SELECT id, user_id, external_name FROM project_work_soloists ORDER BY sort_order').all()
    expect(soloists).toEqual([
      { id: 's1', user_id: null, external_name: null },
      { id: 's2', user_id: null, external_name: 'Kåre Vik' },
    ])
    // Øvingsstatusen var personens egen ytring og skal IKKE bli stående.
    expect(
      (db.prepare('SELECT user_id FROM project_work_practice').all() as Array<{ user_id: string }>).map((r) => r.user_id),
    ).toEqual(['u2'])
    db.close()
  })

  it('lar instrumentet stå igjen uten stemme når stemmen slettes', () => {
    const db = migratedDb()
    withRows(db)
    db.exec("DELETE FROM parts WHERE id = 'percussion-2';")
    expect(db.prepare('SELECT instrument, note, part_id FROM work_percussion').all()).toEqual([
      { instrument: 'Pauker', note: 'må lånes', part_id: null },
    ])
    db.close()
  })

  it('fjerner instrumentlista når verket slettes fra arkivet', () => {
    const db = migratedDb()
    withRows(db)
    db.exec("DELETE FROM works WHERE id = 'w1';")
    expect(count(db, 'work_percussion')).toBe(0)
    // Prosjektverket forsvant med verket, og dermed også solistene.
    expect(count(db, 'project_work_soloists')).toBe(0)
    db.close()
  })

  it('holder én status per medlem per prosjektverk', () => {
    const db = migratedDb()
    withRows(db)
    expect(() =>
      db.exec(`
        INSERT INTO project_work_practice (project_id, work_id, user_id, status, created_at, updated_at)
          VALUES ('p1', 'w1', 'u1', 'practicing', 2000, 2000);
      `),
    ).toThrow()
    db.close()
  })
})
