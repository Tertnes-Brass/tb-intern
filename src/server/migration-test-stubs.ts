/**
 * Stubber for migrasjonstestene som kjører den SQUASHEDE runde-migrasjonen mot
 * ekte SQLite. Hver test definerer selv tabellene den seeder og bryr seg om;
 * disse `IF NOT EXISTS`-stubbene fyller inn de øvrige FK-målene og ALTER-
 * tabellene i `0017_backlog-runde-2.sql`, slik at hele migrasjonen kan kjøres
 * uten at hver test må gjenta hele skjemaet. Legges ETTER testens eget skjema,
 * så testens kolonner vinner.
 */
export const ROUND2_STUB_SCHEMA = `
  CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL DEFAULT '', is_system INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS role_permissions (
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    PRIMARY KEY (role_id, permission)
  );
  CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL DEFAULT '', is_published INTEGER NOT NULL DEFAULT 0, event_date TEXT);
  CREATE TABLE IF NOT EXISTS works (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS project_works (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, work_id)
  );
  CREATE TABLE IF NOT EXISTS parts (id TEXT PRIMARY KEY NOT NULL, name_no TEXT NOT NULL DEFAULT '', section TEXT);
  CREATE TABLE IF NOT EXISTS event_meta (occurrence_key TEXT PRIMARY KEY NOT NULL);
  CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY NOT NULL);
  CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    posts TEXT NOT NULL DEFAULT 'all',
    board_tasks TEXT NOT NULL DEFAULT 'all',
    mentions TEXT NOT NULL DEFAULT 'all'
  );
`
