import { describe, expect, it } from 'vitest'
import {
  MAX_PINNED_POSTS,
  PIN_ERRORS,
  addDays,
  isIsoDate,
  isPinned,
  pinDurationLabel,
  pinLimitMessage,
  pinUntilRejection,
  sortPinned,
} from './pins'

const TODAY = '2026-11-06'

describe('isPinned', () => {
  const base = { pinnedAt: 1, pinnedUntil: null, publishedAt: 1 }

  it('er festet uten sluttdato', () => {
    expect(isPinned(base, TODAY)).toBe(true)
  })

  it('er ikke festet uten pinnedAt', () => {
    expect(isPinned({ ...base, pinnedAt: null }, TODAY)).toBe(false)
  })

  it('et utkast er aldri festet', () => {
    expect(isPinned({ ...base, publishedAt: null }, TODAY)).toBe(false)
  })

  it('er festet til og med sluttdatoen, ikke dagen etter', () => {
    expect(isPinned({ ...base, pinnedUntil: TODAY }, TODAY)).toBe(true)
    expect(isPinned({ ...base, pinnedUntil: '2026-11-05' }, TODAY)).toBe(false)
    expect(isPinned({ ...base, pinnedUntil: '2027-01-01' }, TODAY)).toBe(true)
  })
})

describe('datoer', () => {
  it('godtar bare ekte kalenderdatoer', () => {
    expect(isIsoDate('2026-11-06')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-11-6')).toBe(false)
    expect(isIsoDate('i morgen')).toBe(false)
  })

  it('legger til dager over månedsskifte og årsskifte', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('avviser fortid, ugyldige datoer og mer enn et år frem', () => {
    expect(pinUntilRejection(null, TODAY)).toBeNull()
    expect(pinUntilRejection(TODAY, TODAY)).toBeNull()
    expect(pinUntilRejection('2026-11-05', TODAY)).toBe('Datoen har allerede vært')
    expect(pinUntilRejection('2026-13-01', TODAY)).toBe('Ugyldig dato')
    expect(pinUntilRejection(addDays(TODAY, 366), TODAY)).toBeNull()
    expect(pinUntilRejection(addDays(TODAY, 367), TODAY)).toBe('Velg en dato innen et år')
  })
})

describe('sortPinned', () => {
  it('viktig først, så sist festet først', () => {
    const list = [
      { id: 'a', importance: 'normal', pinnedAt: 30 },
      { id: 'b', importance: 'important', pinnedAt: 10 },
      { id: 'c', importance: 'normal', pinnedAt: 50 },
      { id: 'd', importance: 'important', pinnedAt: 20 },
    ]
    expect(sortPinned(list).map((p) => p.id)).toEqual(['d', 'b', 'c', 'a'])
  })

  it('endrer ikke lista den får', () => {
    const list = [
      { id: 'a', importance: 'normal', pinnedAt: 1 },
      { id: 'b', importance: 'normal', pinnedAt: 2 },
    ]
    sortPinned(list)
    expect(list.map((p) => p.id)).toEqual(['a', 'b'])
  })
})

describe('tekstene', () => {
  it('beskriver varigheten', () => {
    expect(pinDurationLabel(null, TODAY)).toBe('Til noen løsner det')
    expect(pinDurationLabel(TODAY, TODAY)).toBe('Ut i dag')
    expect(pinDurationLabel('2026-11-07', TODAY)).toBe('Til og med i morgen')
    expect(pinDurationLabel('2026-11-14', TODAY)).toBe('Til og med 14. nov.')
  })

  it('sier hvor mange som kan festes', () => {
    expect(pinLimitMessage()).toContain(String(MAX_PINNED_POSTS))
  })
})

describe('PIN_ERRORS', () => {
  it('dekker alle avslagene pinUntilRejection kan gi', () => {
    for (const until of ['2026-13-01', '2026-11-05', addDays(TODAY, 400)]) {
      expect(PIN_ERRORS).toContain(pinUntilRejection(until, TODAY))
    }
    expect(PIN_ERRORS).toContain(pinLimitMessage())
  })
})
