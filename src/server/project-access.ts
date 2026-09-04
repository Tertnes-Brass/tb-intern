import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { projects } from '../db/schema'
import { PROJECT_VISIBILITY_MESSAGES, isActiveProject, projectVisibility } from '../lib/project-access'
import { type Me, hasFullArchiveAccess, hasPermission } from './access'

/**
 * «Får denne brukeren se dette prosjektet?» — ÉTT sted.
 *
 * Regelen satt inline i `getProject` så lenge prosjektsiden var det eneste som
 * leste et prosjekt. Med sceneoppsettet (#11) og riggelista (#12) leses det nå
 * fra tre serverfunksjoner, og tre kopier av en tilgangsregel er måten den ene
 * som ble glemt blir hullet. Samme begrunnelse som `memberPermissionsByUser()`
 * i `access.ts` (docs/tilgangsstyring.md).
 *
 * Reglene, uendret fra #29:
 * - Upublisert: kun `projects.manage`.
 * - Publisert, men uten dato eller med dato som har passert: kun
 *   `projects.manage` eller fullt arkivinnsyn. Et gammelt prosjekt er
 *   arkivmateriale, ikke noe et vanlig medlem skal kunne bla i.
 *
 * Modulen har LEVENDE eksporter (den rører `db`-typen og `access.ts`) og skal
 * derfor aldri importeres fra en rutekomponent — bare fra `src/server/*.ts`.
 */
export type VisibleProject = {
  project: typeof projects.$inferSelect
  canManage: boolean
  /** Publisert og med en dato som ikke har passert — brukes til filtilgang. */
  inAccessibleProject: boolean
}

export async function loadVisibleProject(d: Db, projectId: string, me: Me): Promise<VisibleProject> {
  const project = (await d.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
  if (!project) throw new Error('Fant ikke prosjektet')

  const canManage = hasPermission(me, 'projects.manage')
  const today = new Date().toISOString().slice(0, 10)
  // Én regel for «ser du dette prosjektet?» — den rene `projectVisibility` i
  // src/lib/project-access.ts, delt med skrivestien for øvingsstatus (#30).
  const visibility = projectVisibility(
    project,
    { canManage, canBrowseArchive: hasFullArchiveAccess(me) },
    today,
  )
  if (visibility !== 'ok') throw new Error(PROJECT_VISIBILITY_MESSAGES[visibility])

  return {
    project,
    canManage,
    inAccessibleProject: isActiveProject(project, today),
  }
}
