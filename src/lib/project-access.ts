/**
 * Hvem kan se et prosjekt? Regelen bodde inne i `getProject`; den er trukket ut
 * hit fordi sceneoppsettene skal følge nøyaktig samme regel, og to kopier av
 * den ville før eller siden gitt to svar.
 *
 * - Et utkast ses bare av `projects.manage`.
 * - Et publisert prosjekt ses av alle så lenge datoen ikke er passert. Etterpå
 *   (eller uten dato) bare av `projects.manage` og den med fullt arkivinnsyn.
 */
export type ProjectVisibility = { isPublished: boolean; eventDate: string | null }

export function projectReadError(
  project: ProjectVisibility,
  viewer: { canManage: boolean; canBrowseArchive: boolean },
  today: string,
): string | null {
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
