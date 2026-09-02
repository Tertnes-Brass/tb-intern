import { describe, expect, it } from 'vitest'
import {
  cleanLines,
  cleanText,
  hasEventPractical,
  nextProjectTime,
  parseClockTime,
  parseContactPhone,
  parseEventPracticalInput,
  parseIsoDate,
  parseMapUrl,
  parseProjectTimeInput,
  projectTimeTitle,
  sortProjectTimes,
} from './practical'

describe('parseClockTime', () => {
  it('normaliserer det folk faktisk skriver', () => {
    expect(parseClockTime('19:30')).toBe('19:30')
    expect(parseClockTime('1930')).toBe('19:30')
    expect(parseClockTime('19.30')).toBe('19:30')
    expect(parseClockTime(' 9:05 ')).toBe('09:05')
    expect(parseClockTime('0000')).toBe('00:00')
    expect(parseClockTime('23:59')).toBe('23:59')
  })

  it('tomt felt er null, ikke tom streng', () => {
    expect(parseClockTime('')).toBeNull()
    expect(parseClockTime('   ')).toBeNull()
    expect(parseClockTime(null)).toBeNull()
    expect(parseClockTime(undefined)).toBeNull()
  })

  it('avviser klokkeslett som ikke finnes', () => {
    expect(() => parseClockTime('24:00')).toThrow(/klokkeslett/i)
    expect(() => parseClockTime('19:60')).toThrow(/klokkeslett/i)
    expect(() => parseClockTime('kvart over sju')).toThrow(/klokkeslett/i)
    expect(() => parseClockTime('19:3')).toThrow(/klokkeslett/i)
  })
})

describe('parseIsoDate', () => {
  it('godtar en ekte dato', () => {
    expect(parseIsoDate('2026-09-19')).toBe('2026-09-19')
    expect(parseIsoDate('2028-02-29')).toBe('2028-02-29')
  })

  it('avviser en dato som ikke finnes', () => {
    expect(() => parseIsoDate('2026-02-31')).toThrow(/dato/i)
    expect(() => parseIsoDate('2026-13-01')).toThrow(/dato/i)
    expect(() => parseIsoDate('19. september')).toThrow(/dato/i)
    expect(() => parseIsoDate('')).toThrow(/dato/i)
  })
})

describe('parseMapUrl', () => {
  it('godtar http og https', () => {
    expect(parseMapUrl('https://maps.app.goo.gl/abc')).toBe('https://maps.app.goo.gl/abc')
    expect(parseMapUrl('http://kart.no/x')).toBe('http://kart.no/x')
  })

  it('tomt er null', () => {
    expect(parseMapUrl('')).toBeNull()
    expect(parseMapUrl(null)).toBeNull()
  })

  it('avviser alt annet enn http(s) — også med kontrolltegn imellom', () => {
    expect(() => parseMapUrl('\u0000javascript:alert(1)')).toThrow(/http/i)
    expect(() => parseMapUrl('java\tscript:alert(1)')).toThrow(/http/i)
    expect(() => parseMapUrl('data:text/html,<script>')).toThrow(/http/i)
    expect(() => parseMapUrl('/kart')).toThrow(/http/i)
    // Usynlige tegn foran skjemaet skal ikke kunne gjemme et annet skjema —
    // og de skal heller ikke velte en lenke som ER gyldig.
    expect(() => parseMapUrl('\u200bjavascript:alert(1)')).toThrow(/http/i)
    expect(parseMapUrl('\ufeffhttps://kart.no')).toBe('https://kart.no')
  })
})

describe('parseContactPhone', () => {
  it('beholder nummeret slik det er skrevet', () => {
    expect(parseContactPhone('+47 900 12 345')).toBe('+47 900 12 345')
    expect(parseContactPhone('90012345')).toBe('90012345')
  })

  it('avviser tekst', () => {
    expect(() => parseContactPhone('ring Kim')).toThrow(/telefonnummer/i)
  })

  it('tomt er null', () => {
    expect(parseContactPhone('  ')).toBeNull()
  })
})

