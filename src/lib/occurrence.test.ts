import { describe, expect, it } from 'vitest'
import { isOccurrenceKey, occurrenceKey, parseOccurrenceKey } from './occurrence'

describe('occurrenceKey', () => {
  it('koder en enkelthendelse som base64url av uid-en', () => {
    expect(occurrenceKey('varkonsert@tertnesbrass.no', null)).toBe('dmFya29uc2VydEB0ZXJ0bmVzYnJhc3Mubm8')
  })

  it('legger den opprinnelige starten på for en forekomst i en serie', () => {
    expect(occurrenceKey('ovelse@tertnesbrass.no', '2026-03-25T18:00:00.000Z')).toBe(
      'b3ZlbHNlQHRlcnRuZXNicmFzcy5ubw.20260325T180000Z',
    )
  })

  it('er URL-trygg også for uid-er med @, understrek og norske tegn', () => {
    const key = occurrenceKey('abc123_æøå@google.com', '2026-01-07T18:00:00.000Z')
    expect(key).toBe('YWJjMTIzX8Omw7jDpUBnb29nbGUuY29t.20260107T180000Z')
    expect(encodeURIComponent(key)).toBe(key)
  })

  it('er deterministisk — samme inndata gir samme nøkkel', () => {
    const a = occurrenceKey('ovelse@tertnesbrass.no', '2026-03-25T18:00:00.000Z')
    const b = occurrenceKey('ovelse@tertnesbrass.no', new Date('2026-03-25T18:00:00Z').toISOString())
    expect(a).toBe(b)
  })

  it('skiller to forekomster av samme serie', () => {
    const uid = 'ovelse@tertnesbrass.no'
    expect(occurrenceKey(uid, '2026-03-18T18:00:00.000Z')).not.toBe(occurrenceKey(uid, '2026-03-25T18:00:00.000Z'))
  })

  it('skiller en serieforekomst fra hele serien som enkelthendelse', () => {
    const uid = 'ovelse@tertnesbrass.no'
    expect(occurrenceKey(uid, null)).not.toBe(occurrenceKey(uid, '2026-03-25T18:00:00.000Z'))
  })

  it('faller tilbake til enkelthendelsesformen ved ugyldig dato', () => {
    expect(occurrenceKey('x@y', 'tull')).toBe(occurrenceKey('x@y', null))
  })
})

describe('parseOccurrenceKey', () => {
  it('gir uid og opprinnelig start tilbake', () => {
    expect(parseOccurrenceKey('b3ZlbHNlQHRlcnRuZXNicmFzcy5ubw.20260325T180000Z')).toEqual({
      uid: 'ovelse@tertnesbrass.no',
      originalStart: '2026-03-25T18:00:00.000Z',
    })
  })

  it('gir null som opprinnelig start for en enkelthendelse', () => {
    expect(parseOccurrenceKey('dmFya29uc2VydEB0ZXJ0bmVzYnJhc3Mubm8')).toEqual({
      uid: 'varkonsert@tertnesbrass.no',
      originalStart: null,
    })
  })

  it('avviser søppel i stedet for å gjette', () => {
    expect(parseOccurrenceKey('')).toBeNull()
    expect(parseOccurrenceKey('ikke gyldig')).toBeNull()
    expect(parseOccurrenceKey('../../etc/passwd')).toBeNull()
    expect(parseOccurrenceKey('abc.2026-03-25')).toBeNull()
  })
})

describe('isOccurrenceKey', () => {
  it('godtar bare formen vi selv lager', () => {
    expect(isOccurrenceKey('b3ZlbHNl')).toBe(true)
    expect(isOccurrenceKey('b3ZlbHNl.20260325T180000Z')).toBe(true)
    expect(isOccurrenceKey('')).toBe(false)
    expect(isOccurrenceKey('a/b')).toBe(false)
    expect(isOccurrenceKey('a b')).toBe(false)
    expect(isOccurrenceKey('a'.repeat(513))).toBe(false)
  })
})
