import { describe, expect, it } from 'vitest'
import {
  type AccessCtx,
  memberCanAccessFile,
  memberCanSeeFile,
  shareAllows,
  sharedFileFrom,
} from './file-access'

const file = (kind: string, partId: string | null = null) => ({ kind, partId })

// Vanlig medlem med Slagverk 1, kan se partitur, ikke fullt arkivinnsyn.
const member: AccessCtx = {
  effectivePartIds: ['percussion-1'],
  sharedParts: [],
  sectionLeaderPartIds: [],
  canManageSection: false,
  canViewScore: true,
  canViewAll: false,
  inAccessibleProject: true,
}
// Stab/dirigent: fullt arkivinnsyn.
const viewAll: AccessCtx = {
  effectivePartIds: [],
  sharedParts: [],
  sectionLeaderPartIds: [],
  canManageSection: false,
  canViewScore: true,
  canViewAll: true,
  inAccessibleProject: false,
}
// Medlem uten partitur-rett.
const noScore: AccessCtx = {
  effectivePartIds: ['percussion-1'],
  sharedParts: [],
  sectionLeaderPartIds: [],
  canManageSection: false,
  canViewScore: false,
  canViewAll: false,
  inAccessibleProject: true,
}
// Barytonist som har fått 3. horn delt av Ingrid (#16).
const borrower: AccessCtx = {
  ...member,
  effectivePartIds: ['euphonium'],
  sharedParts: [{ partId: 'tenor-horn-3', fromName: 'Ingrid Voll' }],
}
const outsideProject: AccessCtx = { ...member, inAccessibleProject: false }
const sectionLeader: AccessCtx = {
  ...member,
  effectivePartIds: ['flugel'],
  sectionLeaderPartIds: ['solo-cornet', 'repiano-cornet'],
  canManageSection: true,
}

describe('memberCanAccessFile (nedlasting)', () => {
  it('egen stemme: ja', () => {
    expect(memberCanAccessFile(file('part', 'percussion-1'), member)).toBe(true)
  })
  it('andres stemme: nei', () => {
    expect(memberCanAccessFile(file('part', 'solo-cornet'), member)).toBe(false)
  })
  it('seksjonsleder kan laste ned alle løvstemmer i eksplisitt scope', () => {
    expect(memberCanAccessFile(file('part', 'solo-cornet'), sectionLeader)).toBe(true)
    expect(memberCanAccessFile(file('part', 'repiano-cornet'), sectionLeader)).toBe(true)
  })
  it('seksjonsleder avvises for forelder, annen seksjon og partitur uten egne rettigheter', () => {
    const withoutScore = { ...sectionLeader, canViewScore: false }
    expect(memberCanAccessFile(file('part', 'cornets'), withoutScore)).toBe(false)
    expect(memberCanAccessFile(file('part', 'tenor-horn'), withoutScore)).toBe(false)
    expect(memberCanAccessFile(file('score'), withoutScore)).toBe(false)
  })
  it('foreldet section_leaders-scope gir ikke tilgang uten members.manage.section', () => {
    const staleLeaderRow = { ...sectionLeader, canManageSection: false }
    expect(memberCanAccessFile(file('part', 'solo-cornet'), staleLeaderRow)).toBe(false)
  })
  it('partitur følger scores.view', () => {
    expect(memberCanAccessFile(file('score'), member)).toBe(true)
    expect(memberCanAccessFile(file('score'), noScore)).toBe(false)
  })
  it('lyd alltid åpen for innlogget', () => {
    expect(memberCanAccessFile(file('audio'), member)).toBe(true)
    expect(memberCanAccessFile(file('audio'), noScore)).toBe(true)
  })
  it('uplassert (other) kun med fullt arkivinnsyn', () => {
    expect(memberCanAccessFile(file('other'), member)).toBe(false)
    expect(memberCanAccessFile(file('other'), viewAll)).toBe(true)
  })
  it('fullt arkivinnsyn når andres stemme og uplassert', () => {
    expect(memberCanAccessFile(file('part', 'solo-cornet'), viewAll)).toBe(true)
  })
  it('avviser alle filer utenfor publiserte, kommende prosjekter', () => {
    expect(memberCanAccessFile(file('part', 'percussion-1'), outsideProject)).toBe(false)
    expect(memberCanAccessFile(file('score'), outsideProject)).toBe(false)
    expect(memberCanAccessFile(file('audio'), outsideProject)).toBe(false)
    expect(
      memberCanAccessFile(file('part', 'solo-cornet'), {
        ...sectionLeader,
        inAccessibleProject: false,
      }),
    ).toBe(false)
  })
  it('medlem uten stemme når ingen part-filer', () => {
    const none: AccessCtx = { ...member, effectivePartIds: [] }
    expect(memberCanAccessFile(file('part', 'percussion-1'), none)).toBe(false)
  })
})

