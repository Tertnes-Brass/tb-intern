import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Migrasjon `0011_merge-styremedlem-role.sql` (#78) kjørt mot ekte SQLite.
 *
 * Testen leser migrasjonsfilen slik den ligger på disk — det er den samme
 * teksten wrangler sender til D1 — og speiler prod-tilstanden verifisert
 * 1. september 2026: systemrollen `board` med sine rettigheter, den gamle
 * brukeropprettede rollen `styremedlem` uten medlemmer, men med tre aksepterte
 * invitasjoner og `archive.viewAll`.
 *
 * `PRAGMA foreign_keys = ON` er poenget med å bruke en ekte database:
 * `invitations.role_id` og `member_profiles.role_id` peker på `roles` uten
 * `ON DELETE`, så en migrasjon som sletter rollen for tidlig skal feile her.
 */

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../../migrations/0011_merge-styremedlem-role.sql', import.meta.url)),
  'utf8',
)

/** Bare tabellene migrasjonen rører, med de fremmednøklene som gjør den farlig. */
const SCHEMA = `
  CREATE TABLE roles (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    is_system INTEGER DEFAULT 1 NOT NULL
  );
  CREATE TABLE role_permissions (
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    PRIMARY KEY (role_id, permission)
  );
  CREATE TABLE member_profiles (
    auth_user_id TEXT PRIMARY KEY NOT NULL,
    role_id TEXT NOT NULL REFERENCES roles(id),
    is_active INTEGER DEFAULT 1 NOT NULL
  );
  CREATE TABLE invitations (
    email TEXT PRIMARY KEY NOT NULL,
    role_id TEXT NOT NULL REFERENCES roles(id),
    accepted_at INTEGER
  );
`

const BOARD_PERMISSIONS = [
  'board.manage',
  'downloads.view',
  'members.manage',
  'posts.publish',
  'projects.manage',
  'scores.view',
  'shares.manage',
]

const OLD_ROLE_PERMISSIONS = [
  'archive.viewAll',
  'downloads.view',
  'members.manage',
  'projects.manage',
  'scores.view',
  'shares.manage',
]

/** Samme oppdeling som drizzle/wrangler gjør før setningene sendes til D1. */
function runMigration(database: DatabaseSync): void {
  for (const statement of MIGRATION.split('--> statement-breakpoint')) {
    if (statement.trim()) database.exec(statement)
  }
}

function createDb(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON')
  database.exec(SCHEMA)
  return database
}

/** Prod slik den faktisk så ut: to roller med samme navn, ulike rettigheter. */
function seedCollision(database: DatabaseSync): DatabaseSync {
  database.exec(`
    INSERT INTO roles (id, name, is_system) VALUES
      ('board', 'Styremedlem', 1),
      ('styremedlem', 'Styremedlem', 0),
      ('member', 'Musiker', 1);
  `)
  for (const permission of BOARD_PERMISSIONS) {
    database.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)').run('board', permission)
  }
  for (const permission of OLD_ROLE_PERMISSIONS) {
    database.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)').run('styremedlem', permission)
  }
  database.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)').run('member', 'scores.view')
  // Tre aksepterte invitasjoner peker på den gamle rollen — grunnen til at
  // `deleteRole` ikke slipper den gjennom i /innstillinger.
  for (const email of ['kim@example.test', 'hilde@example.test', 'per@example.test']) {
    database
      .prepare('INSERT INTO invitations (email, role_id, accepted_at) VALUES (?, ?, ?)')
      .run(email, 'styremedlem', 1_756_000_000_000)
  }
  database.prepare('INSERT INTO invitations (email, role_id, accepted_at) VALUES (?, ?, ?)').run(
    'musiker@example.test',
    'member',
    1_756_000_000_000,
  )
  return database
}

function roleIds(database: DatabaseSync): string[] {
  return database.prepare('SELECT id FROM roles ORDER BY id').all().map((row) => row.id as string)
}

