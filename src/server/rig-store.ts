import { alias } from 'drizzle-orm/sqlite-core'
import { asc, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { assets, rigItems, user } from '../db/schema'
import type { RigScope } from '../lib/rigg'

/**
 * Leselaget for riggelista (#12).
 *
 * **Hvorfor egen modul:** `loadRigItems` er en LEVENDE eksport som rører `db`,
 * og den brukes av både `rigg.ts` (som rutene importerer for
 * serverfunksjonene) og `projects.ts` (som fyller prosjekt-dashboardet i én
 * runde). Ligger den i `rigg.ts`, holdes modulkroppen i live i klientbygget for
 * hver rute som importerer en riggefunksjon, og `cloudflare:workers` følger med
 * — samme grense som `board.ts`/`board-files.ts` trekker i AGENTS.md. Denne
 * filen importeres derfor ALDRI fra en rutekomponent.
 */

export type RigItemRow = {
  id: string
  assetId: string | null
  /** Navnet som skal vises: gjenstandens NÅVÆRENDE navn, ellers snapshotet. */
  name: string
  /** Gjenstanden finnes fortsatt i registeret — kun da skal navnet være en lenke. */
  assetExists: boolean
  responsibleUserId: string | null
  /** Fritekstgruppa («riggegruppa»). Null når en medlemsrad er valgt. */
  responsibleName: string | null
  /** Medlemmets navn slik det er i dag. Null når ansvarlig ikke er et medlem. */
  responsibleMemberName: string | null
  takenAt: number | null
  takenBy: string | null
  takenByName: string | null
  returnedAt: number | null
  returnedBy: string | null
  returnedByName: string | null
}

/**
 * Alle radene i én liste, med navn slått opp ferskt.
 *
 * Tre aliaser på `user` fordi tre ulike personer står på en rad: ansvarlig, den
 * som tok med, og den som meldte tilbake. Uten aliasene ville drizzle koblet
 * alle tre til den samme joinen og gitt samme navn tre steder.
 *
 * Gjenstandens navn vinner over snapshotet i `rig_items.name` — samme regel som
 * `responsible_name` i tidsplanen: databasen har navnet, raden har et minne om
 * det. Er gjenstanden slettet (`asset_id` er SET NULL og blir `null`), er
 * snapshotet det eneste som står igjen, og det er nettopp derfor det finnes.
 */
export async function loadRigItems(d: Db, scope: RigScope): Promise<RigItemRow[]> {
  const responsible = alias(user, 'rig_responsible')
  const takenUser = alias(user, 'rig_taken_by')
  const returnedUser = alias(user, 'rig_returned_by')

  const rows = await d
    .select({
      id: rigItems.id,
      assetId: rigItems.assetId,
      snapshotName: rigItems.name,
      assetName: assets.name,
      responsibleUserId: rigItems.responsibleUserId,
      responsibleName: rigItems.responsibleName,
      responsibleMemberName: responsible.name,
      takenAt: rigItems.takenAt,
      takenBy: rigItems.takenBy,
      takenByName: takenUser.name,
      returnedAt: rigItems.returnedAt,
      returnedBy: rigItems.returnedBy,
      returnedByName: returnedUser.name,
      createdAt: rigItems.createdAt,
    })
    .from(rigItems)
    .leftJoin(assets, eq(rigItems.assetId, assets.id))
    .leftJoin(responsible, eq(rigItems.responsibleUserId, responsible.id))
    .leftJoin(takenUser, eq(rigItems.takenBy, takenUser.id))
    .leftJoin(returnedUser, eq(rigItems.returnedBy, returnedUser.id))
    .where(
      scope.kind === 'project'
        ? eq(rigItems.projectId, scope.projectId)
        : eq(rigItems.occurrenceKey, scope.occurrenceKey),
    )
    .orderBy(asc(rigItems.createdAt))

  return rows.map((row) => ({
    id: row.id,
    assetId: row.assetId,
    name: row.assetName ?? row.snapshotName,
    assetExists: row.assetName !== null,
    responsibleUserId: row.responsibleUserId,
    responsibleName: row.responsibleName,
    responsibleMemberName: row.responsibleMemberName,
    takenAt: row.takenAt?.getTime() ?? null,
    takenBy: row.takenBy,
    takenByName: row.takenByName,
    returnedAt: row.returnedAt?.getTime() ?? null,
    returnedBy: row.returnedBy,
    returnedByName: row.returnedByName,
  }))
}

/** Én rad, med eierskapet (prosjekt/øving) — brukt av skrivefunksjonene. */
export async function loadRigItemScope(d: Db, id: string) {
  const row = (
    await d
      .select({
        id: rigItems.id,
        projectId: rigItems.projectId,
        occurrenceKey: rigItems.occurrenceKey,
        takenAt: rigItems.takenAt,
        takenBy: rigItems.takenBy,
        returnedAt: rigItems.returnedAt,
        returnedBy: rigItems.returnedBy,
      })
      .from(rigItems)
      .where(eq(rigItems.id, id))
      .limit(1)
  )[0]
  if (!row) throw new Error('Fant ikke linja i riggelista')
  return row
}
