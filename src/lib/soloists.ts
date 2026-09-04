/**
 * Solister på et verk i et prosjekt (#50). Rene regler uten server- eller
 * DOM-avhengigheter, slik at skjemaet og serveren ikke kan ha hver sin mening om
 * hva en gyldig solist er.
 *
 * **Solisten hører til KOBLINGEN prosjekt↔verk, ikke til verket.** «Napoli» har
 * ikke en solist; «Napoli på julekonserten 2026» har det, og neste gang stykket
 * spilles er det som regel en annen. Derfor bor radene i
 * `project_work_soloists` med en sammensatt fremmednøkkel mot `project_works` —
 * tas stykket ut av programmet, forsvinner solistene med det, mens verket i
 * arkivet er urørt.
 *
 * **Intern eller ekstern, aldri begge.** En solist er ENTEN et medlem
 * (`userId`, navnet slås opp ferskt i `user` ved visning, som i #83 og på
 * tidsplanen) ELLER et fritekstnavn (`externalName`) for vikaren eller den
 * innleide solisten som aldri får en konto. To felt satt samtidig ville gitt to
 * navn på samme person, og ingen av dem kunne vært den riktige.
 *
 * **Solistgruppe er ikke en egen type.** Saken spurte om det burde være det
 * (#50: «Vurder om solistgruppe skal vere eige felt/type eller berre tekst»).
 * Svaret er nei: «Trombonegruppa» skrives inn som et fritekstnavn, og `role`
 * bærer nyansen ellers («Kornettsolist», «Duett», «Slagverksgruppa»). En egen
 * gruppetype ville krevd at gruppene fantes som rader et sted — og en
 * «trombonegruppe» i et konsertprogram er sjelden nøyaktig det samme settet
 * mennesker som stemmegruppa i besetningen.
 */

/** Fritekstnavnet på en ekstern solist eller en gruppe. */
export const SOLOIST_NAME_MAX = 80

/** Rolle-/gruppeteksten: «Kornettsolist», «Sopran», «Duett med Ingrid». */
export const SOLOIST_ROLE_MAX = 60

/**
 * Taket per prosjektverk. Ikke en teknisk grense, men en påminnelse om at et
 * program med tjue solister på ett stykke som regel er en feilregistrering.
 */
export const MAX_SOLOISTS_PER_WORK = 12

export type SoloistInput = {
  userId?: string | null
  externalName?: string | null
  role?: string | null
}

export type SoloistValue = {
  userId: string | null
  externalName: string | null
  role: string | null
}

/** Trimmer, kollapser mellomrom og kutter. Tom tekst blir `null`, aldri ''. */
function cleanText(value: string | null | undefined, max: number): string | null {
  const text = (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max).trim()
  return text.length > 0 ? text : null
}

/**
 * Normaliserer ett solistfelt før lagring. Kaster med en norsk melding når
 * inndataene ikke gir mening — samme mønster som `parseProjectTimeInput`.
 *
 * Er et medlem valgt, forkastes fritekstnavnet med vilje: skjemaet lar deg
 * skrive et navn og så velge et medlem, og da er medlemmet svaret. Uten dette
 * ville en rad kunnet bære et gammelt håndskrevet navn ved siden av
 * medlemsreferansen, og visningen måtte gjettet hvilket av dem som gjaldt.
 */
export function parseSoloistInput(input: SoloistInput): SoloistValue {
  const userId = cleanText(input.userId, 64)
  const externalName = cleanText(input.externalName, SOLOIST_NAME_MAX)
  if (!userId && !externalName) {
    throw new Error('Velg et medlem, eller skriv inn navnet på solisten')
  }
  return {
    userId,
    externalName: userId ? null : externalName,
    role: cleanText(input.role, SOLOIST_ROLE_MAX),
  }
}

/**
 * En solist slik den leses. `memberName` er medlemmets NÅVÆRENDE navn, slått
 * opp i `user` ved lesing — aldri en kopi lagret på raden.
 */
export type SoloistRow = {
  id: string
  userId: string | null
  memberName: string | null
  externalName: string | null
  role: string | null
}

/**
 * Navnet som skal vises. Medlemsnavnet går foran fritekstnavnet, og en rad som
 * har mistet begge (kontoen slettet, ingen fritekst) blir «Ukjent solist» —
 * aldri et tomt navn og aldri et gammelt et.
 */
export function soloistName(row: Pick<SoloistRow, 'memberName' | 'externalName'>): string {
  return row.memberName ?? row.externalName ?? 'Ukjent solist'
}

/** «Ingrid Hansen (kornett)» — rollen i parentes når den finnes. */
export function soloistLabel(row: Pick<SoloistRow, 'memberName' | 'externalName' | 'role'>): string {
  const name = soloistName(row)
  return row.role ? `${name} (${row.role})` : name
}

/** «Solist: Ingrid Hansen» / «Solister: Ingrid Hansen · Kåre Vik (vikar)». */
export function soloistSummary(rows: Array<Pick<SoloistRow, 'memberName' | 'externalName' | 'role'>>): string | null {
  if (rows.length === 0) return null
  const label = rows.length === 1 ? 'Solist' : 'Solister'
  return `${label}: ${rows.map(soloistLabel).join(' · ')}`
}
