/**
 * Automatisk backup av databasen til R2.
 *
 * Hele D1-en dumpes som en SQLite-kompatibel SQL-fil (samme format som
 * `wrangler d1 export` / `sqlite3 .dump`) og skrives til R2 under `backups/`.
 * Dumpen er selvstendig: den bruker kun `DB`- og `FILES`-bindingene, ingen
 * ekstra secrets eller eksterne API-er, og kan derfor kjøres trygt fra cron.
 *
 * Off-site-kopi (R2 → Backblaze B2 / lokal disk) og restore-test ligger som
 * scripts i `scripts/` — se README. En backup som ikke er testet er et håp.
 */
import { env } from 'cloudflare:workers'

/** R2-prefiks der SQL-dumpene lagres. */
export const BACKUP_PREFIX = 'backups/'

/**
 * Antall dumper som beholdes. Cron-en kjører ukentlig, så 8 dumper ≈ 8 uker.
 * Manuelle kjøringer kan rotere ut eldre dumper tidligere.
 */
export const KEEP_BACKUPS = 8

// SQLite/D1-interne tabeller som aldri skal med i dumpen. Brukertabeller og
// `d1_migrations` (migreringsloggen) tas med, slik at en gjenoppretting til en
// fersk database også får riktig migreringsstatus.
const INTERNAL_TABLES = new Set([
  'sqlite_sequence',
  'sqlite_stat1',
  'sqlite_stat4',
  '_cf_KV',
  '_cf_METADATA',
])

// Antall rader som hentes per spørring. Holder minnebruken bundet selv om
// arkivet vokser.
const PAGE_SIZE = 500

interface SchemaObject {
  type: 'table' | 'index' | 'trigger' | 'view'
  name: string
  tbl_name: string
  sql: string | null
}

export interface BackupResult {
  /** R2-nøkkelen dumpen ble skrevet til. */
  key: string
  /** Størrelsen på dumpen i bytes. */
  size: number
  /** Antall tabeller som ble dumpet. */
  tables: number
  /** Totalt antall rader som ble dumpet. */
  rows: number
  /** R2-nøkler som ble slettet av rotasjonen. */
  pruned: string[]
  /** ISO-tidsstempel for når dumpen ble laget. */
  generatedAt: string
}

/** Dobbeltfnutt-siter en identifikator (tabell-/kolonnenavn). */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** Serialiser en kolonneverdi til en SQL-literal. */
function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (value instanceof ArrayBuffer) return blobLiteral(new Uint8Array(value))
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView
    return blobLiteral(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
  }
  // D1 kan returnere BLOB som number[].
  if (Array.isArray(value)) return blobLiteral(Uint8Array.from(value as number[]))
  return `'${String(value).replace(/'/g, "''")}'`
}

function blobLiteral(bytes: Uint8Array): string {
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return `X'${hex}'`
}

/** Hent alle rader i én tabell og legg INSERT-setninger på `out`. */
async function appendTableRows(d1: D1Database, table: string, out: string[]): Promise<number> {
  const ident = quoteIdent(table)
  let offset = 0
  let total = 0
  for (;;) {
    const [columns, ...rows] = await d1
      .prepare(`SELECT * FROM ${ident} LIMIT ${PAGE_SIZE} OFFSET ${offset}`)
      .raw<unknown[]>({ columnNames: true })
    if (rows.length === 0) break
    const colList = columns.map(quoteIdent).join(',')
    for (const row of rows) {
      out.push(`INSERT INTO ${ident}(${colList}) VALUES(${row.map(sqlLiteral).join(',')});`)
    }
    total += rows.length
    if (rows.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return total
}

/**
 * Produser en komplett SQL-dump av databasen (skjema + data).
 * Returneres som tekst pluss litt statistikk.
 */
export async function dumpDatabaseToSql(
  d1: D1Database = env.DB,
): Promise<{ sql: string; tables: number; rows: number }> {
  const master = await d1
    .prepare(
      `SELECT type, name, tbl_name, sql FROM sqlite_master
       WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
       ORDER BY
         CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 ELSE 3 END,
         name`,
    )
    .all<SchemaObject>()

  const objects = master.results.filter((o) => !INTERNAL_TABLES.has(o.name))
  const tables = objects.filter((o) => o.type === 'table')
  const rest = objects.filter((o) => o.type !== 'table')

  const out: string[] = [
    `-- tb-notearkiv D1-dump — ${new Date().toISOString()}`,
    'PRAGMA foreign_keys=OFF;',
    'BEGIN TRANSACTION;',
  ]

  let rows = 0
  for (const table of tables) {
    out.push(`${(table.sql ?? '').trim()};`)
    rows += await appendTableRows(d1, table.name, out)
  }
  // Indekser, triggere og views legges sist (etter at data er på plass).
  for (const obj of rest) {
    out.push(`${(obj.sql ?? '').trim()};`)
  }
  out.push('COMMIT;')

  return { sql: out.join('\n') + '\n', tables: tables.length, rows }
}

/** R2-nøkkel for en dump tatt på `now`, f.eks. `backups/tb-notearkiv-2026-06-21T0400Z.sql`. */
function backupKey(now: Date): string {
  const iso = now.toISOString() // 2026-06-21T04:00:00.000Z
  const stamp = `${iso.slice(0, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}Z`
  return `${BACKUP_PREFIX}tb-notearkiv-${stamp}.sql`
}

/**
 * Slett de eldste dumpene slik at maks `keep` blir igjen. Nøklene inneholder et
 * ISO-tidsstempel, så leksikografisk sortering = kronologisk rekkefølge.
 */
export async function pruneOldBackups(keep: number = KEEP_BACKUPS): Promise<string[]> {
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const listed = await env.FILES.list({ prefix: BACKUP_PREFIX, cursor })
    for (const o of listed.objects) {
      if (o.key.endsWith('.sql')) keys.push(o.key)
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)

  keys.sort() // eldst først
  const excess = keys.slice(0, Math.max(0, keys.length - keep))
  if (excess.length > 0) await env.FILES.delete(excess)
  return excess
}

/** Dump databasen, skriv den til R2 og roter ut gamle dumper. */
export async function runBackup(now: Date = new Date()): Promise<BackupResult> {
  const { sql, tables, rows } = await dumpDatabaseToSql(env.DB)
  const key = backupKey(now)
  const generatedAt = now.toISOString()
  const body = new TextEncoder().encode(sql)

  await env.FILES.put(key, body, {
    httpMetadata: { contentType: 'application/sql; charset=utf-8' },
    customMetadata: { generatedAt, tables: String(tables), rows: String(rows) },
  })

  const pruned = await pruneOldBackups()
  return { key, size: body.byteLength, tables, rows, pruned, generatedAt }
}

/**
 * Innpakning for cron / `scheduled()`: kjører backup-en, logger resultatet til
 * Workers-observability, og lar feil boble opp slik at kjøringen markeres som
 * mislykket (synlig i dashbordet).
 */
export async function runScheduledBackup(controller?: ScheduledController): Promise<void> {
  const startedAt = Date.now()
  try {
    const result = await runBackup()
    console.log(
      `[backup] OK trigger=${controller?.cron ?? 'manuell'} key=${result.key} ` +
        `tabeller=${result.tables} rader=${result.rows} bytes=${result.size} ` +
        `rotert_ut=${result.pruned.length} (${Date.now() - startedAt}ms)`,
    )
  } catch (err) {
    console.error('[backup] FEILET:', err)
    throw err
  }
}
