import { describe, expect, it } from 'vitest'
import { expandEvents, parseDuration, unfoldLines } from './ical'
import { occurrenceKey, parseOccurrenceKey } from './occurrence'

/**
 * Fixture som ligner en ekte Google Calendar-eksport («Hemmelig adresse i
 * iCal-format»): VTIMEZONE-blokk, brettede linjer, escapede tegn, ukentlig
 * øvelse med EXDATE, én endret forekomst (RECURRENCE-ID), enkelthendelse,
 * heldagshendelse, avlyst hendelse og en UTC-tid.
 *
 * Kalenderåret er 2026. Sommertiden i Norge starter søndag 29. mars 2026 og
 * slutter søndag 25. oktober 2026 — øvelsene ligger med vilje på begge sider.
 */
const FIXTURE = `BEGIN:VCALENDAR\r
PRODID:-//Google Inc//Google Calendar 70.9054//EN\r
VERSION:2.0\r
CALSCALE:GREGORIAN\r
METHOD:PUBLISH\r
X-WR-CALNAME:Tertnes Brass\r
X-WR-TIMEZONE:Europe/Oslo\r
BEGIN:VTIMEZONE\r
TZID:Europe/Oslo\r
X-LIC-LOCATION:Europe/Oslo\r
BEGIN:DAYLIGHT\r
TZOFFSETFROM:+0100\r
TZOFFSETTO:+0200\r
TZNAME:CEST\r
DTSTART:19700329T020000\r
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\r
END:DAYLIGHT\r
BEGIN:STANDARD\r
TZOFFSETFROM:+0200\r
TZOFFSETTO:+0100\r
TZNAME:CET\r
DTSTART:19701025T030000\r
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r
END:STANDARD\r
END:VTIMEZONE\r
BEGIN:VEVENT\r
DTSTART;TZID=Europe/Oslo:20260107T190000\r
DTEND;TZID=Europe/Oslo:20260107T213000\r
RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=WE\r
EXDATE;TZID=Europe/Oslo:20260401T190000\r
DTSTAMP:20260601T120000Z\r
UID:ovelse@tertnesbrass.no\r
DESCRIPTION:Vanlig ukesøvelse. Ta med blyant\\, viskelær og godt humør.\\nMøt\r
  opp 18:45 for oppvarming.\r
LAST-MODIFIED:20260101T100000Z\r
LOCATION:Tertnes skole\\, musikkrommet\r
SEQUENCE:0\r
STATUS:CONFIRMED\r
SUMMARY:Øvelse\r
TRANSP:OPAQUE\r
BEGIN:VALARM\r
ACTION:DISPLAY\r
DESCRIPTION:This is an event reminder\r
TRIGGER:-P0DT0H30M0S\r
END:VALARM\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART;TZID=Europe/Oslo:20260325T183000\r
DTEND;TZID=Europe/Oslo:20260325T210000\r
DTSTAMP:20260601T120000Z\r
UID:ovelse@tertnesbrass.no\r
RECURRENCE-ID;TZID=Europe/Oslo:20260325T190000\r
LOCATION:Åsane kulturhus\r
SEQUENCE:1\r
STATUS:CONFIRMED\r
SUMMARY:Øvelse (generalprøve)\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART;TZID=Europe/Oslo:20260516T180000\r
DTEND;TZID=Europe/Oslo:20260516T200000\r
DTSTAMP:20260601T120000Z\r
UID:varkonsert@tertnesbrass.no\r
LOCATION:Grieghallen\r
STATUS:CONFIRMED\r
SUMMARY:Vårkonsert\r
URL:https://tertnesbrass.no/varkonsert\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART;VALUE=DATE:20260214\r
DTEND;VALUE=DATE:20260216\r
DTSTAMP:20260601T120000Z\r
UID:seminar@tertnesbrass.no\r
LOCATION:Voss\r
STATUS:CONFIRMED\r
SUMMARY:Seminarhelg\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART;TZID=Europe/Oslo:20260228T120000\r
DURATION:PT1H30M\r
DTSTAMP:20260601T120000Z\r
UID:avlyst@tertnesbrass.no\r
STATUS:CANCELLED\r
SUMMARY:Spillejobb (avlyst)\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART:20260210T170000Z\r
DURATION:PT1H\r
DTSTAMP:20260601T120000Z\r
UID:styremote@tertnesbrass.no\r
STATUS:CONFIRMED\r
SUMMARY:Styremøte\r
END:VEVENT\r
END:VCALENDAR\r
`

