/**
 * Slagverksoppsettet — hvilke slagverksinstrumenter et stykke krever, og hvem
 * som spiller hva. Erstatter kolonnene i konsertregnearket.
 *
 * Her ligger den rene logikken: hvem linjen skal vises for, og hvordan den frie
 * teksten normaliseres før lagring. Ingen DB, ingen React — importeres både av
 * `src/server/*.ts` og av komponentene.
 */

/** Seksjons-id-en for slagverk i `src/lib/taxonomy.ts` (`SECTION_ORDER`). */
export const PERCUSSION_SECTION = 'perc'

/** Maks lengde på et oppsett eller et notat. Fri tekst, men ikke en roman. */
export const PERCUSSION_MAX_LENGTH = 2000

/**
 * Rettigheter som alltid gir innsyn i oppsettet, uavhengig av stemme:
 * arkivaren, dirigenten og alle som forvalter programmet. `projects.manage`
 * er dirigentens rettighet — det er hen som setter opp slagverket.
 */
const PERCUSSION_PERMISSIONS = ['archive.viewAll', 'works.manage', 'projects.manage']

export type PercussionViewer = {
  permissions: string[]
  parts: Array<{ section: string }>
} | null

/**
 * Skal slagverkslinjen vises for dette medlemmet på «Mine noter»?
 *
 * Regelen er en støyregel, ikke en hemmelighetsregel: oppsettet er ikke
 * sensitivt, men det er irrelevant for en kornettist. Slagverkere ser det fordi
 * de har en stemme i seksjonen; stab og dirigent fordi de setter det opp.
 */
export function showPercussionFor(me: PercussionViewer): boolean {
  if (!me) return false
  if (me.parts.some((p) => p.section === PERCUSSION_SECTION)) return true
  if (me.permissions.includes('*')) return true
  return PERCUSSION_PERMISSIONS.some((p) => me.permissions.includes(p))
}

/**
 * Samme regel for vikarlenken: vikaren ser oppsettet når de tildelte stemmene
 * inkluderer en slagverksstemme. Vikaren har ingen konto og ingen rettigheter,
 * så stemmene er alt vi har å gå på.
 */
export function sharedPartsSeePercussion(parts: Array<{ section: string }>): boolean {
  return parts.some((p) => p.section === PERCUSSION_SECTION)
}

/**
 * Normaliserer et oppsett før lagring: CRLF → LF, trim per linje, ingen blanke
 * linjer i endene, maks {@link PERCUSSION_MAX_LENGTH} tegn. Tomt (eller bare
 * mellomrom) blir `null` — «tøm feltet» skal faktisk fjerne linjen fra
 * visningen, ikke etterlate en tom streng som ser satt ut i SQL.
 */
export function parsePercussionSetup(input: string | null | undefined): string | null {
  if (input == null) return null
  const lines = input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
  while (lines.length > 0 && lines[0] === '') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const text = lines.join('\n').slice(0, PERCUSSION_MAX_LENGTH).trim()
  return text.length > 0 ? text : null
}

/** Linjene i et oppsett, klare til å rendres. Tomme linjer faller bort. */
export function percussionLines(text: string | null | undefined): string[] {
  if (!text) return []
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}
