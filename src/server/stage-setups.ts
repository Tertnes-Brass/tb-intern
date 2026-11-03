import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, type Db } from '../db'
import { memberProfiles, projects, stageSetups, user } from '../db/schema'
import { newId } from '../lib/id'
import {
  EMPTY_STAGE_APP_STATE,
  STAGE_CONTACT_MAX,
  STAGE_NOTES_MAX,
  STAGE_PERMISSION,
  STAGE_TITLE_MAX,
  canReadStageSetups,
  normalizeStageContact,
  normalizeStageNotes,
  normalizeStageTitle,
  parseStageScene,
} from '../lib/stage-scene'
import { STAGE_SIZE_LIMITS, STAGE_TEMPLATE_IDS, buildStageTemplate } from '../lib/stage-templates'
import { type Me, hasFullArchiveAccess, hasPermission, requireMe, requirePermission } from './access'

/**
 * Sceneoppsett: tegninger av hvordan korpset og slagverket står, per prosjekt.
 *
 * **Lesing følger prosjektet.** Ser du prosjektsiden, ser du oppsettene
 * (`canReadStageSetups`, som bygger på samme `projectReadError` som
 * `getProject`). `stage.manage` kan i tillegg lese oppsett i tidligere
 * publiserte prosjekter, for å bruke dem som utgangspunkt.
 *
 * **Skriving krever `stage.manage`** — en egen rettighet, ikke
 * `projects.manage`, slik at en slagverksansvarlig kan tegne riggen uten å
 * kunne endre programmet eller publisere prosjektet.
 *
 * **Ingen stille overskriving.** Hver lagring oppgir revisjonen den bygger på,
 * og oppdateringen er en compare-and-set i SQL. Har noen andre lagret i
 * mellomtiden, får klienten `{ ok: false, conflict }` tilbake og må velge.
 *
 * Kun serverfunksjoner og typer eksporteres herfra (se `event-meta.ts` for
 * hvorfor).
 */

const NOT_FOUND = 'Fant ikke sceneoppsettet'

function readerFor(me: Me) {
  return {
    canManageProjects: hasPermission(me, 'projects.manage'),
    canBrowseArchive: hasFullArchiveAccess(me),
    canManageStage: hasPermission(me, STAGE_PERMISSION),
  }
}

const today = () => new Date().toISOString().slice(0, 10)

async function loadSetup(d: Db, id: string) {
  const rows = await d
    .select({
      setup: stageSetups,
      project: {
        id: projects.id,
        name: projects.name,
        kind: projects.kind,
        eventDate: projects.eventDate,
        venue: projects.venue,
        isPublished: projects.isPublished,
      },
      updatedByName: user.name,
    })
    .from(stageSetups)
    .innerJoin(projects, eq(projects.id, stageSetups.projectId))
    .leftJoin(user, eq(user.id, stageSetups.updatedBy))
    .where(eq(stageSetups.id, id))
    .limit(1)
  return rows[0] ?? null
}

/** Henter oppsettet og avviser likt om det ikke finnes eller ikke kan leses. */
async function readableSetup(d: Db, me: Me, id: string) {
  const row = await loadSetup(d, id)
  if (!row || !canReadStageSetups(row.project, readerFor(me), today())) throw new Error(NOT_FOUND)
  return row
}

const idSchema = z.string().min(1).max(64)

/** Den innloggede som kontaktperson: navn, e-post og telefon fra profilen. */
async function contactFor(d: Db, me: Me) {
  const profile = (
    await d.select({ phone: memberProfiles.phone }).from(memberProfiles).where(eq(memberProfiles.authUserId, me.id)).limit(1)
  )[0]
  return { name: me.name, email: me.email, phone: profile?.phone ?? '' }
}

export const getStageSetup = createServerFn()
  .validator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    const d = db()
    const row = await readableSetup(d, me, data.id)
    const canEdit = hasPermission(me, STAGE_PERMISSION)
    return {
      setup: {
        id: row.setup.id,
        title: row.setup.title,
        notes: row.setup.notes,
        contact: {
          name: row.setup.contactName ?? '',
          email: row.setup.contactEmail ?? '',
          phone: row.setup.contactPhone ?? '',
        },
        revision: row.setup.revision,
        updatedAt: row.setup.updatedAt.getTime(),
        updatedByName: row.updatedByName,
        // Som tekst: tegningen er Excalidraw sitt format (vilkårlige felt), og
        // editoren tolker den selv. Sparer også serialiseringen av et stort objekt.
        sceneJson: row.setup.scene,
      },
      project: {
        id: row.project.id,
        name: row.project.name,
        kind: row.project.kind,
        eventDate: row.project.eventDate,
        venue: row.project.venue,
      },
      canEdit,
      // Til «Bruk meg» i kontaktfeltene. Bare ens egne opplysninger.
      myContact: canEdit ? await contactFor(d, me) : null,
    }
  })

export type StageSetupDetail = Awaited<ReturnType<typeof getStageSetup>>

const sourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('template'),
    template: z.enum(STAGE_TEMPLATE_IDS),
    width: z.number().min(STAGE_SIZE_LIMITS.min).max(STAGE_SIZE_LIMITS.max).optional(),
    depth: z.number().min(STAGE_SIZE_LIMITS.min).max(STAGE_SIZE_LIMITS.max).optional(),
  }),
  z.object({ type: z.literal('copy'), setupId: idSchema }),
])

