import { describe, expect, it } from 'vitest'
import {
  RIG_NAME_MAX,
  type RigCheckState,
  applyRigCheck,
  canManageRigList,
  groupRigByResponsible,
  parseRigItemInput,
  parseRigScope,
  rigProgress,
  rigProgressLine,
  rigResponsibleKey,
  rigStatus,
} from './rigg'

const EMPTY: RigCheckState = { takenAt: null, takenBy: null, returnedAt: null, returnedBy: null }

describe('canManageRigList', () => {
  it('godtar begge de to eierne av lista', () => {
    expect(canManageRigList(['projects.manage'])).toBe(true)
    expect(canManageRigList(['assets.manage'])).toBe(true)
  })

  it('godtar jokeren', () => {
    expect(canManageRigList(['*'])).toBe(true)
  })

  it('avviser et vanlig medlem', () => {
    expect(canManageRigList([])).toBe(false)
    expect(canManageRigList(['calendar.manage', 'posts.publish'])).toBe(false)
  })
})

describe('parseRigScope', () => {
  it('gir prosjekt når prosjekt er satt', () => {
    expect(parseRigScope({ projectId: 'p1' })).toEqual({ kind: 'project', projectId: 'p1' })
  })

  it('gir øving når forekomstnøkkelen er satt', () => {
    expect(parseRigScope({ occurrenceKey: 'abc.20260903T170000Z' })).toEqual({
      kind: 'event',
      occurrenceKey: 'abc.20260903T170000Z',
    })
  })

  // Begge satt er en feil og ikke en tolkning: raden ville dukket opp to steder.
  it('avviser begge samtidig', () => {
    expect(() => parseRigScope({ projectId: 'p1', occurrenceKey: 'abc' })).toThrow(/enten/)
  })

  it('avviser ingen av delene — også når feltene bare er mellomrom', () => {
    expect(() => parseRigScope({})).toThrow(/mangler/)
    expect(() => parseRigScope({ projectId: '   ' })).toThrow(/mangler/)
  })
})

describe('parseRigItemInput', () => {
  it('krever et navn', () => {
    expect(() => parseRigItemInput({ name: '   ' })).toThrow(/Skriv inn/)
  })

  it('trimmer, kollapser mellomrom og kutter', () => {
    const value = parseRigItemInput({ name: '  fire   muter \n' })
    expect(value.name).toBe('fire muter')
    expect(parseRigItemInput({ name: 'x'.repeat(500) }).name).toHaveLength(RIG_NAME_MAX)
  })

  it('lar medlemmet vinne over fritekstgruppa når begge er sendt inn', () => {
    const value = parseRigItemInput({ name: 'Banner', responsibleUserId: 'u1', responsibleName: 'riggegruppa' })
    expect(value.responsibleUserId).toBe('u1')
    expect(value.responsibleName).toBeNull()
  })

  it('beholder fritekstgruppa når ingen medlem er valgt', () => {
    const value = parseRigItemInput({ name: 'Banner', responsibleName: 'riggegruppa' })
    expect(value.responsibleUserId).toBeNull()
    expect(value.responsibleName).toBe('riggegruppa')
  })

  it('beholder referansen til utstyrsregisteret ved siden av navnesnapshotet', () => {
    const value = parseRigItemInput({ assetId: 'a1', name: 'Skarptromme (Yamaha)' })
    expect(value.assetId).toBe('a1')
    expect(value.name).toBe('Skarptromme (Yamaha)')
  })
})

