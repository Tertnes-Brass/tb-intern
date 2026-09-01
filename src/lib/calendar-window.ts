/**
 * Tidsvinduet den interne kalenderlista viser (#84). Egen, ren modul fordi
 * `calendar-feed.ts` importerer `cloudflare:workers` og derfor ikke kan røres
 * fra en node-test — og fordi `/kalender` skal kunne skrive «de neste fire
 * månedene» uten å gjette på hva serveren faktisk hentet.
 */

const DAY_MS = 86_400_000

/** Fra i går, slik at dagens hendelse ikke forsvinner når den er i gang. */
export const CALENDAR_WINDOW_BACK_MS = DAY_MS

/**
 * 17 uker ≈ fire måneder. Uker framfor kalendermåneder med vilje: vinduet er en
 * ren `now + ms`-regning både her og i `expandEvents`, og «legg til fire
 * kalendermåneder» ville krevd datoaritmetikk med månedslengder og sommertid
 * for å flytte grensen noen få dager. 17 uker ligger alltid litt forbi fjerde
 * månedsskifte (4 × 30,4 dager = 122 dager; 17 uker = 119 dager + `WINDOW_BACK`),
 * som er det lista lover.
 */
export const CALENDAR_WINDOW_FORWARD_WEEKS = 17
export const CALENDAR_WINDOW_FORWARD_MS = CALENDAR_WINDOW_FORWARD_WEEKS * 7 * DAY_MS

/**
 * Taket på antall forekomster `expandEvents` returnerer. Prod-feeden har rundt
 * 1 000 hendelser TOTALT (flere år), og fire måneder med ukentlig øvelse,
 * tilsynsvakter, konserter og seksjonsøvelser lander godt under hundre. 600 er
 * satt så høyt at en tett periode ikke blir avkortet i stillhet — grensen
 * finnes for å hindre at en ødelagt RRULE spiser minnet, ikke for å beskjære
 * lista.
 */
export const CALENDAR_MAX_EVENTS = 600

/** Teksten som beskriver vinduet. Holdes her så UI-et ikke kan komme i utakt. */
export const CALENDAR_WINDOW_LABEL = 'De neste fire månedene'

/** Argumentene `expandEvents` skal ha. `now` er epoch-ms. */
export function calendarWindow(now: number): { from: number; to: number; max: number } {
  return {
    from: now - CALENDAR_WINDOW_BACK_MS,
    to: now + CALENDAR_WINDOW_FORWARD_MS,
    max: CALENDAR_MAX_EVENTS,
  }
}
