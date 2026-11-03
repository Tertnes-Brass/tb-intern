/**
 * Spørringer mot `stage_setups` som deles av `getProject` (prosjektsiden) og
 * `src/server/stage-setups.ts`. Ingen serverfunksjoner her — serverfunksjoner
 * kaller aldri hverandre — og ingen tilgangskontroll: den gjør kalleren.
 */
import { asc, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { stageSetups, user } from '../db/schema'

export type StageSetupSummary = {
  id: string
  title: string
  updatedAt: number
  updatedByName: string | null
}

export async function listStageSetupsForProject(d: Db, projectId: string): Promise<StageSetupSummary[]> {
  const rows = await d
    .select({
      id: stageSetups.id,
      title: stageSetups.title,
      updatedAt: stageSetups.updatedAt,
      updatedByName: user.name,
    })
    .from(stageSetups)
    .leftJoin(user, eq(user.id, stageSetups.updatedBy))
    .where(eq(stageSetups.projectId, projectId))
    .orderBy(asc(stageSetups.createdAt))
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.getTime() }))
}
