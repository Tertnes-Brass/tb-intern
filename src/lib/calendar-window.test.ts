import { describe, expect, it } from 'vitest'
import {
  CALENDAR_MAX_EVENTS,
  CALENDAR_WINDOW_FORWARD_MS,
  CALENDAR_WINDOW_FORWARD_WEEKS,
  calendarWindow,
} from './calendar-window'
import { expandEvents } from './ical'

/**
 * Vinduet den interne kalenderlista viser (#84). Testene kjører den samme
 * `expandEvents(ics, calendarWindow(now))` som `loadCalendar` gjør — men uten
 * Workers-runtime, siden vinduet nå er en ren konstant.
 *
 * Referansepunktet er tirsdag 1. september 2026 kl. 09:00 norsk tid. Det gamle
 * åttevekersvinduet stoppet 27. oktober; det nye rekker ut i romjulen.
 */
const NOW = Date.parse('2026-09-01T07:00:00Z')

/** Slik vinduet så ut før #84 — brukes for å vise hva som manglet. */
const OLD_WINDOW = { from: NOW - 86_400_000, to: NOW + 8 * 7 * 86_400_000, max: 200 }

function ics(...vevent: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-TIMEZONE:Europe/Oslo', ...vevent, 'END:VCALENDAR'].join('\r\n')
}

function event(uid: string, summary: string, lines: string[]): string {
  return ['BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${summary}`, ...lines, 'END:VEVENT'].join('\r\n')
}

/** Norsk kalenderdato («2026-12-12») for gruppering per måned, som i /kalender. */
const osloDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Oslo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function months(events: Array<{ start: string }>): string[] {
  return [...new Set(events.map((e) => osloDate.format(new Date(e.start)).slice(0, 7)))]
}

describe('calendarWindow', () => {
  it('rekker forbi fjerde månedsskifte', () => {
    const { from, to } = calendarWindow(NOW)
    expect(CALENDAR_WINDOW_FORWARD_WEEKS).toBe(17)
    // Fra i går, så dagens hendelse ikke forsvinner mens den pågår.
    expect(new Date(from).toISOString()).toBe('2026-08-31T07:00:00.000Z')
    expect(new Date(to).toISOString()).toBe('2026-12-29T07:00:00.000Z')
    expect(CALENDAR_WINDOW_FORWARD_MS / (7 * 86_400_000)).toBe(CALENDAR_WINDOW_FORWARD_WEEKS)
  })
})

describe('vinduet i praksis', () => {
  const feed = ics(
    // Ukentlig øvelse hele høsten — den som gjør at listen blir lang.
    event('ovelse', 'Øvelse', [
      'DTSTART;TZID=Europe/Oslo:20260107T190000',
      'DTEND;TZID=Europe/Oslo:20260107T213000',
      'RRULE:FREQ=WEEKLY;BYDAY=WE',
    ]),
    // Ligger 15 uker frem: innenfor det nye vinduet, utenfor det gamle.
    event('julekonsert', 'Julekonsert', [
      'DTSTART;TZID=Europe/Oslo:20261212T180000',
      'DTEND;TZID=Europe/Oslo:20261212T200000',
    ]),
    // Månedsskifte: siste kveld i oktober og første natt i november.
    event('oktober-siste', 'Halloweenspilling', [
      'DTSTART;TZID=Europe/Oslo:20261031T233000',
      'DTEND;TZID=Europe/Oslo:20261101T000000',
    ]),
    event('november-forste', 'Nattevakt', [
      'DTSTART;TZID=Europe/Oslo:20261101T003000',
      'DTEND;TZID=Europe/Oslo:20261101T013000',
    ]),
  )

  const events = expandEvents(feed, calendarWindow(NOW))
  const uids = events.map((e) => e.uid)

  it('tar med hendelser etter den gamle åttevekersgrensen', () => {
    expect(uids).toContain('julekonsert')
    expect(expandEvents(feed, OLD_WINDOW).map((e) => e.uid)).not.toContain('julekonsert')
  })

  it('mister ingenting ved månedsskiftet', () => {
    expect(uids).toContain('oktober-siste')
    expect(uids).toContain('november-forste')
    // De havner i hver sin månedsgruppe i /kalender, ikke i samme.
    const boundary = events.filter((e) => e.uid === 'oktober-siste' || e.uid === 'november-forste')
    expect(months(boundary)).toEqual(['2026-10', '2026-11'])
  })

  it('dekker fire kalendermåneder etter inneværende', () => {
    expect(months(events)).toEqual(['2026-09', '2026-10', '2026-11', '2026-12'])
  })

  it('ekspanderer den ukentlige øvelsen helt ut i vinduet', () => {
    const ovelser = events.filter((e) => e.uid === 'ovelse')
    // 17 uker med ukentlig øvelse — den siste ligger i romjulen.
    expect(ovelser.length).toBe(17)
    expect(osloDate.format(new Date(ovelser[ovelser.length - 1]!.start))).toBe('2026-12-23')
  })
})

describe('CALENDAR_MAX_EVENTS', () => {
  it('avkorter ikke en tett kalender i stillhet', () => {
    // Verste realistiske tilfelle: noe hver eneste dag hele vinduet gjennom,
    // pluss ukentlige øvelser og tilsynsvakter. Under det gamle taket på 200
    // ville dette blitt beskåret uten at noen fikk beskjed.
    const feed = ics(
      event('tilsyn', 'Tilsynsvakt', ['DTSTART;TZID=Europe/Oslo:20260901T080000', 'RRULE:FREQ=DAILY']),
      event('dugnad', 'Dugnadsvakt', ['DTSTART;TZID=Europe/Oslo:20260901T120000', 'RRULE:FREQ=DAILY']),
      event('ovelse', 'Øvelse', ['DTSTART;TZID=Europe/Oslo:20260902T190000', 'RRULE:FREQ=WEEKLY;BYDAY=WE']),
      event('seksjon', 'Seksjonsøvelse', ['DTSTART;TZID=Europe/Oslo:20260905T100000', 'RRULE:FREQ=WEEKLY;BYDAY=SA']),
    )
    const events = expandEvents(feed, calendarWindow(NOW))

    expect(events.length).toBeGreaterThan(200)
    expect(events.length).toBeLessThan(CALENDAR_MAX_EVENTS)
    // Slutten av vinduet er fortsatt med — det er ikke taket som stopper lista.
    // Vinduet lukker kl. 08:00 den 29., så siste hele dag er den 28.
    expect(osloDate.format(new Date(events[events.length - 1]!.start))).toBe('2026-12-28')
  })
})
