import { describe, expect, it } from 'vitest'
import {
  MAX_PART_SHARES,
  type PartShareRequest,
  groupSharedFiles,
  partShareRejection,
  sharedWithYouLabel,
  sortPartShares,
} from './part-shares'

const base: PartShareRequest = {
  meId: 'anne',
  ownPartIds: ['tenor-horn-3', 'flugel'],
  givenCount: 0,
  toUserId: 'bjorn',
  partId: 'tenor-horn-3',
  recipientIsActiveMember: true,
  alreadyShared: false,
}

describe('partShareRejection', () => {
  it('godtar en deling av egen stemme til et annet aktivt medlem', () => {
    expect(partShareRejection(base)).toBeNull()
  })

  it('avviser deling med seg selv', () => {
    expect(partShareRejection({ ...base, toUserId: 'anne' })).toMatch(/deg selv/)
  })

  it('avviser en stemme deleren ikke er tildelt', () => {
    expect(partShareRejection({ ...base, partId: 'euphonium' })).toMatch(/egne tildelte|selv er tildelt/)
  })

  it('en stemme man BARE har fått delt kan ikke deles videre', () => {
    // `ownPartIds` er rå `user_parts`. En mottatt deling står aldri der, så
    // kjeden Anne → Bjørn → Carl kan ikke oppstå.
    const receiverSharesOn = { ...base, meId: 'bjorn', toUserId: 'carl', ownPartIds: ['euphonium'] }
    expect(partShareRejection(receiverSharesOn)).not.toBeNull()
  })

  it('avviser ukjent eller deaktivert mottaker', () => {
    expect(partShareRejection({ ...base, recipientIsActiveMember: false })).toBe('Fant ikke medlemmet.')
  })

  it('avviser en deling som allerede finnes', () => {
    expect(partShareRejection({ ...base, alreadyShared: true })).toMatch(/allerede delt/)
  })

  it('avviser over taket, men slipper gjennom på siste ledige plass', () => {
    expect(partShareRejection({ ...base, givenCount: MAX_PART_SHARES - 1 })).toBeNull()
    expect(partShareRejection({ ...base, givenCount: MAX_PART_SHARES })).toMatch(/maks/)
  })

  it('sjekker eierskapet til stemmen FØR mottakeren finnes', () => {
    // Ellers ville et rått kall med en stemme man ikke eier kunnet skille
    // «finnes ikke» fra «finnes, men du eier ikke stemmen».
    const both = { ...base, partId: 'euphonium', recipientIsActiveMember: false }
    expect(partShareRejection(both)).toMatch(/selv er tildelt/)
  })
})

describe('sortPartShares', () => {
  it('sorterer på navn, så stemme, med norsk kollasjon', () => {
    const rows = [
      { memberId: '3', memberName: 'Øyvind Ask', partId: 'a', partName: 'Althorn 1' },
      { memberId: '1', memberName: 'Bjørn Dal', partId: 'c', partName: 'Baryton' },
      { memberId: '1', memberName: 'Bjørn Dal', partId: 'b', partName: 'Althorn 3' },
    ]
    expect(sortPartShares(rows).map((r) => `${r.memberName}/${r.partName}`)).toEqual([
      'Bjørn Dal/Althorn 3',
      'Bjørn Dal/Baryton',
      'Øyvind Ask/Althorn 1',
    ])
  })

  it('lar innlista stå urørt', () => {
    const rows = [
      { memberId: '2', memberName: 'B', partId: 'x', partName: 'X' },
      { memberId: '1', memberName: 'A', partId: 'y', partName: 'Y' },
    ]
    sortPartShares(rows)
    expect(rows[0]!.memberName).toBe('B')
  })
})

describe('sharedWithYouLabel', () => {
  it('skriver hvem stemmen kom fra', () => {
    expect(sharedWithYouLabel('Ingrid Voll')).toBe('Delt med deg av Ingrid Voll')
  })
})

describe('groupSharedFiles', () => {
  it('samler to lånte stemmer fra samme person under én overskrift', () => {
    const groups = groupSharedFiles([
      { id: '1', fromName: 'Ingrid' },
      { id: '2', fromName: 'Åse' },
      { id: '3', fromName: 'Ingrid' },
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0]!.fromName).toBe('Ingrid')
    expect(groups[0]!.files.map((f) => f.id)).toEqual(['1', '3'])
    expect(groups[1]!.fromName).toBe('Åse')
  })

  it('gir tom liste uten lånte filer', () => {
    expect(groupSharedFiles([])).toEqual([])
  })
})
