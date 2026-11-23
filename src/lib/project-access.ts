/**
 * Hvem kan se et prosjekt, og hvilke stemmer gir det? Regelen bodde inne i
 * `getProject`; den er trukket ut hit fordi sceneoppsettene og fil-gaten skal
 * følge nøyaktig samme regel, og to kopier ville før eller siden gitt to svar.
 *
 * - Et utkast ses bare av `projects.manage`.
 * - Et publisert prosjekt ses av alle så lenge datoen ikke er passert. Etterpå
 *   (eller uten dato) bare av `projects.manage` og den med fullt arkivinnsyn.
 * - Et spilleoppdrag er lukket: i tillegg til reglene over må man stå på
 *   oppdraget (`project_crew`) eller ha `projects.manage`. Fullt arkivinnsyn
 *   åpner ikke oppdraget, og for alle andre finnes det ikke.
 */
export const GIG_KIND = 'spilleoppdrag'

/** Samme svar som for en id som ikke finnes, så en lenke ikke røper oppdraget. */
export const PROJECT_NOT_FOUND = 'Fant ikke prosjektet'

export type ProjectVisibility = { kind: string; isPublished: boolean; eventDate: string | null }

export function isGig(project: { kind: string }): boolean {
  return project.kind === GIG_KIND
}

export function projectReadError(
  project: ProjectVisibility,
  viewer: { canManage: boolean; canBrowseArchive: boolean; isCrew?: boolean },
  today: string,
): string | null {
  if (isGig(project) && !viewer.canManage && !viewer.isCrew) return PROJECT_NOT_FOUND
  if (!project.isPublished && !viewer.canManage) return 'Prosjektet er ikke publisert ennå'
  if (
    project.isPublished &&
    (!project.eventDate || project.eventDate < today) &&
    !viewer.canManage &&
    !viewer.canBrowseArchive
  ) {
    return 'Prosjektet er ikke lenger tilgjengelig'
  }
  return null
}

/** `project_crew.part_ids`. Ødelagt JSON gir ingen egne stemmer, aldri en feil. */
export function parseCrewPartIds(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/**
 * Stemmene et medlem spiller på oppdraget: de tildelte, eller de vanlige når
 * ingen er valgt. `null` betyr at medlemmet ikke er med, og gir ingen stemmer.
 */
export function crewPartsFor(crewPartIds: string | null, ownPartIds: string[]): string[] {
  if (crewPartIds === null) return []
  const assigned = parseCrewPartIds(crewPartIds)
  return assigned.length > 0 ? assigned : ownPartIds
}

/**
 * Hva gir de publiserte, kommende prosjektene et verk står i? Ett vanlig
 * prosjekt gir egne stemmer, et oppdrag man er med på gir oppdragets stemmer,
 * og et oppdrag man ikke er med på gir ingenting.
 */
export function projectFileGrant(
  rows: ReadonlyArray<{ kind: string; crewPartIds: string | null }>,
  ownPartIds: string[],
): { inAccessibleProject: boolean; effectivePartIds: string[] } {
  const partIds = new Set<string>()
  let inAccessibleProject = false
  for (const row of rows) {
    if (isGig(row) && row.crewPartIds === null) continue
    inAccessibleProject = true
    for (const id of isGig(row) ? crewPartsFor(row.crewPartIds, ownPartIds) : ownPartIds) partIds.add(id)
  }
  return { inAccessibleProject, effectivePartIds: [...partIds] }
}
