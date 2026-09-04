/**
 * Hvem som får se ett prosjekt. Regelen lå inline i `getProject`, og ble hentet
 * ut hit da øvingsstatusen (#30) fikk sin egen skrivevei: et medlem skal kunne
 * markere «øver på» bare på et prosjekt hen faktisk ser, og to steder som
 * gjentar den samme trappen av betingelser med hver sin `if` er to steder som
 * før eller siden gir hvert sitt svar.
 *
 * Trappen, uendret fra før:
 *
 * - **Upublisert** er usynlig for alle andre enn `projects.manage`. Et utkast er
 *   et utkast.
 * - **Publisert og avholdt** (eller uten dato) forblir synlig for dem som
 *   forvalter prosjektet eller har fullt arkivinnsyn — de skal kunne slå opp
 *   fjorårets program. For et vanlig medlem er det borte fra listene, og
 *   direktelenken svarer det samme som listene viser.
 * - Alt annet er åpent for innloggede.
 *
 * Filtilgangen er en ANNEN regel og ligger fortsatt i `memberFileAccessContext`
 * + `file-access.ts`: at du får se at prosjektet finnes, betyr ikke at du får
 * laste ned stemmene i det.
 */

export type ProjectVisibilityRow = {
  isPublished: boolean
  /** ISO-dato eller null. Uten dato regnes prosjektet aldri som «kommende». */
  eventDate: string | null
}

export type ProjectVisibilityViewer = {
  /** `projects.manage` (eller `*`). */
  canManage: boolean
  /** `archive.viewAll` ∨ `works.manage`. */
  canBrowseArchive: boolean
}

export type ProjectVisibility = 'ok' | 'unpublished' | 'past'

/** Meldingene brukeren faktisk leser. Ett sted, så de to kallstedene er like. */
export const PROJECT_VISIBILITY_MESSAGES: Record<Exclude<ProjectVisibility, 'ok'>, string> = {
  unpublished: 'Prosjektet er ikke publisert ennå',
  past: 'Prosjektet er ikke lenger tilgjengelig',
}

export function projectVisibility(
  project: ProjectVisibilityRow,
  viewer: ProjectVisibilityViewer,
  today: string,
): ProjectVisibility {
  if (!project.isPublished) return viewer.canManage ? 'ok' : 'unpublished'
  if (viewer.canManage || viewer.canBrowseArchive) return 'ok'
  if (!project.eventDate || project.eventDate < today) return 'past'
  return 'ok'
}

/**
 * Er prosjektet «pågående» i filtilgangens forstand — publisert, med en dato
 * som ikke er passert? Det er denne som gir et medlem tilgang til stemmene i
 * repertoaret, og den er med vilje strengere enn `projectVisibility`: en
 * arkivar ser gamle programmer, men et gammelt program åpner ingen filgate.
 */
export function isActiveProject(project: ProjectVisibilityRow, today: string): boolean {
  return project.isPublished && !!project.eventDate && project.eventDate >= today
}
