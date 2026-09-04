import { describe, expect, it } from 'vitest'
import {
  PERCUSSION_INSTRUMENT_MAX,
  PERCUSSION_ITEM_NOTE_MAX,
  aggregatePercussionNeeds,
  isPercussionPart,
  parsePercussionItemInput,
  percussionPartOptions,
  percussionUseSummary,
  type PercussionSourceRow,
} from './work-percussion'

describe('parsePercussionItemInput', () => {
  it('normaliserer instrument, notat og stemme', () => {
    expect(
      parsePercussionItemInput({ instrument: '  Pauker ', note: ' deles med perc 2 ', partId: 'percussion-3' }),
    ).toEqual({ instrument: 'Pauker', note: 'deles med perc 2', partId: 'percussion-3' })
  })

  it('lar notat og stemme være valgfrie', () => {
    expect(parsePercussionItemInput({ instrument: 'Triangel' })).toEqual({
      instrument: 'Triangel',
      note: null,
      partId: null,
    })
  })

  it('avviser et instrument uten navn', () => {
    expect(() => parsePercussionItemInput({ instrument: '   ' })).toThrow(/navn/)
  })

  it('kutter for lange felt', () => {
    const value = parsePercussionItemInput({
      instrument: 'i'.repeat(PERCUSSION_INSTRUMENT_MAX + 20),
      note: 'n'.repeat(PERCUSSION_ITEM_NOTE_MAX + 20),
    })
    expect(value.instrument).toHaveLength(PERCUSSION_INSTRUMENT_MAX)
    expect(value.note).toHaveLength(PERCUSSION_ITEM_NOTE_MAX)
  })
})

describe('stemmevalg', () => {
  const parts = [
    { id: 'solo-cornet', section: 'cornet', sortOrder: 30 },
    { id: 'percussion-3', section: 'perc', sortOrder: 210 },
    { id: 'percussion-1', section: 'perc', sortOrder: 190 },
  ]

  it('gir bare slagverksstemmene, i besetningens rekkefølge', () => {
    expect(percussionPartOptions(parts).map((p) => p.id)).toEqual(['percussion-1', 'percussion-3'])
  })

  it('kjenner igjen en slagverksstemme', () => {
    expect(isPercussionPart({ section: 'perc' })).toBe(true)
    expect(isPercussionPart({ section: 'cornet' })).toBe(false)
    expect(isPercussionPart(null)).toBe(false)
  })
})

describe('aggregatePercussionNeeds', () => {
  const rows: PercussionSourceRow[] = [
    { workId: 'w2', workTitle: 'Napoli', position: 2, instrument: 'Marimba', note: 'må lånes', partName: 'Slagverk 2' },
    { workId: 'w1', workTitle: 'Gaelforce', position: 1, instrument: 'Pauker', note: null, partName: 'Slagverk 3' },
    { workId: 'w2', workTitle: 'Napoli', position: 2, instrument: 'pauker', note: 'deles med perc 3', partName: null },
  ]

  it('slår sammen samme instrument på tvers av verk, uavhengig av store bokstaver', () => {
    const needs = aggregatePercussionNeeds(rows)
    expect(needs.map((n) => n.key)).toEqual(['marimba', 'pauker'])
    const pauker = needs.find((n) => n.key === 'pauker')!
    expect(pauker.uses.map((u) => u.workTitle)).toEqual(['Gaelforce', 'Napoli'])
  })

  it('viser den første stavemåten i programrekkefølgen', () => {
    const needs = aggregatePercussionNeeds(rows)
    expect(needs.find((n) => n.key === 'pauker')!.instrument).toBe('Pauker')
  })

  it('sorterer instrumentene alfabetisk — lista leses som en huskeliste', () => {
    const needs = aggregatePercussionNeeds([
      ...rows,
      { workId: 'w1', workTitle: 'Gaelforce', position: 1, instrument: 'Xylofon', note: null, partName: null },
      { workId: 'w1', workTitle: 'Gaelforce', position: 1, instrument: 'Cymbaler', note: null, partName: null },
    ])
    expect(needs.map((n) => n.instrument)).toEqual(['Cymbaler', 'Marimba', 'Pauker', 'Xylofon'])
  })

  it('tar med notatet i oppsummeringen per instrument', () => {
    const needs = aggregatePercussionNeeds(rows)
    expect(percussionUseSummary(needs.find((n) => n.key === 'marimba')!)).toBe('Napoli (må lånes)')
    expect(percussionUseSummary(needs.find((n) => n.key === 'pauker')!)).toBe(
      'Gaelforce · Napoli (deles med perc 3)',
    )
  })

  it('tåler et tomt repertoar', () => {
    expect(aggregatePercussionNeeds([])).toEqual([])
  })
})
