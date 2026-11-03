import { describe, expect, it } from 'vitest'
import {
  attendanceScope,
  attendanceSourceFor,
  attendanceSummary,
  canSeeMemberAttendance,
  canSetAttendanceFor,
  composeAbsenceComment,
  countAttendance,
  effectiveStatus,
  groupBySection,
  hasReportedAbsence,
  normalizeAttendanceComment,
  splitAbsenceComment,
} from './attendance'

const medlem = { id: 'u-medlem', permissions: ['scores.view'], leadsPartIds: [] }
const fravaersansvarlig = { id: 'u-fravaer', permissions: ['attendance.manage'], leadsPartIds: [] }
const admin = { id: 'u-admin', permissions: ['*'], leadsPartIds: [] }
const kornettleder = { id: 'u-leder', permissions: [], leadsPartIds: ['solo-cornet', 'second-cornet'] }

const ingrid = { id: 'u-ingrid', partIds: ['solo-cornet'] }
const karim = { id: 'u-karim', partIds: ['eb-bass'] }

describe('attendanceScope', () => {
  it('gir fullt innsyn til attendance.manage og til admin', () => {
    expect(attendanceScope(fravaersansvarlig)).toEqual({ kind: 'all' })
    expect(attendanceScope(admin)).toEqual({ kind: 'all' })
  })

  it('gir gruppelederen sine egne seksjoner', () => {
    expect(attendanceScope(kornettleder)).toEqual({ kind: 'sections', partIds: ['solo-cornet', 'second-cornet'] })
  })

  it('gir et vanlig medlem kun seg selv', () => {
    expect(attendanceScope(medlem)).toEqual({ kind: 'self' })
    expect(attendanceScope(null)).toEqual({ kind: 'self' })
  })
})

describe('canSeeMemberAttendance', () => {
  it('lar alle se sin egen rad', () => {
    expect(canSeeMemberAttendance(medlem, { id: medlem.id, partIds: ['flugel'] })).toBe(true)
  })

  it('skjuler andres rader for et vanlig medlem', () => {
    expect(canSeeMemberAttendance(medlem, ingrid)).toBe(false)
    expect(canSeeMemberAttendance(medlem, karim)).toBe(false)
  })

  it('gir gruppelederen navnene i egen seksjon, men ikke i andres', () => {
    expect(canSeeMemberAttendance(kornettleder, ingrid)).toBe(true)
    expect(canSeeMemberAttendance(kornettleder, karim)).toBe(false)
  })

  it('gir fraværsansvarlig og admin alle', () => {
    for (const viewer of [fravaersansvarlig, admin]) {
      expect(canSeeMemberAttendance(viewer, ingrid)).toBe(true)
      expect(canSeeMemberAttendance(viewer, karim)).toBe(true)
    }
  })
})

describe('canSetAttendanceFor', () => {
  it('lar et medlem svare for seg selv', () => {
    expect(canSetAttendanceFor(medlem, { id: medlem.id, partIds: [] })).toBe(true)
  })

  it('lar ingen svare på andres vegne uten rett', () => {
    expect(canSetAttendanceFor(medlem, ingrid)).toBe(false)
  })

  it('lar fraværsansvarlig og admin sette status for hvem som helst', () => {
    expect(canSetAttendanceFor(fravaersansvarlig, karim)).toBe(true)
    expect(canSetAttendanceFor(admin, karim)).toBe(true)
  })

  it('begrenser gruppelederen til egen seksjon', () => {
    expect(canSetAttendanceFor(kornettleder, ingrid)).toBe(true)
    expect(canSetAttendanceFor(kornettleder, karim)).toBe(false)
  })

  it('teller stemme-treffet, ikke rekkefølgen på stemmene', () => {
    expect(canSetAttendanceFor(kornettleder, { id: 'u-x', partIds: ['euphonium', 'second-cornet'] })).toBe(true)
  })
})

describe('attendanceSourceFor', () => {
  it('skiller egen RSVP fra administrert fravær', () => {
    expect(attendanceSourceFor(fravaersansvarlig, fravaersansvarlig.id)).toBe('self')
    expect(attendanceSourceFor(fravaersansvarlig, ingrid.id)).toBe('admin')
  })
})

describe('countAttendance og attendanceSummary — fravær er unntaket', () => {
  const rows = [
    { status: 'attending' as const },
    { status: 'attending' as const },
    { status: 'not_attending' as const },
    { status: 'unsure' as const },
    { status: null },
  ]

  it('regner alle uten fravær som kommer — ingen rad og «attending» er det samme', () => {
    expect(countAttendance(rows)).toEqual({ attending: 3, notAttending: 1, unsure: 1, total: 5 })
    expect(countAttendance([{ status: null }, { status: null }])).toEqual({
      attending: 2,
      notAttending: 0,
      unsure: 0,
      total: 2,
    })
  })

  it('skriver tallene på norsk, med riktig entall/flertall', () => {
    expect(attendanceSummary(countAttendance(rows))).toBe('3 kommer · 1 kan ikke · 1 usikker')
    expect(attendanceSummary(countAttendance([{ status: 'unsure' }, { status: 'unsure' }]))).toBe(
      '0 kommer · 2 usikre',
    )
  })

  it('sier at alle kommer når ingen har meldt fravær', () => {
    expect(attendanceSummary(countAttendance([{ status: null }, { status: null }]))).toBe('2 kommer')
    expect(attendanceSummary(countAttendance([]))).toBe('Ingen aktive medlemmer')
  })
})