export const createStageSetup = createServerFn({ method: 'POST' })
  .validator(z.object({ projectId: idSchema, title: z.string().max(STAGE_TITLE_MAX * 2), source: sourceSchema }))
  .handler(async ({ data }) => {
    const me = await requirePermission(STAGE_PERMISSION)
    const d = db()
    const project = (
      await d
        .select({ id: projects.id, isPublished: projects.isPublished, eventDate: projects.eventDate })
        .from(projects)
        .where(eq(projects.id, data.projectId))
        .limit(1)
    )[0]
    if (!project || !canReadStageSetups(project, readerFor(me), today())) throw new Error('Fant ikke prosjektet')

    const title = normalizeStageTitle(data.title)
    let scene: unknown
    let notes: string | null = null
    if (data.source.type === 'template') {
      scene = {
        elements: buildStageTemplate(data.source.template, { width: data.source.width, depth: data.source.depth }),
        appState: EMPTY_STAGE_APP_STATE,
      }
    } else {
      const source = await readableSetup(d, me, data.source.setupId)
      scene = JSON.parse(source.setup.scene)
      notes = source.setup.notes
    }

    const id = newId()
    const now = new Date()
    await d.insert(stageSetups).values({
      id,
      projectId: project.id,
      title,
      notes,
      // Den som lager oppsettet, er som regel den arrangøren skal snakke med —
      // også når tegningen er kopiert fra et annet prosjekt.
      ...normalizeStageContact(await contactFor(d, me)),
      // Også malene går gjennom valideringen: det som lagres, er alltid noe
      // `saveStageSetup` selv ville godtatt.
      scene: JSON.stringify(parseStageScene(scene)),
      revision: 1,
      createdBy: me.id,
      updatedBy: me.id,
      createdAt: now,
      updatedAt: now,
    })
    return { id }
  })

export const saveStageSetup = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: idSchema,
      expectedRevision: z.number().int().min(0),
      title: z.string().max(STAGE_TITLE_MAX * 2).optional(),
      notes: z.string().max(STAGE_NOTES_MAX * 2).nullable().optional(),
      contact: z
        .object({
          name: z.string().max(STAGE_CONTACT_MAX.name * 2),
          email: z.string().max(STAGE_CONTACT_MAX.email * 2),
          phone: z.string().max(STAGE_CONTACT_MAX.phone * 2),
        })
        .optional(),
      scene: z.unknown().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requirePermission(STAGE_PERMISSION)
    const d = db()
    await readableSetup(d, me, data.id)

    const values: Partial<typeof stageSetups.$inferInsert> = { updatedAt: new Date(), updatedBy: me.id }
    if (data.title !== undefined) values.title = normalizeStageTitle(data.title)
    if (data.notes !== undefined) values.notes = normalizeStageNotes(data.notes)
    if (data.contact !== undefined) Object.assign(values, normalizeStageContact(data.contact))
    if (data.scene !== undefined) values.scene = JSON.stringify(parseStageScene(data.scene))

    const saved = await d
      .update(stageSetups)
      .set({ ...values, revision: sql`${stageSetups.revision} + 1` })
      .where(and(eq(stageSetups.id, data.id), eq(stageSetups.revision, data.expectedRevision)))
      .returning({ revision: stageSetups.revision, updatedAt: stageSetups.updatedAt })

    if (saved[0]) return { ok: true as const, revision: saved[0].revision, updatedAt: saved[0].updatedAt.getTime() }

    // Noen andre lagret først. Si hvem, så valget blir et informert valg.
    const current = await loadSetup(d, data.id)
    if (!current) throw new Error(NOT_FOUND)
    return {
      ok: false as const,
      conflict: {
        revision: current.setup.revision,
        updatedAt: current.setup.updatedAt.getTime(),
        updatedByName: current.updatedByName,
      },
    }
  })

export type SaveStageSetupResult = Awaited<ReturnType<typeof saveStageSetup>>

export const deleteStageSetup = createServerFn({ method: 'POST' })
  .validator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const me = await requirePermission(STAGE_PERMISSION)
    const d = db()
    const row = await readableSetup(d, me, data.id)
    await d.delete(stageSetups).where(eq(stageSetups.id, data.id))
    return { projectId: row.project.id }
  })

/**
 * Oppsett som kan brukes som utgangspunkt for et nytt — de nyeste først, og
 * bare de denne brukeren kan lese.
 */
export const listStageSetupSources = createServerFn().handler(async () => {
  const me = await requirePermission(STAGE_PERMISSION)
  const rows = await db()
    .select({
      id: stageSetups.id,
      title: stageSetups.title,
      projectId: projects.id,
      projectName: projects.name,
      eventDate: projects.eventDate,
      isPublished: projects.isPublished,
    })
    .from(stageSetups)
    .innerJoin(projects, eq(projects.id, stageSetups.projectId))
    .orderBy(desc(projects.eventDate), desc(stageSetups.createdAt))
    .limit(300)
  const reader = readerFor(me)
  const day = today()
  return rows
    .filter((r) => canReadStageSetups(r, reader, day))
    .slice(0, 80)
    .map(({ id, title, projectId, projectName, eventDate }) => ({ id, title, projectId, projectName, eventDate }))
})
