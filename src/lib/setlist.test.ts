import { describe, expect, it } from 'vitest'
import { parseSetlistInput, setlistItemTitle, SETLIST_NOTE_MAX } from './setlist'

describe('parseSetlistInput', () => {
  it('godtar et verk fra arkivet', () => {
    expect(parseSetlistInput({ workId: 'w1', note: ' sats 2, takt 40 ' })).toEqual({
      workId: 'w1',
      customTitle: null,
      note: 'sats 2, takt 40',
    })
  })

  it('godtar et fritekstpunkt', () => {
    expect(parseSetlistInput({ customTitle: '  Oppvarming ' })).toEqual({
      workId: null,
      customTitle: 'Oppvarming',
      note: null,
    })
  })

  it('lar verket vinne når begge er sendt inn', () => {
    expect(parseSetlistInput({ workId: 'w1', customTitle: 'rest fra skjemaet' })).toEqual({
      workId: 'w1',
      customTitle: null,
      note: null,
    })
  })

  it('avviser et punkt uten både verk og tittel', () => {
    expect(() => parseSetlistInput({})).toThrow(/Velg et verk/)
    expect(() => parseSetlistInput({ workId: '  ', customTitle: '   ', note: 'bare merknad' })).toThrow(/Velg et verk/)
  })

  it('kutter en altfor lang merknad', () => {
    expect(parseSetlistInput({ customTitle: 'x', note: 'a'.repeat(1000) }).note).toHaveLength(SETLIST_NOTE_MAX)
  })
})

describe('setlistItemTitle', () => {
  it('viser verkstittelen for et verk fra arkivet', () => {
    expect(setlistItemTitle({ workId: 'w1', workTitle: 'Aubade', customTitle: null })).toBe('Aubade')
  })

  it('viser fritekst-tittelen for et punkt utenfor arkivet', () => {
    expect(setlistItemTitle({ workId: null, customTitle: 'Oppvarming' })).toBe('Oppvarming')
  })

  it('sier fra når verket er slettet fra arkivet i stedet for å tie', () => {
    expect(setlistItemTitle({ workId: null, customTitle: null })).toBe('Slettet fra arkivet')
  })
})
