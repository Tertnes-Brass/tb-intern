import { describe, expect, it } from 'vitest'
import {
  NO_SEASON,
  type SeasonalProject,
  groupBySeason,
  isUpcoming,
  seasonForDate,
  sortProjects,
} from './project-list'

const TODAY = '2026-06-01'

// To sesonger med kommende prosjekt, én ren historikk-sesong og ett prosjekt
// uten dato/sesong. Inn-rekkefølgen er bevisst rotete (som SQL kan gi).
const sommerkonsert = {
  name: 'Sommerkonsert',
  eventDate: '2026-06-24',
  seasonName: 'Vår 2026',
  seasonStartsOn: '2026-01-01',
}
const nmBrass = {
  name: 'NM Brass',
  eventDate: '2026-02-07',
  seasonName: 'Vår 2026',
  seasonStartsOn: '2026-01-01',
}
const julekonsert = {
  name: 'Julekonsert',
  eventDate: '2025-12-13',
  seasonName: 'Høst 2025',
  seasonStartsOn: '2025-08-01',
}
const vinterseminar = {
  name: 'Vinterseminar',
  eventDate: '2027-01-16',
  seasonName: 'Vår 2027',
  seasonStartsOn: '2027-01-01',
}
const uplanlagt = { name: 'Uplanlagt tur', eventDate: null, seasonName: null, seasonStartsOn: null }

const band: SeasonalProject[] = [nmBrass, vinterseminar, uplanlagt, julekonsert, sommerkonsert]

const names = (rows: readonly SeasonalProject[]) => rows.map((r) => r.name)

describe('isUpcoming', () => {
  it('i dag regnes som kommende, i går ikke, og datoløs aldri', () => {
    expect(isUpcoming(TODAY, TODAY)).toBe(true)
    expect(isUpcoming('2026-05-31', TODAY)).toBe(false)
    expect(isUpcoming(null, TODAY)).toBe(false)
  })
})

describe('sortProjects', () => {
  it('standard: kommende først (nærmeste øverst), så avholdte (ferskeste øverst)', () => {
    expect(names(sortProjects(band, 'standard', TODAY))).toEqual([
      'Sommerkonsert', // 2026-06-24, nærmeste kommende
      'Vinterseminar', // 2027-01-16
      'NM Brass', // 2026-02-07, sist avholdte
      'Julekonsert', // 2025-12-13
      'Uplanlagt tur', // uten dato
    ])
  })

  it('dato-stigende og dato-synkende er ren kronologi, uansett om prosjektet er avholdt', () => {
    expect(names(sortProjects(band, 'dato-stigende', TODAY))).toEqual([
      'Julekonsert',
      'NM Brass',
      'Sommerkonsert',
      'Vinterseminar',
      'Uplanlagt tur',
    ])
    expect(names(sortProjects(band, 'dato-synkende', TODAY))).toEqual([
      'Vinterseminar',
      'Sommerkonsert',
      'NM Brass',
      'Julekonsert',
      'Uplanlagt tur',
    ])
  })

  it('datoløse prosjekter havner sist i alle sorteringer', () => {
    for (const sort of ['standard', 'dato-stigende', 'dato-synkende'] as const) {
      expect(names(sortProjects(band, sort, TODAY)).at(-1)).toBe('Uplanlagt tur')
    }
  })

  it('lik dato brytes på navn med norsk kollasjon — også blant avholdte', () => {
    const sameDay: SeasonalProject[] = [
      { ...sommerkonsert, name: 'Ådalskonsert' },
      { ...sommerkonsert, name: 'Bergenskonsert' },
      { ...nmBrass, name: 'Åsane-seminar' },
      { ...nmBrass, name: 'Bystevne' },
    ]
    // Æ/Ø/Å sorterer sist på norsk, og navnerekkefølgen er stigende i begge
    // retninger så lista ikke hopper rundt mellom to like datoer.
    expect(names(sortProjects(sameDay, 'standard', TODAY))).toEqual([
      'Bergenskonsert',
      'Ådalskonsert',
      'Bystevne',
      'Åsane-seminar',
    ])
  })

  it('datoløse prosjekter sorteres seg imellom på navn', () => {
    const undated: SeasonalProject[] = [
      { ...uplanlagt, name: 'Vårtur' },
      { ...uplanlagt, name: 'Høsttur' },
    ]
    expect(names(sortProjects(undated, 'standard', TODAY))).toEqual(['Høsttur', 'Vårtur'])
  })

  it('rører ikke inn-lista', () => {
    const before = names(band)
    sortProjects(band, 'standard', TODAY)
    expect(names(band)).toEqual(before)
  })

  it('tomt inn → tomt ut', () => {
    expect(sortProjects([], 'standard', TODAY)).toEqual([])
  })
})