describe('delt stemme mellom medlemmer (#16)', () => {
  it('den delte stemmen kan lastes ned', () => {
    expect(memberCanAccessFile(file('part', 'tenor-horn-3'), borrower)).toBe(true)
    expect(memberCanAccessFile(file('part', 'euphonium'), borrower)).toBe(true)
  })

  it('gir INGEN andre stemmer enn den ene som er delt', () => {
    expect(memberCanAccessFile(file('part', 'tenor-horn-1'), borrower)).toBe(false)
    expect(memberCanAccessFile(file('part', 'solo-cornet'), borrower)).toBe(false)
  })

  it('gir ikke partitur, uplassert eller arkivinnsyn', () => {
    const noScoreBorrower = { ...borrower, canViewScore: false }
    expect(memberCanAccessFile(file('score'), noScoreBorrower)).toBe(false)
    expect(memberCanAccessFile(file('other'), borrower)).toBe(false)
    expect(borrower.canViewAll).toBe(false)
  })

  it('følger prosjektkravet som alle andre stemmer', () => {
    expect(
      memberCanAccessFile(file('part', 'tenor-horn-3'), { ...borrower, inAccessibleProject: false }),
    ).toBe(false)
  })

  it('metadata vises for den delte stemmen, ikke for de andre', () => {
    expect(memberCanSeeFile(file('part', 'tenor-horn-3'), borrower)).toBe(true)
    expect(memberCanSeeFile(file('part', 'tenor-horn-1'), borrower)).toBe(false)
  })

  it('en tom delingsliste endrer ingenting', () => {
    expect(memberCanAccessFile(file('part', 'tenor-horn-3'), { ...borrower, sharedParts: [] })).toBe(false)
  })

  it('vikarlenka er urørt av delinger mellom medlemmer', () => {
    // `shareAllows` tar ikke AccessCtx i det hele tatt — det er poenget.
    expect(shareAllows(file('part', 'tenor-horn-3'), [])).toBe(false)
  })
})

describe('sharedFileFrom (hvem lånte meg denne?)', () => {
  it('navngir deleren for en lånt stemme', () => {
    expect(sharedFileFrom(file('part', 'tenor-horn-3'), borrower)).toBe('Ingrid Voll')
  })

  it('egen stemme er ikke lånt, selv om den også er delt', () => {
    const alsoOwns = { ...borrower, effectivePartIds: ['euphonium', 'tenor-horn-3'] }
    expect(sharedFileFrom(file('part', 'tenor-horn-3'), alsoOwns)).toBeNull()
  })

  it('null for udelte stemmer, partitur, lyd og uplassert', () => {
    expect(sharedFileFrom(file('part', 'solo-cornet'), borrower)).toBeNull()
    expect(sharedFileFrom(file('score'), borrower)).toBeNull()
    expect(sharedFileFrom(file('audio'), borrower)).toBeNull()
    expect(sharedFileFrom(file('other'), borrower)).toBeNull()
    expect(sharedFileFrom(file('part', null), borrower)).toBeNull()
  })
})

describe('shareAllows (vikar)', () => {
  const shared = ['percussion-1', 'percussion-2']
  it('delt stemme: ja, udelt: nei', () => {
    expect(shareAllows(file('part', 'percussion-1'), shared)).toBe(true)
    expect(shareAllows(file('part', 'solo-cornet'), shared)).toBe(false)
  })
  it('lyd alltid med', () => {
    expect(shareAllows(file('audio'), shared)).toBe(true)
    expect(shareAllows(file('audio'), [])).toBe(true)
  })
  it('partitur og uplassert aldri via vikarlenke', () => {
    expect(shareAllows(file('score'), shared)).toBe(false)
    expect(shareAllows(file('other'), shared)).toBe(false)
  })
})

describe('memberCanSeeFile (metadata i liste)', () => {
  it('partitur/lyd vises alltid (nedlasting gates separat)', () => {
    expect(memberCanSeeFile(file('score'), noScore)).toBe(true)
    expect(memberCanSeeFile(file('audio'), member)).toBe(true)
  })
  it('egen stemme vises, andres skjules', () => {
    expect(memberCanSeeFile(file('part', 'percussion-1'), member)).toBe(true)
    expect(memberCanSeeFile(file('part', 'solo-cornet'), member)).toBe(false)
  })
  it('viser samme leder-scope som nedlastingsporten tillater', () => {
    expect(memberCanSeeFile(file('part', 'solo-cornet'), sectionLeader)).toBe(true)
    expect(memberCanSeeFile(file('part', 'tenor-horn'), sectionLeader)).toBe(false)
    expect(
      memberCanSeeFile(file('part', 'solo-cornet'), {
        ...sectionLeader,
        canManageSection: false,
      }),
    ).toBe(false)
  })
  it('uplassert skjules for ikke-arkivinnsyn, vises ellers', () => {
    expect(memberCanSeeFile(file('other'), member)).toBe(false)
    expect(memberCanSeeFile(file('other'), viewAll)).toBe(true)
  })
  it('skjuler alle filmetadata utenfor tilgjengelige prosjekter', () => {
    expect(memberCanSeeFile(file('part', 'percussion-1'), outsideProject)).toBe(false)
    expect(memberCanSeeFile(file('score'), outsideProject)).toBe(false)
    expect(memberCanSeeFile(file('audio'), outsideProject)).toBe(false)
  })
})
