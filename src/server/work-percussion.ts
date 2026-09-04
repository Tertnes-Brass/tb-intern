import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, type Db } from '../db'
import { parts, projectWorks, workPercussion, works } from '../db/schema'
import { newId } from '../lib/id'
import {
  MAX_PERCUSSION_ITEMS_PER_WORK,
  PERCUSSION_INSTRUMENT_MAX,
  PERCUSSION_ITEM_NOTE_MAX,
  aggregatePercussionNeeds,
  isPercussionPart,
  parsePercussionItemInput,
  type PercussionNeed,
} from '../lib/work-percussion'
import { requirePermission } from './access'

/**
 * Slagverksinstrumenter per verk (#34).
 *
 * **Skriving krever `works.manage`** — lista hører til verket i arkivet, og det
 * er arkivaren/staben som katalogiserer. **Lesing følger verket:** på verksiden
 * gjennom `getWork` (`src/server/works.ts`), og på prosjektsiden gjennom
 * `getProject`, som slår instrumentlistene til hele repertoaret sammen til én
 * riggeliste. Begge bruker de vanlige funksjonene her; serverfunksjoner kaller
 * aldri andre serverfunksjoner.
 *
 * **Lesingen er ikke gated på slagverksstemme.** `showPercussionFor` i
 * `src/lib/percussion.ts` skjuler *fordelingen* på «Mine noter» for dem som
 * ikke er slagverkere, og det er en STØYregel — ikke en hemmelighetsregel. Her
 * er svaret det motsatte: en riggeliste skal kunne leses av alle som er med og
 * bærer, og av den som skal låne en marimba.
 */

export type WorkPercussionRow = {
  id: string
  instrument: string
  note: string | null
  partId: string | null
  /** Stemmenavnet slik det står i besetningen i dag. Aldri lagret som kopi. */
  partName: string | null
  sortOrder: number
}

/** Instrumentlista for ETT verk, i innleggingsrekkefølge. */
export async function loadWorkPercussion(d: Db, workId: string): Promise<WorkPercussionRow[]> {
  return d
    .select({
      id: workPercussion.id,
      instrument: workPercussion.instrument,
      note: workPercussion.note,
      partId: workPercussion.partId,
      partName: parts.nameNo,
      sortOrder: workPercussion.sortOrder,
    })
    .from(workPercussion)
    .leftJoin(parts, eq(workPercussion.partId, parts.id))
    .where(eq(workPercussion.workId, workId))
    .orderBy(asc(workPercussion.sortOrder), asc(workPercussion.createdAt))
}

/**
 * Det samlede slagverksbehovet for ETT prosjekt: hvert instrument én gang, med
 * verkene det trengs i. Selve sammenslåingen er ren og testet
 * (`aggregatePercussionNeeds`) — her gjør vi bare oppslaget.
 */
export async function loadProjectPercussionNeeds(d: Db, projectId: string): Promise<PercussionNeed[]> {
  const rows = await d
    .select({
      workId: workPercussion.workId,
      workTitle: works.title,
      position: projectWorks.position,
      instrument: workPercussion.instrument,
      note: workPercussion.note,
      partName: parts.nameNo,
    })
    .from(projectWorks)
    .innerJoin(workPercussion, eq(workPercussion.workId, projectWorks.workId))
    .innerJoin(works, eq(projectWorks.workId, works.id))
    .leftJoin(parts, eq(workPercussion.partId, parts.id))
    .where(eq(projectWorks.projectId, projectId))

  return aggregatePercussionNeeds(rows)
}

const percussionFields = {
  instrument: z.string().max(PERCUSSION_INSTRUMENT_MAX * 4),
  note: z.string().max(PERCUSSION_ITEM_NOTE_MAX * 4).nullish(),
  partId: z.string().max(64).nullish(),
}

/**
 * Stemmen må finnes OG være en slagverksstemme. En instrumentlinje merket
 * «2. kornett» ville vært meningsløs i riggelista, og et rått kall skal ikke
 * kunne skrive den. Sjekken leser `parts` ferskt — ikke klientens ord.
 */
async function assertPercussionPart(d: Db, partId: string | null): Promise<void> {
  if (!partId) return
  const rows = await d.select({ section: parts.section }).from(parts).where(eq(parts.id, partId)).limit(1)
  if (!isPercussionPart(rows[0])) throw new Error('Velg en slagverksstemme')
}

async function assertWorkExists(d: Db, workId: string): Promise<void> {
  const rows = await d.select({ id: works.id }).from(works).where(eq(works.id, workId)).limit(1)
  if (!rows[0]) throw new Error('Fant ikke verket')
}

export const addWorkPercussion = createServerFn({ method: 'POST' })
  .validator(z.object({ workId: z.string(), ...percussionFields }))
  .handler(async ({ data }) => {
    const me = await requirePermission('works.manage')
    const d = db()
    const value = parsePercussionItemInput(data)
    await assertWorkExists(d, data.workId)
    await assertPercussionPart(d, value.partId)

    const existing = await d
      .select({ n: sql<number>`count(*)`, max: sql<number>`coalesce(max(sort_order), 0)` })
      .from(workPercussion)
      .where(eq(workPercussion.workId, data.workId))
    if ((existing[0]?.n ?? 0) >= MAX_PERCUSSION_ITEMS_PER_WORK) {
      throw new Error(`Maks ${MAX_PERCUSSION_ITEMS_PER_WORK} instrumenter per verk`)
    }

    const now = new Date()
    await d.insert(workPercussion).values({
      id: newId(),
      workId: data.workId,
      ...value,
      sortOrder: (existing[0]?.max ?? 0) + 1,
      createdBy: me.id,
      createdAt: now,
      updatedAt: now,
    })
    return { ok: true }
  })

export const updateWorkPercussion = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), workId: z.string(), ...percussionFields }))
  .handler(async ({ data }) => {
    await requirePermission('works.manage')
    const d = db()
    const value = parsePercussionItemInput(data)
    await assertPercussionPart(d, value.partId)
    // `workId` i WHERE: id-en alene ville latt et rått kall redigere en linje
    // på et annet verk.
    await d
      .update(workPercussion)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(workPercussion.id, data.id), eq(workPercussion.workId, data.workId)))
    return { ok: true }
  })

export const removeWorkPercussion = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), workId: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission('works.manage')
    await db()
      .delete(workPercussion)
      .where(and(eq(workPercussion.id, data.id), eq(workPercussion.workId, data.workId)))
    return { ok: true }
  })