describe('cleanText / cleanLines', () => {
  it('cleanText slår sammen mellomrom og kutter på maks', () => {
    expect(cleanText('  Åsane   kulturhus \n stor sal ', 100)).toBe('Åsane kulturhus stor sal')
    expect(cleanText('abcdef', 3)).toBe('abc')
    expect(cleanText('   ', 10)).toBeNull()
  })

  it('cleanLines beholder linjeskift, men ikke tomme blokker', () => {
    expect(cleanLines('Kim\n  Silje \n\n\n Ola ', 100)).toBe('Kim\nSilje\n\nOla')
    expect(cleanLines('\n\n', 100)).toBeNull()
  })

  it('fjerner usynlige kontrolltegn', () => {
    expect(cleanText('Tert\u0000nes\u200b', 100)).toBe('Tertnes')
    expect(cleanLines('Kim\u0000\nSilje', 100)).toBe('Kim\nSilje')
  })
})

describe('parseProjectTimeInput', () => {
  const base = { kind: 'konsertstart', date: '2026-09-19' }

  it('normaliserer et helt tidspunkt', () => {
    expect(
      parseProjectTimeInput({
        ...base,
        time: '1900',
        label: '  Konsertstart, dørene 18:30 ',
        location: ' Åsane  kulturhus ',
        audience: 'alle',
        note: ' Full uniform ',
        responsibleName: ' Kim Systad ',
        contactPhone: '+47 900 12 345',
      }),
    ).toEqual({
      kind: 'konsertstart',
      label: 'Konsertstart, dørene 18:30',
      date: '2026-09-19',
      time: '19:00',
      location: 'Åsane kulturhus',
      audience: 'alle',
      note: 'Full uniform',
      responsibleUserId: null,
      responsibleName: 'Kim Systad',
      contactPhone: '+47 900 12 345',
    })
  })

  it('standardverdier: type «annet» krever navn, målgruppe er «alle»', () => {
    expect(parseProjectTimeInput({ date: '2026-09-19', label: 'Kaffe' }).audience).toBe('alle')
    expect(() => parseProjectTimeInput({ date: '2026-09-19' })).toThrow(/navn/i)
  })

  it('et medlem som ansvarlig vinner over et fritekstnavn', () => {
    const value = parseProjectTimeInput({
      ...base,
      responsibleUserId: 'u1',
      responsibleName: 'Skrivefeil fra skjemaet',
    })
    expect(value.responsibleUserId).toBe('u1')
    expect(value.responsibleName).toBeNull()
  })

  it('avviser ukjent type og målgruppe', () => {
    expect(() => parseProjectTimeInput({ ...base, kind: 'lunsj' })).toThrow(/type/i)
    expect(() => parseProjectTimeInput({ ...base, audience: 'naboene' })).toThrow(/målgruppe/i)
  })

  it('tidspunkt uten klokkeslett er lov', () => {
    expect(parseProjectTimeInput({ ...base, kind: 'oppmote_lasting', time: '' }).time).toBeNull()
  })
})

describe('projectTimeTitle', () => {
  it('bruker egen etikett når den finnes', () => {
    expect(projectTimeTitle({ kind: 'konsertstart', label: 'Andre sett' })).toBe('Andre sett')
  })

  it('faller tilbake til typens navn', () => {
    expect(projectTimeTitle({ kind: 'oppmote_rigg', label: null })).toBe('Oppmøte rigg i lokalet')
  })

  it('en ukjent type (fra en eldre rad) blir «Tidspunkt», aldri rå nøkkel', () => {
    expect(projectTimeTitle({ kind: 'noe_helt_annet', label: null })).toBe('Tidspunkt')
  })
})