const YEAR_2026 = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-12-31T00:00:00Z') }

function ids(ics: string, options: Parameters<typeof expandEvents>[1]) {
  return expandEvents(ics, options).map((e) => `${e.title} ${e.start}`)
}

describe('unfoldLines', () => {
  it('slår sammen fortsettelseslinjer og dropper tomme linjer', () => {
    expect(unfoldLines('SUMMARY:Lang\r\n  tekst\r\n\r\nUID:1\r\n')).toEqual(['SUMMARY:Lang tekst', 'UID:1'])
  })

  it('håndterer tab som fortsettelsestegn og bare-LF', () => {
    expect(unfoldLines('A:1\n\tfortsatt\nB:2')).toEqual(['A:1fortsatt', 'B:2'])
  })
})

describe('parseDuration', () => {
  it('leser uker, dager, timer, minutter og sekunder', () => {
    expect(parseDuration('PT1H30M')).toBe(90 * 60_000)
    expect(parseDuration('P1D')).toBe(86_400_000)
    expect(parseDuration('P2W')).toBe(14 * 86_400_000)
    expect(parseDuration('PT45S')).toBe(45_000)
    expect(parseDuration('tull')).toBeNull()
  })
})

describe('expandEvents — Google-fixture', () => {
  it('leser enkelthendelse med TZID, sted og URL', () => {
    const konsert = expandEvents(FIXTURE, YEAR_2026).find((e) => e.uid === 'varkonsert@tertnesbrass.no')
    expect(konsert).toEqual({
      id: 'varkonsert@tertnesbrass.no',
      occurrenceKey: occurrenceKey('varkonsert@tertnesbrass.no', null),
      uid: 'varkonsert@tertnesbrass.no',
      title: 'Vårkonsert',
      // 16. mai er sommertid i Norge (UTC+2)
      start: '2026-05-16T16:00:00.000Z',
      end: '2026-05-16T18:00:00.000Z',
      allDay: false,
      location: 'Grieghallen',
      description: null,
      url: 'https://tertnesbrass.no/varkonsert',
    })
  })

  it('folder ut brettede linjer og escapede tegn i beskrivelsen', () => {
    const ovelse = expandEvents(FIXTURE, YEAR_2026).find((e) => e.uid === 'ovelse@tertnesbrass.no')!
    expect(ovelse.location).toBe('Tertnes skole, musikkrommet')
    expect(ovelse.description).toBe(
      'Vanlig ukesøvelse. Ta med blyant, viskelær og godt humør.\nMøt opp 18:45 for oppvarming.',
    )
  })

  it('lar ikke VALARM-egenskaper lekke opp på hendelsen', () => {
    const ovelse = expandEvents(FIXTURE, YEAR_2026).find((e) => e.uid === 'ovelse@tertnesbrass.no')!
    expect(ovelse.description).not.toContain('event reminder')
  })

  it('heldagshendelse starter ved midnatt norsk tid og varer til sluttdatoen', () => {
    const seminar = expandEvents(FIXTURE, YEAR_2026).find((e) => e.uid === 'seminar@tertnesbrass.no')!
    expect(seminar.allDay).toBe(true)
    // 14. februar 00:00 i Oslo (UTC+1) = 13. februar 23:00 UTC
    expect(seminar.start).toBe('2026-02-13T23:00:00.000Z')
    expect(seminar.end).toBe('2026-02-15T23:00:00.000Z')
  })

  it('tar med UTC-tider som de er', () => {
    const styremote = expandEvents(FIXTURE, YEAR_2026).find((e) => e.uid === 'styremote@tertnesbrass.no')!
    expect(styremote.start).toBe('2026-02-10T17:00:00.000Z')
    expect(styremote.end).toBe('2026-02-10T18:00:00.000Z')
  })

  it('utelater avlyste hendelser (STATUS:CANCELLED)', () => {
    expect(expandEvents(FIXTURE, YEAR_2026).some((e) => e.uid === 'avlyst@tertnesbrass.no')).toBe(false)
  })

  it('ekspanderer ukentlig øvelse på onsdager', () => {
    const januar = expandEvents(FIXTURE, {
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-02-01T00:00:00Z'),
    }).filter((e) => e.uid === 'ovelse@tertnesbrass.no')
    expect(januar.map((e) => e.start)).toEqual([
      '2026-01-07T18:00:00.000Z',
      '2026-01-14T18:00:00.000Z',
      '2026-01-21T18:00:00.000Z',
      '2026-01-28T18:00:00.000Z',
    ])
    // Egen id per forekomst, ellers kolliderer React-nøkler og lenker.
    expect(new Set(januar.map((e) => e.id)).size).toBe(4)
    expect(januar[0]!.id).toBe('ovelse@tertnesbrass.no#2026-01-07T18:00:00.000Z')
  })

  it('holder øvelsen på 19:00 norsk tid over sommertidsskiftet', () => {
    const rundtSkiftet = expandEvents(FIXTURE, {
      from: new Date('2026-03-14T00:00:00Z'),
      to: new Date('2026-04-30T00:00:00Z'),
    }).filter((e) => e.uid === 'ovelse@tertnesbrass.no')

    // Før 29. mars: UTC+1 ⇒ 18:00Z. Etter: UTC+2 ⇒ 17:00Z.
    expect(rundtSkiftet.map((e) => e.start)).toEqual([
      '2026-03-18T18:00:00.000Z',
      '2026-03-25T17:30:00.000Z', // endret forekomst, flyttet til 18:30
      '2026-04-08T17:00:00.000Z',
      '2026-04-15T17:00:00.000Z',
      '2026-04-22T17:00:00.000Z',
      '2026-04-29T17:00:00.000Z',
    ])
    // Alle tidspunktene er 19:00 norsk tid (bortsett fra den flyttede).
    const norskKlokke = rundtSkiftet.map((e) =>
      new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' }).format(
        new Date(e.start),
      ),
    )
    expect(norskKlokke).toEqual(['19:00', '18:30', '19:00', '19:00', '19:00', '19:00'])
  })

  it('hopper over EXDATE-forekomsten (1. april)', () => {
    const april = expandEvents(FIXTURE, {
      from: new Date('2026-03-30T00:00:00Z'),
      to: new Date('2026-04-10T00:00:00Z'),
    })
    expect(april.map((e) => e.start)).toEqual(['2026-04-08T17:00:00.000Z'])
  })

  it('bruker den endrede forekomsten (RECURRENCE-ID) i stedet for serien', () => {
    const uken = expandEvents(FIXTURE, {
      from: new Date('2026-03-23T00:00:00Z'),
      to: new Date('2026-03-30T00:00:00Z'),
    })
    expect(uken).toHaveLength(1)
    expect(uken[0]).toMatchObject({
      uid: 'ovelse@tertnesbrass.no',
      title: 'Øvelse (generalprøve)',
      location: 'Åsane kulturhus',
      start: '2026-03-25T17:30:00.000Z',
      end: '2026-03-25T20:00:00.000Z',
    })
  })

  it('sorterer stigende på starttidspunkt', () => {
    const events = expandEvents(FIXTURE, YEAR_2026)
    const starts = events.map((e) => e.start)
    expect([...starts].sort()).toEqual(starts)
  })

  it('respekterer maks antall (cap) og beholder de første i vinduet', () => {
    const alle = expandEvents(FIXTURE, YEAR_2026)
    const capped = expandEvents(FIXTURE, { ...YEAR_2026, max: 5 })
    expect(alle.length).toBeGreaterThan(5)
    expect(capped).toHaveLength(5)
    expect(capped).toEqual(alle.slice(0, 5))
  })

  it('holder seg innenfor tidsvinduet', () => {
    const from = new Date('2026-05-01T00:00:00Z')
    const to = new Date('2026-06-01T00:00:00Z')
    for (const event of expandEvents(FIXTURE, { from, to })) {
      expect(Date.parse(event.start)).toBeLessThan(to.getTime())
      expect(Date.parse(event.end ?? event.start)).toBeGreaterThan(from.getTime())
    }
  })

  it('tar med hendelser som pågår når vinduet åpner', () => {
    // Seminarhelgen 14.–15. februar, vindu som starter midt i den.
    const pagaende = expandEvents(FIXTURE, {
      from: new Date('2026-02-15T09:00:00Z'),
      to: new Date('2026-02-16T00:00:00Z'),
    })
    expect(pagaende.map((e) => e.uid)).toEqual(['seminar@tertnesbrass.no'])
  })
})

