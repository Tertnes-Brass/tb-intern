import { describe, expect, it } from 'vitest'
import {
  HINT_SEEN,
  LAST_PAGE,
  gestureHint,
  gestureModeOf,
  hintStorageKey,
  shouldShowHint,
  canSpread,
  clampViewStart,
  defaultView,
  fitHeight,
  lastViewStart,
  nextTurn,
  pageLabel,
  prevTurn,
  resolveView,
  tapZone,
  viewPages,
  viewStartFor,
  viewsToRender,
} from './stand-view'

// Skjermene stativet faktisk brukes på (CSS-piksler).
const IPHONE = [393, 852] as const
const IPHONE_LANDSCAPE = [852, 393] as const
const IPAD = [834, 1194] as const
const IPAD_LANDSCAPE = [1194, 834] as const

describe('standardvisning', () => {
  it('ruller på telefon, uansett retning', () => {
    expect(defaultView(...IPHONE)).toBe('scroll')
    expect(defaultView(...IPHONE_LANDSCAPE)).toBe('scroll')
  })

  it('viser hel side på iPad stående og to sider liggende', () => {
    expect(defaultView(...IPAD)).toBe('page')
    expect(defaultView(...IPAD_LANDSCAPE)).toBe('spread')
  })

  it('tilbyr bare to sider der det er plass', () => {
    expect(canSpread(...IPAD_LANDSCAPE)).toBe(true)
    expect(canSpread(...IPAD)).toBe(false)
    expect(canSpread(...IPHONE_LANDSCAPE)).toBe(false)
  })
})

describe('resolveView', () => {
  it('bruker det lagrede valget for retningen', () => {
    expect(resolveView('scroll', ...IPAD_LANDSCAPE)).toBe('scroll')
    expect(resolveView('page', ...IPHONE)).toBe('page')
  })

  it('faller tilbake til standarden ved ugyldig eller manglende valg', () => {
    expect(resolveView(null, ...IPAD)).toBe('page')
    expect(resolveView('tull', ...IPAD_LANDSCAPE)).toBe('spread')
  })

  it('gjør «to sider» om til «hel side» der det ikke er plass', () => {
    expect(resolveView('spread', ...IPHONE_LANDSCAPE)).toBe('page')
  })
})

describe('sider og oppslag', () => {
  it('starter et oppslag på en odde side', () => {
    expect(viewStartFor(1, 2)).toBe(1)
    expect(viewStartFor(2, 2)).toBe(1)
    expect(viewStartFor(4, 2)).toBe(3)
    expect(viewStartFor(4, 1)).toBe(4)
  })

  it('finner siste visning', () => {
    expect(lastViewStart(4, 2)).toBe(3)
    expect(lastViewStart(5, 2)).toBe(5)
    expect(lastViewStart(5, 1)).toBe(5)
    expect(lastViewStart(0, 1)).toBe(1)
  })

  it('løser «siste side» når antallet sider blir kjent', () => {
    expect(clampViewStart(LAST_PAGE, 3, 1)).toBe(3)
    expect(clampViewStart(LAST_PAGE, 3, 2)).toBe(3)
    expect(clampViewStart(LAST_PAGE, 4, 2)).toBe(3)
    expect(clampViewStart(2, 4, 2)).toBe(1)
    expect(clampViewStart(9, 0, 1)).toBe(1)
  })

  it('viser én side når et oppslag går forbi siste side', () => {
    expect(viewPages(3, 4, 2)).toEqual([3, 4])
    expect(viewPages(5, 5, 2)).toEqual([5])
    expect(viewPages(2, 5, 1)).toEqual([2])
  })
})

describe('bla', () => {
  it('blar en side eller et oppslag fremover', () => {
    expect(nextTurn(1, 3, 1)).toEqual({ kind: 'page', start: 2 })
    expect(nextTurn(1, 4, 2)).toEqual({ kind: 'page', start: 3 })
  })

  it('går videre til neste stykke fra siste side', () => {
    expect(nextTurn(3, 3, 1)).toEqual({ kind: 'piece', direction: 'next' })
    expect(nextTurn(3, 4, 2)).toEqual({ kind: 'piece', direction: 'next' })
  })

  it('blar tilbake, og fra første side til forrige stykke', () => {
    expect(prevTurn(3, 2)).toEqual({ kind: 'page', start: 1 })
    expect(prevTurn(2, 1)).toEqual({ kind: 'page', start: 1 })
    expect(prevTurn(1, 2)).toEqual({ kind: 'piece', direction: 'prev' })
  })

  it('tegner visningen og naboene, ikke mer', () => {
    expect(viewsToRender(1, 1, 1)).toEqual([1])
    expect(viewsToRender(3, 6, 2)).toEqual([3, 5, 1])
    expect(viewsToRender(5, 5, 1)).toEqual([5, 4])
  })
})

describe('fitHeight', () => {
  const A4 = 1 / Math.SQRT2

  it('fyller høyden når bredden tillater det', () => {
    expect(fitHeight([A4], 1000, 800)).toBe(800)
  })

  it('begrenses av bredden på en smal skjerm', () => {
    expect(fitHeight([A4], 393, 800)).toBe(Math.floor(393 / A4))
  })

  it('regner med mellomrommet mellom to sider', () => {
    const h = fitHeight([A4, A4], 1000, 2000, 20)
    expect(h * A4 * 2 + 20).toBeLessThanOrEqual(1000)
  })

  it('er 0 uten plass', () => {
    expect(fitHeight([A4], 0, 800)).toBe(0)
    expect(fitHeight([], 800, 800)).toBe(0)
  })
})

describe('tapZone og pageLabel', () => {
  it('deler noten i tre', () => {
    expect(tapZone(10, 900)).toBe('prev')
    expect(tapZone(450, 900)).toBe('center')
    expect(tapZone(890, 900)).toBe('next')
  })

  it('skriver posisjonen', () => {
    expect(pageLabel(1, 3, 1)).toBe('side 1 av 3')
    expect(pageLabel(3, 4, 2)).toBe('side 3–4 av 4')
    expect(pageLabel(5, 5, 2)).toBe('side 5 av 5')
    expect(pageLabel(1, 0, 1)).toBe('')
  })
})

describe('hjelp for bladingen', () => {
  it('de to sidevisningene deler hjelpen; rullevisningen har sin egen', () => {
    expect(gestureModeOf('scroll')).toBe('scroll')
    expect(gestureModeOf('page')).toBe('paged')
    expect(gestureModeOf('spread')).toBe('paged')
    expect(hintStorageKey('scroll')).not.toBe(hintStorageKey('paged'))
  })

  it('vises til den er sett', () => {
    expect(shouldShowHint(null)).toBe(true)
    expect(shouldShowHint(undefined)).toBe(true)
    expect(shouldShowHint('0')).toBe(true)
    expect(shouldShowHint(HINT_SEEN)).toBe(false)
  })

  it('sidevisningene: tre trykkfelt, og sveip blar en side', () => {
    const hint = gestureHint('paged')
    expect(hint.zones.map((z) => z.zone)).toEqual(['prev', 'center', 'next'])
    expect(hint.zones.map((z) => z.label)).toEqual(['Forrige side', 'Vis menyene', 'Neste side'])
    expect(hint.swipe).toMatch(/side/)
  })

  it('rullevisningen: trykk viser menyene, og sveip bytter stykke', () => {
    const hint = gestureHint('scroll')
    expect(hint.zones.map((z) => z.zone)).toEqual(['center'])
    expect(hint.swipe).toMatch(/stykke/)
  })
})