function permissionsOf(database: DatabaseSync, roleId: string): string[] {
  return database
    .prepare('SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission')
    .all(roleId)
    .map((row) => row.permission as string)
}

function invitationRoles(database: DatabaseSync): Record<string, string> {
  return Object.fromEntries(
    database
      .prepare('SELECT email, role_id FROM invitations ORDER BY email')
      .all()
      .map((row) => [row.email as string, row.role_id as string]),
  )
}

describe('0011_merge-styremedlem-role', () => {
  it('flytter invitasjonene fra den gamle rollen til systemrollen', () => {
    const database = seedCollision(createDb())
    runMigration(database)

    expect(invitationRoles(database)).toEqual({
      'kim@example.test': 'board',
      'hilde@example.test': 'board',
      'per@example.test': 'board',
      // Andre roller røres ikke.
      'musiker@example.test': 'member',
    })
    database.close()
  })

  it('gir board rettighetene den gamle rollen hadde — arkivinnsynet går ikke tapt', () => {
    const database = seedCollision(createDb())
    runMigration(database)

    expect(permissionsOf(database, 'board')).toContain('archive.viewAll')
    // Alt board hadde fra før er i behold, og ingenting annet er lagt til.
    expect(permissionsOf(database, 'board')).toEqual([...BOARD_PERMISSIONS, 'archive.viewAll'].sort())
    expect(permissionsOf(database, 'member')).toEqual(['scores.view'])
    database.close()
  })

  it('fjerner den gamle rollen og rettighetene dens', () => {
    const database = seedCollision(createDb())
    runMigration(database)

    expect(roleIds(database)).toEqual(['board', 'member'])
    expect(permissionsOf(database, 'styremedlem')).toEqual([])
    database.close()
  })

  it('flytter også medlemmer, om noen fortsatt peker på den gamle rollen', () => {
    const database = seedCollision(createDb())
    database.exec("INSERT INTO member_profiles (auth_user_id, role_id) VALUES ('u1', 'styremedlem'), ('u2', 'member')")
    runMigration(database)

    const rows = database.prepare('SELECT auth_user_id, role_id, is_active FROM member_profiles ORDER BY auth_user_id').all()
    expect(rows).toEqual([
      { auth_user_id: 'u1', role_id: 'board', is_active: 1 },
      { auth_user_id: 'u2', role_id: 'member', is_active: 1 },
    ])
    expect(roleIds(database)).toEqual(['board', 'member'])
    database.close()
  })

  it('er idempotent — kjøring nummer to endrer ingenting', () => {
    const database = seedCollision(createDb())
    runMigration(database)
    const after = {
      roles: roleIds(database),
      board: permissionsOf(database, 'board'),
      invitations: invitationRoles(database),
    }

    runMigration(database)

    expect({
      roles: roleIds(database),
      board: permissionsOf(database, 'board'),
      invitations: invitationRoles(database),
    }).toEqual(after)
    database.close()
  })

  it('er en no-op i en database uten kollisjonen', () => {
    const database = createDb()
    database.exec("INSERT INTO roles (id, name, is_system) VALUES ('board', 'Styremedlem', 1), ('member', 'Musiker', 1)")
    database.exec("INSERT INTO role_permissions (role_id, permission) VALUES ('board', 'scores.view')")
    runMigration(database)

    expect(roleIds(database)).toEqual(['board', 'member'])
    expect(permissionsOf(database, 'board')).toEqual(['scores.view'])
    database.close()
  })

  it('rører ikke en systemrolle som tilfeldigvis har ID-en styremedlem', () => {
    const database = createDb()
    database.exec("INSERT INTO roles (id, name, is_system) VALUES ('styremedlem', 'Styremedlem', 1)")
    database.exec("INSERT INTO role_permissions (role_id, permission) VALUES ('styremedlem', 'scores.view')")
    runMigration(database)

    expect(roleIds(database)).toEqual(['styremedlem'])
    expect(permissionsOf(database, 'styremedlem')).toEqual(['scores.view'])
    database.close()
  })
})