describe('effectiveStatus og hasReportedAbsence', () => {
  it('leser manglende rad og «attending» som kommer', () => {
    expect(effectiveStatus(null)).toBe('attending')
    expect(effectiveStatus(undefined)).toBe('attending')
    expect(effectiveStatus('attending')).toBe('attending')
    expect(hasReportedAbsence(null)).toBe(false)
    expect(hasReportedAbsence('attending')).toBe(false)
  })

  it('beholder fravær og (gamle) «usikker»-rader', () => {
    expect(effectiveStatus('not_attending')).toBe('not_attending')
    expect(effectiveStatus('unsure')).toBe('unsure')
    expect(hasReportedAbsence('not_attending')).toBe(true)
    expect(hasReportedAbsence('unsure')).toBe(true)
  })
})

describe('composeAbsenceComment og splitAbsenceComment', () => {
  it('setter sammen grunn og fritekst, og gjør tomt til null', () => {
    expect(composeAbsenceComment('Jobb', '  rekker siste halvtime ')).toBe('Jobb – rekker siste halvtime')
    expect(composeAbsenceComment('Syk', '')).toBe('Syk')
    expect(composeAbsenceComment(null, 'på tur')).toBe('på tur')
    expect(composeAbsenceComment(null, '   ')).toBeNull()
  })

  it('tar grunnen ut igjen, så den ikke legges til to ganger ved endring', () => {
    expect(splitAbsenceComment('Jobb – rekker siste halvtime')).toEqual({ reason: 'Jobb', text: 'rekker siste halvtime' })
    expect(splitAbsenceComment('Syk')).toEqual({ reason: 'Syk', text: '' })
    expect(splitAbsenceComment('Meldt fra på telefon')).toEqual({ reason: null, text: 'Meldt fra på telefon' })
    expect(splitAbsenceComment(null)).toEqual({ reason: null, text: '' })
  })

  it('gjenkjenner bare hele hurtigvalg, ikke et ord som tilfeldigvis starter likt', () => {
    expect(splitAbsenceComment('Jobbmøte i Oslo')).toEqual({ reason: null, text: 'Jobbmøte i Oslo' })
  })

  it('er hverandres motsatte', () => {
    for (const [reason, text] of [
      ['Reise', 'fly hjem 21:00'],
      ['Annet', ''],
      [null, 'kommer etter pausen'],
    ] as const) {
      expect(splitAbsenceComment(composeAbsenceComment(reason, text))).toEqual({ reason, text })
    }
  })
})

describe('groupBySection', () => {
  it('grupperer i besetningens rekkefølge og hopper over tomme grupper', () => {
    const groups = groupBySection([
      { id: '1', name: 'Karim', section: 'tuba', sortOrder: 170 },
      { id: '2', name: 'Ingrid', section: 'cornet', sortOrder: 30 },
      { id: '3', name: 'Astrid', section: 'horn', sortOrder: 70 },
      { id: '4', name: 'Bo', section: 'cornet', sortOrder: 20 },
    ])
    expect(groups.map((g) => g.section)).toEqual(['cornet', 'horn', 'tuba'])
    expect(groups[0]!.label).toBe('Kornetter')
    // Innen gruppen: stemmens rekkefølge først, så navn.
    expect(groups[0]!.members.map((m) => m.name)).toEqual(['Bo', 'Ingrid'])
  })

  it('samler medlemmer uten stemme til slutt', () => {
    const groups = groupBySection([
      { id: '1', name: 'Uten', section: null, sortOrder: 999 },
      { id: '2', name: 'Ingrid', section: 'cornet', sortOrder: 30 },
    ])
    expect(groups.map((g) => g.section)).toEqual(['cornet', 'none'])
    expect(groups[1]!.label).toBe('Uten stemmegruppe')
  })

  it('tåler en ukjent seksjonsverdi uten å miste medlemmet', () => {
    const groups = groupBySection([{ id: '1', name: 'Rar', section: 'saxofon', sortOrder: 1 }])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.section).toBe('none')
  })
})

describe('normalizeAttendanceComment', () => {
  it('trimmer, slår sammen mellomrom og gjør tomt til null', () => {
    expect(normalizeAttendanceComment('  kommer   19:30 ')).toBe('kommer 19:30')
    expect(normalizeAttendanceComment('   ')).toBeNull()
    expect(normalizeAttendanceComment(null)).toBeNull()
  })

  it('kutter en lang kommentar — feltet er ikke et fraværsskjema', () => {
    expect(normalizeAttendanceComment('a'.repeat(500))).toHaveLength(200)
  })
})