describe('groupBySeason', () => {
  const grouped = (sort: 'standard' | 'dato-stigende' | 'dato-synkende') =>
    groupBySeason(sortProjects(band, sort, TODAY), sort, TODAY)

  it('standard: sesonger med kommende prosjekt først (stigende), historikken bakerst (ferskeste øverst)', () => {
    // «Vår 2026» startet før i dag, men har et kommende prosjekt — den skal
    // likevel ligge foran «Høst 2025», som bare er historikk.
    expect(grouped('standard').map((g) => g.name)).toEqual([
      'Vår 2026',
      'Vår 2027',
      'Høst 2025',
      NO_SEASON,
    ])
  })

  it('sesongrekkefølgen følger startdato, ikke sesongnavnet, og speiler sorteringen', () => {
    expect(grouped('dato-stigende').map((g) => g.name)).toEqual([
      'Høst 2025',
      'Vår 2026',
      'Vår 2027',
      NO_SEASON,
    ])
    expect(grouped('dato-synkende').map((g) => g.name)).toEqual([
      'Vår 2027',
      'Vår 2026',
      'Høst 2025',
      NO_SEASON,
    ])
  })

  it('beholder rekkefølgen fra sortProjects innenfor hver sesong', () => {
    const spring = grouped('standard').find((g) => g.name === 'Vår 2026')
    expect(names(spring!.projects)).toEqual(['Sommerkonsert', 'NM Brass'])
  })

  it('flagger hvilke sesonger som har noe kommende, og tar med startdato', () => {
    const groups = grouped('standard')
    expect(groups.map((g) => [g.name, g.hasUpcoming, g.startsOn])).toEqual([
      ['Vår 2026', true, '2026-01-01'],
      ['Vår 2027', true, '2027-01-01'],
      ['Høst 2025', false, '2025-08-01'],
      [NO_SEASON, false, null],
    ])
  })

  it('samler prosjekter uten sesong i én gruppe til slutt', () => {
    const groups = groupBySeason(
      [{ ...uplanlagt, name: 'B-tur' }, sommerkonsert, { ...uplanlagt, name: 'A-tur' }],
      'standard',
      TODAY,
    )
    expect(groups.map((g) => g.name)).toEqual(['Vår 2026', NO_SEASON])
    expect(names(groups[1]!.projects)).toEqual(['B-tur', 'A-tur'])
  })

  it('tomt inn → tomt ut', () => {
    expect(groupBySeason([], 'standard', TODAY)).toEqual([])
  })
})

describe('seasonForDate', () => {
  it('vår er januar–juli, høst er august–desember', () => {
    expect(seasonForDate('2026-01-01')).toEqual({
      name: 'Vår 2026',
      startsOn: '2026-01-01',
      endsOn: '2026-07-31',
    })
    expect(seasonForDate('2026-12-13')).toEqual({
      name: 'Høst 2026',
      startsOn: '2026-08-01',
      endsOn: '2026-12-31',
    })
  })

  it('grensen mellom vår og høst går mellom 31. juli og 1. august', () => {
    expect(seasonForDate('2026-07-31').name).toBe('Vår 2026')
    expect(seasonForDate('2026-08-01').name).toBe('Høst 2026')
  })

  it('intervallet dekker datoen sin, slik at oppslag på intervall treffer', () => {
    for (const date of ['2026-01-01', '2026-04-17', '2026-07-31', '2026-08-01', '2026-12-31']) {
      const season = seasonForDate(date)
      expect(season.startsOn <= date && date <= season.endsOn).toBe(true)
    }
  })
})
