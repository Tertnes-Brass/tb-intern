import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, type Db } from '../db'
import { memberProfiles, projectWorkSoloists, projectWorks, user } from '../db/schema'
import { newId } from '../lib/id'
import {
  MAX_SOLOISTS_PER_WORK,
  SOLOIST_NAME_MAX,
  SOLOIST_ROLE_MAX,
  parseSoloistInput,
  type SoloistRow,
} from '../lib/soloists'
import { requirePermission } from './access'

/**
 * Solister på verk i et prosjekt (#50).
 *
 * **Skriving krever `projects.manage`.** Det er den som setter opp programmet
 * som vet hvem som spiller soloen — ikke solisten selv. Lesing er åpen for alle
 * som ser prosjektet, og skjer gjennom `getProject` (`src/server/projects.ts`),
 * som bruker `loadProjectSoloists` herfra. Serverfunksjoner kaller aldri andre
 * serverfunksjoner; de deler en vanlig funksjon, som `loadCalendar`.
 *
 * **Navnet lagres aldri som kopi for et medlem.** `user_id` er sannheten, og
 * navnet slås opp i `user` ved hver lesing — bytter Ingrid etternavn, står det
 * riktig i programmet uten at noen må rette det. Samme regel som ansvarlig i
 * tidsplanen og omtaler på veggen.
 */

/** Én solist slik prosjektsiden leser den. */
export type ProjectSoloist = SoloistRow & {
  workId: string
  sortOrder: number
}

/**
 * Solistene for hele programmet, gruppert per verk. Ett oppslag for prosjektet
 * i stedet for ett per verk: repertoaret er som regel 8–15 stykker, og en
 * spørring per rad ville vært femten rundturer for en liste som vises samlet.
 */
export async function loadProjectSoloists(d: Db, projectId: string): Promise<Record<string, ProjectSoloist[]>> {
  const rows = await d
    .select({
      id: projectWorkSoloists.id,
      workId: projectWorkSoloists.workId,
      userId: projectWorkSoloists.userId,
      externalName: projectWorkSoloists.externalName,
      role: projectWorkSoloists.role,
      sortOrder: projectWorkSoloists.sortOrder,
      memberName: user.name,
    })
    .from(projectWorkSoloists)
    .leftJoin(user, eq(projectWorkSoloists.userId, user.id))
    .where(eq(projectWorkSoloists.projectId, projectId))
    .orderBy(asc(projectWorkSoloists.sortOrder), asc(projectWorkSoloists.createdAt))

  const byWork: Record<string, ProjectSoloist[]> = {}
  for (const row of rows) {
    const list = byWork[row.workId] ?? []
    list.push(row)
    byWork[row.workId] = list
  }
  return byWork
}

const soloistFields = {
  // Takene her er romslige (×4); den EKTE kuttingen skjer i `parseSoloistInput`,
  // slik at skjemaet og serveren ikke kan ha hver sin mening om lengden.
  userId: z.string().max(64).nullish(),
  externalName: z.string().max(SOLOIST_NAME_MAX * 4).nullish(),
  role: z.string().max(SOLOIST_ROLE_MAX * 4).nullish(),
}

/**
 * Verket må faktisk stå i programmet. Uten sjekken ville et rått kall kunnet
 * lagt en solist på en (prosjekt, verk)-kombinasjon som ikke finnes — den
 * sammensatte fremmednøkkelen ville riktignok avvist det i D1, men feilmeldingen
 * ville vært en SQL-feil og ikke en setning et menneske kan lese.
 */
async function assertProjectWork(d: Db, projectId: string, workId: string): Promise<void> {
  const rows = await d
    .select({ workId: projectWorks.workId })
    .from(projectWorks)
    .where(and(eq(projectWorks.projectId, projectId), eq(projectWorks.workId, workId)))
    .limit(1)
  if (!rows[0]) throw new Error('Verket står ikke i dette programmet')
}

/**
 * En intern solist må være et AKTIVT medlem. Samme regel som «ansvarlig» i
 * tidsplanen: uten den kunne et rått kall pekt på en hvilken som helst
 * bruker-id — også en deaktivert konto — og navnet ville dukket opp i et
 * program hele korpset leser.
 */
async function assertActiveMember(d: Db, userId: string | null): Promise<void> {
  if (!userId) return
  const rows = await d
    .select({ isActive: memberProfiles.isActive })
    .from(memberProfiles)
    .where(eq(memberProfiles.authUserId, userId))
    .limit(1)
  if (!rows[0] || !rows[0].isActive) throw new Error('Ukjent eller deaktivert medlem')
}

export const addProjectSoloist = createServerFn({ method: 'POST' })
  .validator(z.object({ projectId: z.string(), workId: z.string(), ...soloistFields }))
  .handler(async ({ data }) => {
    const me = await requirePermission('projects.manage')
    const d = db()
    const value = parseSoloistInput(data)
    await assertProjectWork(d, data.projectId, data.workId)
    await assertActiveMember(d, value.userId)

    const existing = await d
      .select({ n: sql<number>`count(*)`, max: sql<number>`coalesce(max(sort_order), 0)` })
      .from(projectWorkSoloists)
      .where(
        and(eq(projectWorkSoloists.projectId, data.projectId), eq(projectWorkSoloists.workId, data.workId)),
      )
    if ((existing[0]?.n ?? 0) >= MAX_SOLOISTS_PER_WORK) {
      throw new Error(`Maks ${MAX_SOLOISTS_PER_WORK} solister per verk`)
    }

    const now = new Date()
    await d.insert(projectWorkSoloists).values({
      id: newId(),
      projectId: data.projectId,
      workId: data.workId,
      ...value,
      sortOrder: (existing[0]?.max ?? 0) + 1,
      createdBy: me.id,
      createdAt: now,
      updatedAt: now,
    })
    return { ok: true }
  })

/**
 * Hele raden skrives om — som tidsplanen. Skjemaet har tre felt, og en delvis
 * oppdatering ville krevd at «tømt felt» og «ikke sendt» kunne skilles for hvert
 * av dem.
 */
export const updateProjectSoloist = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), projectId: z.string(), ...soloistFields }))
  .handler(async ({ data }) => {
    await requirePermission('projects.manage')
    const d = db()
    const value = parseSoloistInput(data)
    await assertActiveMember(d, value.userId)
    // `projectId` står i WHERE, ikke bare i validatoren: id-en alene ville latt
    // et rått kall redigere en solist i et annet prosjekt.
    await d
      .update(projectWorkSoloists)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(projectWorkSoloists.id, data.id), eq(projectWorkSoloists.projectId, data.projectId)))
    return { ok: true }
  })

export const removeProjectSoloist = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), projectId: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission('projects.manage')
    await db()
      .delete(projectWorkSoloists)
      .where(and(eq(projectWorkSoloists.id, data.id), eq(projectWorkSoloists.projectId, data.projectId)))
    return { ok: true }
  })