describe('applyRigCheck', () => {
  it('setter tid og person ved første avkryssing', () => {
    const next = applyRigCheck(EMPTY, 'taken', true, 'u1', 1000)
    expect(next).toEqual({ takenAt: 1000, takenBy: 'u1', returnedAt: null, returnedBy: null })
  })

  // Den som trykker to ganger skal ikke overskrive sporet til den som bar kassa.
  it('endrer ikke hvem/når når noen krysser av på nytt', () => {
    const first = applyRigCheck(EMPTY, 'taken', true, 'u1', 1000)
    expect(applyRigCheck(first, 'taken', true, 'u2', 5000)).toEqual(first)
  })

  it('setter «tatt med» automatisk når noe krysses av som kommet tilbake', () => {
    const next = applyRigCheck(EMPTY, 'returned', true, 'u2', 2000)
    expect(next).toEqual({ takenAt: 2000, takenBy: 'u2', returnedAt: 2000, returnedBy: 'u2' })
  })

  it('rører ikke den opprinnelige «tatt med» når den allerede finnes', () => {
    const taken = applyRigCheck(EMPTY, 'taken', true, 'u1', 1000)
    const next = applyRigCheck(taken, 'returned', true, 'u2', 2000)
    expect(next).toEqual({ takenAt: 1000, takenBy: 'u1', returnedAt: 2000, returnedBy: 'u2' })
  })

  // Invarianten: kommet tilbake ⇒ tatt med. Uten den ville rigProgress talt et
  // utestående som ikke finnes.
  it('fjerner «kommet tilbake» når «tatt med» fjernes', () => {
    const returned = applyRigCheck(applyRigCheck(EMPTY, 'taken', true, 'u1', 1000), 'returned', true, 'u1', 2000)
    expect(applyRigCheck(returned, 'taken', false, 'u3', 3000)).toEqual(EMPTY)
  })

  it('lar «tatt med» stå når bare «kommet tilbake» fjernes', () => {
    const returned = applyRigCheck(applyRigCheck(EMPTY, 'taken', true, 'u1', 1000), 'returned', true, 'u2', 2000)
    expect(applyRigCheck(returned, 'returned', false, 'u3', 3000)).toEqual({
      takenAt: 1000,
      takenBy: 'u1',
      returnedAt: null,
      returnedBy: null,
    })
  })

  it('gir aldri en tilstand der «tilbake» står uten «tatt med»', () => {
    const states: RigCheckState[] = [EMPTY]
    let state = EMPTY
    for (const [field, checked] of [
      ['returned', true],
      ['taken', false],
      ['returned', true],
      ['returned', false],
      ['taken', true],
      ['returned', true],
      ['taken', false],
    ] as const) {
      state = applyRigCheck(state, field, checked, 'u1', 1)
      states.push(state)
    }
    for (const s of states) {
      if (s.returnedAt !== null) expect(s.takenAt).not.toBeNull()
    }
  })
})

describe('rigStatus og rigProgress', () => {
  it('leser status av de to tidsstemplene', () => {
    expect(rigStatus({ takenAt: null, returnedAt: null })).toBe('pending')
    expect(rigStatus({ takenAt: 1, returnedAt: null })).toBe('taken')
    expect(rigStatus({ takenAt: 1, returnedAt: 2 })).toBe('returned')
  })

  it('teller utestående som tatt med minus kommet tilbake', () => {
    const progress = rigProgress([
      { takenAt: null, returnedAt: null },
      { takenAt: 1, returnedAt: null },
      { takenAt: 1, returnedAt: null },
      { takenAt: 1, returnedAt: 2 },
    ])
    expect(progress).toEqual({ total: 4, taken: 3, returned: 1, outstanding: 2 })
  })

  it('sier fra på norsk uten å lyve om en tom liste', () => {
    expect(rigProgressLine(rigProgress([]))).toBe('Ingen ting på lista ennå')
    expect(rigProgressLine(rigProgress([{ takenAt: 1, returnedAt: null }]))).toBe('1 av 1 tatt med · 1 ikke tilbake')
  })
})

describe('groupRigByResponsible', () => {
  const nameFor = (id: string) => (id === 'u1' ? 'Ingrid Vik' : null)

  it('grupperer på medlem, gruppenavn og resten', () => {
    const groups = groupRigByResponsible(
      [
        { name: 'Banner', responsibleUserId: null, responsibleName: 'Riggegruppa' },
        { name: 'Muter', responsibleUserId: 'u1', responsibleName: null },
        { name: 'Avlastningsbord', responsibleUserId: null, responsibleName: null },
        { name: 'Alt-triangel', responsibleUserId: null, responsibleName: 'Riggegruppa' },
      ],
      nameFor,
    )
    expect(groups.map((g) => g.label)).toEqual(['Ingrid Vik', 'Riggegruppa', 'Uten ansvarlig'])
    // Restbunken står alltid sist, uansett alfabet.
    expect(groups.at(-1)!.items).toHaveLength(1)
    // Innad sorteres det på navn, norsk kollasjon.
    expect(groups[1]!.items.map((i) => i.name)).toEqual(['Alt-triangel', 'Banner'])
  })

  it('viser dagens navn på medlemmet, ikke et lagret navn', () => {
    const groups = groupRigByResponsible([{ name: 'Muter', responsibleUserId: 'u1', responsibleName: null }], nameFor)
    expect(groups[0]!.label).toBe('Ingrid Vik')
  })

  it('sier «Tidligere medlem» når medlemmet ikke finnes lenger', () => {
    const groups = groupRigByResponsible([{ name: 'Muter', responsibleUserId: 'u9', responsibleName: null }], nameFor)
    expect(groups[0]!.label).toBe('Tidligere medlem')
  })

  it('slår sammen samme gruppenavn uansett store og små bokstaver', () => {
    expect(rigResponsibleKey({ responsibleUserId: null, responsibleName: 'Riggegruppa' })).toBe(
      rigResponsibleKey({ responsibleUserId: null, responsibleName: 'riggegruppa' }),
    )
  })
})
