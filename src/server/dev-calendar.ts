import { toOsloDate } from '../lib/format'

/**
 * En generert iCalendar-feed for lokal utvikling (#82). Brukes KUN når
 * `CALENDAR_ICS_URL` mangler i dev — `loadCalendar` gjør fallbacken, og hele
 * modulen faller ut av produksjonsbygget fordi den bare importeres dynamisk
 * inne i en `import.meta.env.DEV`-gren.
 *
 * Hvorfor generert og ikke en statisk .ics-fil: demodataene (øvingsplan og
 * oppmøte) henger på en `occurrenceKey`, og nøkkelen inneholder forekomstens
 * tidspunkt. En fast fixture ville pekt på en øvelse i fortiden etter noen uker,
 * og «neste øvelse» i demoen hadde vært tom. Her er datoene relative til dag i
 * dag, mens formen er den samme hver gang.
 *
 * Fixturen inneholder med vilje alt #82 må tåle:
 * - en ukentlig øvelse (`RRULE`) med historikk bakover,
 * - én FLYTTET forekomst (`RECURRENCE-ID`) om to uker — samme nøkkel som før
 *   flyttingen, nytt tidspunkt,
 * - én SLETTET forekomst (`EXDATE`) om tre uker — nøkkelen finnes, hendelsen
 *   ikke; en øvingsplan på den blir foreldreløs,
 * - en enkelthendelse (konsert) og en heldagshendelse (seminarhelg).
 */

/** UID-ene er stabile, så demodataene finner tilbake til samme serie. */
export const DEV_REHEARSAL_UID = 'dev-ovelse@demo.tertnesbrass.no'
export const DEV_CONCERT_UID = 'dev-konsert@demo.tertnesbrass.no'
export const DEV_SEMINAR_UID = 'dev-seminar@demo.tertnesbrass.no'

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10)
}

function weekdayOf(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()
}

/** `2026-09-02` → `20260902` (iCalendar-formen). */
function compact(isoDate: string): string {
  return isoDate.replace(/-/g, '')
}

function vevent(lines: string[]): string {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n')
}

/**
 * Bygger feeden. `now` er epoch-ms; alle datoer regnes i norsk veggklokketid,
 * som er det Google-feeden også bruker.
 */
export function devCalendarIcs(now: number): string {
  const today = toOsloDate(now)
  // Nærmeste onsdag fra og med i dag — «neste øvelse» i demoen.
  const nextRehearsal = addDays(today, (3 - weekdayOf(today) + 7) % 7)
  // Serien starter åtte uker tilbake, så lista har historikk og
  // `CALENDAR_WINDOW_BACK` har noe å vise.
  const seriesStart = addDays(nextRehearsal, -56)
  const movedDay = addDays(nextRehearsal, 14)
  const deletedDay = addDays(nextRehearsal, 21)
  const concertDay = addDays(nextRehearsal, 35)
  const seminarStart = addDays(nextRehearsal, 49)

  return [
    'BEGIN:VCALENDAR',
    'PRODID:-//Tertnes Brass//Dev-fixture//NO',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Tertnes Brass (demo)',
    'X-WR-TIMEZONE:Europe/Oslo',
    vevent([
      `UID:${DEV_REHEARSAL_UID}`,
      `DTSTART;TZID=Europe/Oslo:${compact(seriesStart)}T190000`,
      `DTEND;TZID=Europe/Oslo:${compact(seriesStart)}T213000`,
      'RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=WE',
      `EXDATE;TZID=Europe/Oslo:${compact(deletedDay)}T190000`,
      'SUMMARY:Øvelse',
      'LOCATION:Tertnes skole\\, musikkrommet',
      'DESCRIPTION:Vanlig ukesøvelse. Oppmøte 18:45.',
      'STATUS:CONFIRMED',
    ]),
    // Flyttet forekomst: samme UID, RECURRENCE-ID på det OPPRINNELIGE
    // tidspunktet. Nøkkelen skal være uendret; klokkeslettet skal ikke.
    vevent([
      `UID:${DEV_REHEARSAL_UID}`,
      `RECURRENCE-ID;TZID=Europe/Oslo:${compact(movedDay)}T190000`,
      `DTSTART;TZID=Europe/Oslo:${compact(movedDay)}T173000`,
      `DTEND;TZID=Europe/Oslo:${compact(movedDay)}T200000`,
      'SUMMARY:Øvelse (flyttet — generalprøve)',
      'LOCATION:Åsane kulturhus',
      'STATUS:CONFIRMED',
    ]),
    vevent([
      `UID:${DEV_CONCERT_UID}`,
      `DTSTART;TZID=Europe/Oslo:${compact(concertDay)}T180000`,
      `DTEND;TZID=Europe/Oslo:${compact(concertDay)}T200000`,
      'SUMMARY:Vårkonsert',
      'LOCATION:Grieghallen',
      'STATUS:CONFIRMED',
    ]),
    vevent([
      `UID:${DEV_SEMINAR_UID}`,
      `DTSTART;VALUE=DATE:${compact(seminarStart)}`,
      `DTEND;VALUE=DATE:${compact(addDays(seminarStart, 2))}`,
      'SUMMARY:Seminarhelg',
      'LOCATION:Voss',
      'STATUS:CONFIRMED',
    ]),
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}
