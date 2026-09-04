/**
 * Ren, runtime-uavhengig autorisasjon for nedlasting av en fil. ÉN sannhetskilde
 * brukt av fil-gaten (`routes/api/files/$fileId.ts`), prosjektvisningen og
 * `getShareView` — slik at liste og gate aldri kan divergere. Holdes import-fri
 * så den kan enhetstestes i node.
 *
 * Hard tilgangsstyring: en innlogget bruker når en stemmefil hvis stemma er i
 * `effectivePartIds` (egne tildelte stemmer ekspandert nedover treet), er delt
 * med hen av et annet medlem (#16), eller er i det eksplisitte løv-omfanget hen
 * leder OG hen fortsatt har `members.manage.section`. Verket må være med i et
 * publisert, kommende prosjekt. Fullt arkivinnsyn omgår prosjektkravet.
 * Partitur styres ortogonalt av `scores.view`. Uplassert ('other') krever fullt
 * arkivinnsyn.
 */

export type FileLite = { kind: string; partId: string | null }

/**
 * En stemme et ANNET medlem har delt med denne brukeren (#16). Navnet følger
 * med fordi «Delt med deg av Ingrid» skal kunne skrives fra samme kilde som
 * avgjør tilgangen — ellers ville lista og gaten kunnet komme i utakt om hvem
 * delingen kom fra.
 */
export type SharedPart = { partId: string; fromName: string }

export type AccessCtx = {
  effectivePartIds: string[]
  /**
   * Stemmer delt av andre medlemmer, ekspandert nedover treet som egne stemmer.
   * Holdt SEPARAT fra `effectivePartIds` med vilje: en lånt stemme er ikke din,
   * og «Mine noter» skal kunne vise den i sin egen seksjon uten å gjette.
   */
  sharedParts: SharedPart[]
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
    ctx.sharedParts.some((s) => s.partId === partId) ||
    (ctx.canManageSection && ctx.sectionLeaderPartIds.includes(partId))
  )
}

/**
 * Er DENNE fila synlig for meg fordi noen delte stemmen sin — og i så fall hvem?
 * `null` når fila ikke er en stemmefil, når stemma er min egen (da er den ikke
 * lånt), eller når ingen har delt den.
 *
 * Egne stemmer går foran: har du selv fått 3. horn tildelt etter at Ingrid delte
 * den med deg, er nota din egen, og «Delt med deg av Ingrid» ville vært feil.
 *
 * ALLE delerne navngis, ikke den første som tilfeldigvis lå i lista: deler både
 * Ingrid og Karim 3. horn med deg, ville ett navn gjort at nota ble stående
 * uforklart igjen når du fjernet den ene delingen.
 */
export function sharedFileFrom(file: FileLite, ctx: AccessCtx): string | null {
  if (file.kind !== 'part' || !file.partId) return null
  if (ctx.effectivePartIds.includes(file.partId)) return null
  const names = ctx.sharedParts.filter((s) => s.partId === file.partId).map((s) => s.fromName)
  if (names.length === 0) return null
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} og ${names[names.length - 1]}`
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