describe('sortProjectTimes', () => {
  it('sorterer kronologisk på dato og klokkeslett', () => {
    const sorted = sortProjectTimes([
      { date: '2026-09-19', time: '19:00', kind: 'konsertstart' },
      { date: '2026-09-18', time: '18:00', kind: 'ovingsstart' },
      { date: '2026-09-19', time: '15:00', kind: 'oppmote_rigg' },
    ])
    expect(sorted.map((t) => t.time)).toEqual(['18:00', '15:00', '19:00'])
  })

  it('punkt uten klokkeslett kommer sist samme dag', () => {
    const sorted = sortProjectTimes([
      { date: '2026-09-19', time: null, kind: 'oppmote_lasting' },
      { date: '2026-09-19', time: '19:00', kind: 'konsertstart' },
    ])
    expect(sorted.map((t) => t.time)).toEqual(['19:00', null])
  })

  it('typens rekkefølge avgjør når klokkeslettet er likt', () => {
    const sorted = sortProjectTimes([
      { date: '2026-09-19', time: '15:00', kind: 'konsertstart' },
      { date: '2026-09-19', time: '15:00', kind: 'oppmote_lasting' },
    ])
    expect(sorted.map((t) => t.kind)).toEqual(['oppmote_lasting', 'konsertstart'])
  })

  it('rører ikke lista som ble sendt inn', () => {
    const input = [
      { date: '2026-09-19', time: '19:00', kind: 'konsertstart' },
      { date: '2026-09-18', time: '18:00', kind: 'ovingsstart' },
    ]
    sortProjectTimes(input)
    expect(input[0]!.date).toBe('2026-09-19')
  })
})

describe('nextProjectTime', () => {
  const times = [
    { date: '2026-09-18', time: '18:00', kind: 'ovingsstart' },
    { date: '2026-09-19', time: '15:00', kind: 'oppmote_rigg' },
    { date: '2026-09-19', time: '19:00', kind: 'konsertstart' },
  ]

  it('finner det første punktet som ikke er passert', () => {
    expect(nextProjectTime(times, '2026-09-19', '16:00')?.time).toBe('19:00')
    expect(nextProjectTime(times, '2026-09-01', '08:00')?.time).toBe('18:00')
  })

  it('et punkt akkurat nå teller fortsatt som neste', () => {
    expect(nextProjectTime(times, '2026-09-19', '19:00')?.time).toBe('19:00')
  })

  it('null når alt er passert', () => {
    expect(nextProjectTime(times, '2026-09-20', '08:00')).toBeNull()
    expect(nextProjectTime([], '2026-09-20', '08:00')).toBeNull()
  })

  it('et punkt uten klokkeslett gjelder hele dagen', () => {
    const uspesifisert = [{ date: '2026-09-19', time: null, kind: 'oppmote_lasting' }]
    expect(nextProjectTime(uspesifisert, '2026-09-19', '23:00')).not.toBeNull()
    expect(nextProjectTime(uspesifisert, '2026-09-20', '00:01')).toBeNull()
  })
})

describe('parseEventPracticalInput', () => {
  it('normaliserer alle feltene', () => {
    expect(
      parseEventPracticalInput({
        locationName: '  Tertnes  skole ',
        locationAddress: ' Snellingen 1, 5113 Tertnes ',
        mapUrl: ' https://maps.app.goo.gl/x ',
        meetupCrew: '1700',
        meetupMusicians: '18.15',
        conductor: ' Ingrid  Vik ',
        keyholder: ' Kim ',
        crew: ' Kim \n Silje \n\n\n Ola ',
        substitutes: 'Ola (2. kornett)',
        practicalNote: 'Parkering bak bygget',
      }),
    ).toEqual({
      locationName: 'Tertnes skole',
      locationAddress: 'Snellingen 1, 5113 Tertnes',
      mapUrl: 'https://maps.app.goo.gl/x',
      meetupCrew: '17:00',
      meetupMusicians: '18:15',
      conductor: 'Ingrid Vik',
      keyholder: 'Kim',
      crew: 'Kim\nSilje\n\nOla',
      substitutes: 'Ola (2. kornett)',
      practicalNote: 'Parkering bak bygget',
    })
  })

  it('en tom øving gir bare null-felt', () => {
    const value = parseEventPracticalInput({})
    expect(Object.values(value).every((v) => v === null)).toBe(true)
    expect(hasEventPractical(value)).toBe(false)
  })

  it('hasEventPractical er sann så snart ett felt er fylt ut', () => {
    expect(hasEventPractical(parseEventPracticalInput({ keyholder: 'Kim' }))).toBe(true)
    expect(hasEventPractical(null)).toBe(false)
  })

  it('en ugyldig kartlenke velter hele lagringen', () => {
    expect(() => parseEventPracticalInput({ mapUrl: 'javascript:alert(1)' })).toThrow(/http/i)
  })
})