// ---------- Stabil identitet per forekomst (#82) ----------

const OVELSE = 'ovelse@tertnesbrass.no'

function ovelser(window: Parameters<typeof expandEvents>[1]) {
  return expandEvents(FIXTURE, window).filter((e) => e.uid === OVELSE)
}

describe('occurrenceKey på en forekomst', () => {
  it('er den samme når feeden leses på nytt med et annet vindu', () => {
    const smaltVindu = ovelser({ from: new Date('2026-01-05T00:00:00Z'), to: new Date('2026-01-10T00:00:00Z') })
    const heltAret = ovelser(YEAR_2026)
    expect(smaltVindu).toHaveLength(1)
    expect(smaltVindu[0]!.occurrenceKey).toBe(heltAret.find((e) => e.start === smaltVindu[0]!.start)!.occurrenceKey)
  })

  it('overlever at forekomsten flyttes (RECURRENCE-ID beholder den opprinnelige plassen)', () => {
    const flyttet = ovelser({ from: new Date('2026-03-23T00:00:00Z'), to: new Date('2026-03-30T00:00:00Z') })[0]!
    // Hendelsen starter 18:30 norsk tid, men nøkkelen peker på 19:00-plassen i
    // serien — ellers ville øvingsplanen blitt liggende igjen på et tidspunkt
    // som ikke finnes lenger.
    expect(flyttet.start).toBe('2026-03-25T17:30:00.000Z')
    expect(flyttet.occurrenceKey).toBe(occurrenceKey(OVELSE, '2026-03-25T18:00:00.000Z'))
    expect(parseOccurrenceKey(flyttet.occurrenceKey)).toEqual({
      uid: OVELSE,
      originalStart: '2026-03-25T18:00:00.000Z',
    })
  })

  it('gir ulik nøkkel for to forekomster av samme serie', () => {
    const januar = ovelser({ from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-02-01T00:00:00Z') })
    expect(januar).toHaveLength(4)
    expect(new Set(januar.map((e) => e.occurrenceKey)).size).toBe(4)
    expect(new Set(januar.map((e) => e.uid)).size).toBe(1)
  })

  it('en slettet forekomst (EXDATE) har ingen nøkkel i feeden — lokale data blir foreldreløse', () => {
    const slettet = occurrenceKey(OVELSE, '2026-04-01T17:00:00.000Z')
    expect(expandEvents(FIXTURE, YEAR_2026).some((e) => e.occurrenceKey === slettet)).toBe(false)
  })

  it('en enkelthendelse har uid-en som nøkkel, uten tidspunkt', () => {
    const konsert = expandEvents(FIXTURE, YEAR_2026).find((e) => e.uid === 'varkonsert@tertnesbrass.no')!
    expect(parseOccurrenceKey(konsert.occurrenceKey)).toEqual({
      uid: 'varkonsert@tertnesbrass.no',
      originalStart: null,
    })
  })

  it('alle forekomster i vinduet har unike, URL-trygge nøkler', () => {
    const alle = expandEvents(FIXTURE, YEAR_2026)
    expect(new Set(alle.map((e) => e.occurrenceKey)).size).toBe(alle.length)
    for (const event of alle) expect(encodeURIComponent(event.occurrenceKey)).toBe(event.occurrenceKey)
  })
})

// ---------- RRULE-varianter ----------

function ics(...vevent: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-TIMEZONE:Europe/Oslo', ...vevent, 'END:VCALENDAR'].join('\r\n')
}

function event(uid: string, lines: string[]): string {
  return ['BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${uid}`, ...lines, 'END:VEVENT'].join('\r\n')
}

describe('expandEvents — gjentakelsesregler', () => {
  it('COUNT begrenser serien fra seriens start, ikke fra vinduet', () => {
    const feed = ics(
      event('c', ['DTSTART;TZID=Europe/Oslo:20260107T190000', 'RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=3']),
    )
    expect(ids(feed, YEAR_2026)).toEqual([
      'c 2026-01-07T18:00:00.000Z',
      'c 2026-01-14T18:00:00.000Z',
      'c 2026-01-21T18:00:00.000Z',
    ])
    // Vindu etter at de tre forekomstene er brukt opp ⇒ ingenting.
    expect(ids(feed, { from: new Date('2026-02-01T00:00:00Z'), to: new Date('2026-03-01T00:00:00Z') })).toEqual([])
  })

  it('UNTIL i UTC stopper serien', () => {
    const feed = ics(
      event('u', ['DTSTART;TZID=Europe/Oslo:20260107T190000', 'RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20260121T175959Z']),
    )
    expect(ids(feed, YEAR_2026)).toEqual(['u 2026-01-07T18:00:00.000Z', 'u 2026-01-14T18:00:00.000Z'])
  })

  it('INTERVAL=2 gir annenhver uke', () => {
    const feed = ics(
      event('i', ['DTSTART;TZID=Europe/Oslo:20260107T190000', 'RRULE:FREQ=WEEKLY;BYDAY=WE;INTERVAL=2;COUNT=3']),
    )
    expect(ids(feed, YEAR_2026)).toEqual([
      'i 2026-01-07T18:00:00.000Z',
      'i 2026-01-21T18:00:00.000Z',
      'i 2026-02-04T18:00:00.000Z',
    ])
  })

  it('BYDAY med flere dager i samme uke', () => {
    const feed = ics(
      event('m', ['DTSTART;TZID=Europe/Oslo:20260105T190000', 'RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=MO,WE;COUNT=4']),
    )
    expect(ids(feed, YEAR_2026)).toEqual([
      'm 2026-01-05T18:00:00.000Z',
      'm 2026-01-07T18:00:00.000Z',
      'm 2026-01-12T18:00:00.000Z',
      'm 2026-01-14T18:00:00.000Z',
    ])
  })

  it('FREQ=DAILY med INTERVAL', () => {
    const feed = ics(event('d', ['DTSTART;TZID=Europe/Oslo:20260601T090000', 'RRULE:FREQ=DAILY;INTERVAL=3;COUNT=3']))
    expect(ids(feed, YEAR_2026)).toEqual([
      'd 2026-06-01T07:00:00.000Z',
      'd 2026-06-04T07:00:00.000Z',
      'd 2026-06-07T07:00:00.000Z',
    ])
  })

  it('FREQ=MONTHLY med BYDAY=2TU (andre tirsdag)', () => {
    const feed = ics(event('t', ['DTSTART;TZID=Europe/Oslo:20260113T180000', 'RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3']))
    expect(ids(feed, YEAR_2026)).toEqual([
      't 2026-01-13T17:00:00.000Z',
      't 2026-02-10T17:00:00.000Z',
      't 2026-03-10T17:00:00.000Z',
    ])
  })

  it('FREQ=MONTHLY med BYMONTHDAY=-1 (siste dag i måneden)', () => {
    const feed = ics(event('s', ['DTSTART;TZID=Europe/Oslo:20260131T120000', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3']))
    expect(ids(feed, YEAR_2026)).toEqual([
      's 2026-01-31T11:00:00.000Z',
      's 2026-02-28T11:00:00.000Z',
      's 2026-03-31T10:00:00.000Z',
    ])
  })

  it('FREQ=MONTHLY uten BY-regler hopper over måneder som mangler datoen', () => {
    const feed = ics(event('e', ['DTSTART;TZID=Europe/Oslo:20260131T120000', 'RRULE:FREQ=MONTHLY;COUNT=3']))
    expect(ids(feed, YEAR_2026)).toEqual([
      'e 2026-01-31T11:00:00.000Z',
      'e 2026-03-31T10:00:00.000Z',
      'e 2026-05-31T10:00:00.000Z',
    ])
  })

  it('FREQ=YEARLY holder dato og klokkeslett', () => {
    const feed = ics(event('a', ['DTSTART;TZID=Europe/Oslo:20260517T110000', 'RRULE:FREQ=YEARLY;COUNT=2']))
    expect(ids(feed, { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2028-01-01T00:00:00Z') })).toEqual([
      'a 2026-05-17T09:00:00.000Z',
      'a 2027-05-17T09:00:00.000Z',
    ])
  })

  it('en langtløpende ukeserie fra fortiden treffer et vindu langt frem', () => {
    const feed = ics(event('g', ['DTSTART;TZID=Europe/Oslo:20100106T190000', 'RRULE:FREQ=WEEKLY;BYDAY=WE']))
    expect(ids(feed, { from: new Date('2026-01-05T00:00:00Z'), to: new Date('2026-01-20T00:00:00Z') })).toEqual([
      'g 2026-01-07T18:00:00.000Z',
      'g 2026-01-14T18:00:00.000Z',
    ])
  })

  it('tåler ugyldig og tom input uten å kaste', () => {
    expect(expandEvents('', YEAR_2026)).toEqual([])
    expect(expandEvents('ikke en kalender i det hele tatt', YEAR_2026)).toEqual([])
    expect(expandEvents(ics(event('x', ['DTSTART:tull'])), YEAR_2026)).toEqual([])
  })

  it('hendelse uten SUMMARY får en lesbar tittel', () => {
    const feed = ics(['BEGIN:VEVENT', 'UID:u1', 'DTSTART;TZID=Europe/Oslo:20260601T090000', 'END:VEVENT'].join('\r\n'))
    expect(expandEvents(feed, YEAR_2026)[0]!.title).toBe('(uten tittel)')
  })
})
