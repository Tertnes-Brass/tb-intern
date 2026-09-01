import { describe, expect, it } from 'vitest'
import {
  attendanceScope,
  attendanceSourceFor,
  attendanceSummary,
  canSeeMemberAttendance,
  canSetAttendanceFor,
  countAttendance,
  groupBySection,
  normalizeAttendanceComment,
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

describe('countAttendance og attendanceSummary', () => {
  const rows = [
    { status: 'attending' as const },
    { status: 'attending' as const },
    { status: 'not_attending' as const },
    { status: 'unsure' as const },
    { status: null },
  ]

  it('teller hver status og de som ikke har svart', () => {
    expect(countAttendance(rows)).toEqual({ attending: 2, notAttending: 1, unsure: 1, noReply: 1, total: 5 })
  })

  it('skriver tallene på norsk, med riktig entall/flertall', () => {
    expect(attendanceSummary(countAttendance(rows))).toBe('2 kommer · 1 kommer ikke · 1 usikker · 1 uten svar')
    expect(
      attendanceSummary(countAttendance([{ status: 'unsure' }, { status: 'unsure' }])),
    ).toBe('2 usikre')
  })

  it('sier fra når ingen har svart', () => {
    expect(attendanceSummary(countAttendance([]))).toBe('Ingen svar ennå')
    expect(attendanceSummary(countAttendance([{ status: null }]))).toBe('1 uten svar')
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
