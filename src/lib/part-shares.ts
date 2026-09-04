/**
 * Delte stemmer mellom medlemmer (#16) — den rene logikken.
 *
 * Et medlem kan la et annet medlem lese notene til én av sine EGNE tildelte
 * stemmer. Modulen eier reglene for hva som er en gyldig deling, og hvordan
 * delingene sorteres og omtales i UI-et. Ingen DB, ingen React — importeres av
 * både `src/server/part-shares.ts` og komponentene, slik at skjemaet og
 * serveren aldri kan ha hver sin mening om hva som er lov.
 *
 * Selve HÅNDHEVELSEN ligger ikke her: en delt stemme kommer inn i
 * `AccessCtx.sharedParts` og vurderes av `memberCanAccessPart` i
 * `src/server/file-access.ts`, sammen med egne stemmer og lederomfang. Det er
 * ett sted, ikke tre.
 */

/**
 * Hvor mange delinger ett medlem kan gi bort samtidig.
 *
 * Taket finnes for at «del stemmen din» ikke skal kunne bli «del stemmen din
 * med hele korpset»: en deling er ment som en avtale mellom to personer, og
 * skal noe deles bredt, er det en stemmetildeling eller en vikarlenke.
 * Romslig nok til at ingen reell bruk treffer det.
 */
export const MAX_PART_SHARES = 10

export type PartShareRequest = {
  /** Den innloggede — deleren. */
  meId: string
  /** Delerens RÅ tildelte stemmer (`user_parts`), ikke de ekspanderte. */
  ownPartIds: string[]
  /** Antall delinger deleren allerede har gitt. */
  givenCount: number
  toUserId: string
  partId: string
  /** Mottakeren finnes og er et aktivt medlem. */
  recipientIsActiveMember: boolean
  /** Nøyaktig denne delingen finnes allerede. */
  alreadyShared: boolean
}

/**
 * Hvorfor kan denne delingen ikke opprettes? `null` = den er i orden.
 *
 * Rekkefølgen er bevisst: eierskapet til stemmen sjekkes FØR mottakeren, slik
 * at et rått kall ikke kan brukes til å lete opp hvem som er aktivt medlem ved
 * å sende inn en stemme man uansett ikke eier. Medlemslista er riktignok åpen
 * for alle innloggede (`requireMe()`), så dette er ryddighet mer enn en
 * skranke — men regelen koster ingenting å følge.
 */
export function partShareRejection(req: PartShareRequest): string | null {
  if (req.toUserId === req.meId) return 'Du kan ikke dele en stemme med deg selv.'
  if (!req.ownPartIds.includes(req.partId)) {
    return 'Du kan bare dele stemmer du selv er tildelt.'
  }
  if (!req.recipientIsActiveMember) return 'Fant ikke medlemmet.'
  if (req.alreadyShared) return 'Stemmen er allerede delt med dette medlemmet.'
  if (req.givenCount >= MAX_PART_SHARES) {
    return `Du kan dele stemmer med maks ${MAX_PART_SHARES} medlemmer om gangen. Fjern en deling først.`
  }
  return null
}

export type PartShareRow = {
  /** Den ANDRE parten: mottakeren i «delt av deg», deleren i «delt med deg». */
  memberId: string
  memberName: string
  partId: string
  partName: string
}

/**
 * Rekkefølgen delingene vises i: navn først, så stemme — begge med norsk
 * kollasjon, så «Ø» havner bakerst og ikke foran «A». Lista er kort nok til at
 * gruppering ville vært mer krom enn hjelp.
 */
export function sortPartShares<T extends PartShareRow>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      a.memberName.localeCompare(b.memberName, 'nb') || a.partName.localeCompare(b.partName, 'nb'),
  )
}

/** Overskriften over en mottatt deling. Skrives ett sted, brukes overalt. */
export function sharedWithYouLabel(fromName: string): string {
  return `Delt med deg av ${fromName}`
}

/**
 * Lånte filer gruppert på hvem som lånte dem bort, slik at ett verk med to
 * lånte stemmer fra samme person får ÉN overskrift og ikke to.
 * Rekkefølgen innenfor gruppa er den serveren sendte (stemmerekkefølgen).
 */
export function groupSharedFiles<T extends { fromName: string }>(
  files: T[],
): Array<{ fromName: string; files: T[] }> {
  const byName = new Map<string, T[]>()
  for (const file of files) {
    const list = byName.get(file.fromName)
    if (list) list.push(file)
    else byName.set(file.fromName, [file])
  }
  return [...byName.entries()]
    .map(([fromName, group]) => ({ fromName, files: group }))
    .sort((a, b) => a.fromName.localeCompare(b.fromName, 'nb'))
}
