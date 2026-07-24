/**
 * Ren, runtime-uavhengig autorisasjon for nedlasting av en fil. ÉN sannhetskilde
 * brukt av fil-gaten (`routes/api/files/$fileId.ts`), prosjektvisningen og
 * `getShareView` — slik at liste og gate aldri kan divergere. Holdes import-fri
 * så den kan enhetstestes i node.
 *
 * Hard tilgangsstyring: en innlogget bruker når en stemmefil hvis stemma er i
 * `effectivePartIds` (egne tildelte stemmer ekspandert nedover treet), eller i
 * det eksplisitte løv-omfanget hen leder OG hen fortsatt har
 * `members.manage.section`. Verket må være med i et publisert, kommende
 * prosjekt. Fullt arkivinnsyn omgår prosjektkravet. Partitur styres ortogonalt
 * av `scores.view`. Uplassert ('other') krever fullt arkivinnsyn.
 */

export type FileLite = { kind: string; partId: string | null }

export type AccessCtx = {
  effectivePartIds: string[]
  sectionLeaderPartIds: string[] // løv-stemmer i eksplisitt section_leaders-scope
  canManageSection: boolean // members.manage.section; scope-rader alene er ikke nok
  canViewScore: boolean // scores.view
  canViewAll: boolean // archive.viewAll ELLER works.manage (sistnevnte = fail-safe for arkivforvaltere)
  inAccessibleProject: boolean // verket finnes i minst ett publisert, kommende prosjekt
}

function memberCanAccessPart(partId: string | null, ctx: AccessCtx): boolean {
  if (!partId) return false
  return (
    ctx.effectivePartIds.includes(partId) ||
    (ctx.canManageSection && ctx.sectionLeaderPartIds.includes(partId))
  )
}

/** Kan en innlogget bruker laste ned denne filen? */
export function memberCanAccessFile(file: FileLite, ctx: AccessCtx): boolean {
  if (!ctx.canViewAll && !ctx.inAccessibleProject) return false
  switch (file.kind) {
    case 'audio':
      return true
    case 'score':
      return ctx.canViewScore
    case 'part':
      return ctx.canViewAll || memberCanAccessPart(file.partId, ctx)
    default:
      // 'other'/uplassert og ukjente kinds: kun fullt arkivinnsyn.
      return ctx.canViewAll
  }
}

/**
 * Kan en vikar (delingslenke) laste ned denne filen? `sharedLeafIds` er
 * snapshottede løv-stemmer fra `share_links.partIds` (allerede ekspandert ved
 * opprettelse), så dette er en ren medlemskaps-sjekk. Lyd er alltid med;
 * partitur og uplassert deles aldri via vikarlenke.
 */
export function shareAllows(file: FileLite, sharedLeafIds: string[]): boolean {
  if (file.kind === 'audio') return true
  if (file.kind === 'part') return !!file.partId && sharedLeafIds.includes(file.partId)
  return false
}

/**
 * Filer som skal VISES (metadata) for en innlogget bruker på et verk. Mindre
 * streng enn nedlasting: partitur og lyd vises alltid (nedlasting gates likevel),
 * mens andres stemmer og uplassert skjules for de uten fullt arkivinnsyn.
 */
export function memberCanSeeFile(file: FileLite, ctx: AccessCtx): boolean {
  if (ctx.canViewAll) return true
  if (!ctx.inAccessibleProject) return false
  if (file.kind === 'score' || file.kind === 'audio') return true
  if (file.kind === 'part') return memberCanAccessPart(file.partId, ctx)
  return false // 'other'/uplassert skjules
}
