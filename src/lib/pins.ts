/**
 * Festede innlegg på veggen — de rene reglene, uten database og DOM.
 *
 * Et festet innlegg står øverst på veggen (i «Festet»-lista over feeden) til
 * noen løsner det, eller til og med en valgt dato. Det står i tillegg på sin
 * vanlige plass i feeden: festingen er en innholdsfortegnelse over det som
 * skal være lett å finne igjen, ikke et nytt sted for samtalen.
 *
 * Bare `posts.publish` kan feste og løsne — det endrer hva alle ser først.
 * Taket (`MAX_PINNED_POSTS`) gjør at festingen holder seg meningsfull: blir
 * alt festet, er ingenting det.
 *
 * Datoen er en norsk kalenderdato («YYYY-MM-DD», festet TIL OG MED den dagen).
 * Den sammenlignes som tekst mot dagens dato i norsk tid (`toOsloDate`), så
 * utløpet krever verken cron eller tidssoneregning i SQL.
 */

/** Maks antall innlegg som kan være festet samtidig. Håndheves server-side. */
export const MAX_PINNED_POSTS = 5

/** Hvor langt frem en festing kan vare med dato. «Til jeg løsner det» har ingen grense. */
export const MAX_PIN_DAYS = 366

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export type PinState = {
  pinnedAt: number | null
  pinnedUntil: string | null
  publishedAt: number | null
}

/** Er innlegget festet akkurat nå? Et utkast er aldri festet. */
export function isPinned(post: PinState, today: string): boolean {
  if (post.pinnedAt === null || post.publishedAt === null) return false
  return post.pinnedUntil === null || post.pinnedUntil >= today
}

/** Gyldig kalenderdato på formen YYYY-MM-DD (ikke 2026-02-30)? */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const d = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** `today` + n dager, som YYYY-MM-DD. */
export function addDays(today: string, n: number): string {
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * `null` = greit. Ellers en begrunnelse klienten kan vise. Datoen kan være i
 * dag (festet ut dagen), men ikke i fortiden og ikke mer enn et år frem.
 */
export function pinUntilRejection(until: string | null, today: string): string | null {
  if (until === null) return null
  if (!isIsoDate(until)) return 'Ugyldig dato'
  if (until < today) return 'Datoen har allerede vært'
  if (until > addDays(today, MAX_PIN_DAYS)) return 'Velg en dato innen et år'
  return null
}

/**
 * Rekkefølgen i «Festet»: «Viktig» først, så sist festet først. Id-en avgjør
 * til slutt, så rekkefølgen er stabil mellom to hentinger.
 */
export function sortPinned<T extends { id: string; importance: string; pinnedAt: number | null }>(list: readonly T[]): T[] {
  return [...list].sort(
    (a, b) =>
      Number(b.importance === 'important') - Number(a.importance === 'important') ||
      (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0) ||
      a.id.localeCompare(b.id),
  )
}

const dayMonth = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/**
 * Kort tekst om varigheten: «Til du løsner det», «Ut i dag», «Til og med i morgen»,
 * «Til og med 14. nov.». Brukes på veggen, på innlegget og i dialogen.
 */
export function pinDurationLabel(until: string | null, today: string): string {
  if (until === null) return 'Til noen løsner det'
  if (until === today) return 'Ut i dag'
  if (until === addDays(today, 1)) return 'Til og med i morgen'
  return `Til og med ${dayMonth.format(new Date(`${until}T12:00:00Z`))}`
}

/** Feilmeldingen når taket er nådd. Én kilde for server og test. */
export function pinLimitMessage(max: number = MAX_PINNED_POSTS): string {
  return `Det er allerede ${max} festede innlegg. Løsne ett av dem først.`
}

export const PIN_DRAFT_MESSAGE = 'Publiser innlegget før du fester det'

/**
 * Avslagene `setPostPinned` gir som er ment for brukeren. Mobil-API-et sender
 * KUN disse videre som tekst (409); alt annet forblir den generiske feilen.
 */
export const PIN_ERRORS: readonly string[] = [
  pinLimitMessage(),
  PIN_DRAFT_MESSAGE,
  'Ugyldig dato',
  'Datoen har allerede vært',
  'Velg en dato innen et år',
]
