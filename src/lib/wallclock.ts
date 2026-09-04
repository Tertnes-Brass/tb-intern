/**
 * Veggklokke ↔ UTC for en navngitt tidssone.
 *
 * Egen, ren modul fordi to steder trenger nøyaktig den samme DST-regningen:
 * iCal-parseren (`src/lib/ical.ts`), som tolker «flytende» tidspunkter fra
 * Google, og skjemaet for sosiale arrangement (#31), som tar imot dato +
 * klokkeslett fra et norsk medlem og skal lagre UTC. To kopier av
 * omleggingshåndteringen ville før eller siden gitt to svar på hva 02:30 den
 * siste søndagen i mars er.
 *
 * Modulen har ingen avhengigheter utenom `Intl`. Det er poenget: `social.ts`
 * kan importere den uten å dra hele iCal-parseren inn i klientbygget.
 */

export const OSLO_TIME_ZONE = 'Europe/Oslo'

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatterCache.set(timeZone, fmt)
  }
  return fmt
}

function zoneParts(utcMs: number, timeZone: string): Record<string, number> {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(utcMs))
  const out: Record<string, number> = {}
  for (const part of parts) {
    if (part.type !== 'literal') out[part.type] = Number(part.value)
  }
  // `hour` kan bli 24 for midnatt i noen ICU-versjoner.
  if (out.hour === 24) out.hour = 0
  return out
}

/** Tidssonens forskyvning fra UTC i ms på et gitt UTC-tidspunkt. */
export function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const p = zoneParts(utcMs, timeZone)
  const asUtc = Date.UTC(p.year ?? 1970, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0)
  return asUtc - utcMs
}

/**
 * Veggklokke i `timeZone` → UTC-millisekunder. `floatingMs` er tidspunktet
 * tolket som om det var UTC (dvs. `Date.UTC(...)` av felttallene).
 *
 * To iterasjoner: første gjetning bruker forskyvningen på feil side av en
 * eventuell omlegging, andre runde treffer. I DST-hullet (kl. 02:00–03:00 om
 * våren i Oslo) finnes ikke tidspunktet, og vi lander deterministisk på
 * tidspunktet rett etter hoppet — som er det Google også gjør.
 */
export function floatingToUtc(floatingMs: number, timeZone: string): number {
  const first = floatingMs - zoneOffsetMs(floatingMs, timeZone)
  return floatingMs - zoneOffsetMs(first, timeZone)
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^(\d{2}):(\d{2})$/

/**
 * `<input type="date">` + `<input type="time">` → UTC-millisekunder.
 *
 * Konverteringen skjer SERVER-side, aldri med `new Date('2026-12-12T19:00')` i
 * nettleseren: den strengen tolkes i klientens egen tidssone, og et medlem som
 * melder inn julebordet fra en ferie i Thailand ville da lagt det inn seks
 * timer feil. Verdien i feltet er norsk veggklokke fordi korpset er norsk.
 *
 * Ugyldig eller umulig dato (31. februar) gir `null` — kalleren avgjør
 * feilmeldingen.
 */
export function wallClockToUtc(date: string, time: string, timeZone: string = OSLO_TIME_ZONE): number | null {
  const d = DATE_RE.exec(date.trim())
  const t = TIME_RE.exec(time.trim())
  if (!d || !t) return null
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])]
  const [hour, minute] = [Number(t[1]), Number(t[2])]
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
  const floating = Date.UTC(year, month - 1, day, hour, minute)
  // Date.UTC ruller over: 2026-02-31 blir 3. mars. Det er en skrivefeil, ikke
  // en dato brukeren mente — avvis den i stedet for å gjette.
  const rolled = new Date(floating)
  if (rolled.getUTCMonth() !== month - 1 || rolled.getUTCDate() !== day) return null
  return floatingToUtc(floating, timeZone)
}

/** UTC-millisekunder → feltverdiene et skjema skal forhåndsutfylles med. */
export function utcToWallClock(ms: number, timeZone: string = OSLO_TIME_ZONE): { date: string; time: string } {
  const p = zoneParts(ms, timeZone)
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return {
    date: `${pad(p.year ?? 1970, 4)}-${pad(p.month ?? 1)}-${pad(p.day ?? 1)}`,
    time: `${pad(p.hour ?? 0)}:${pad(p.minute ?? 0)}`,
  }
}
