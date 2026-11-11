import { describe, expect, it } from 'vitest'
import {
  DOUBLE_TAP_SCALE,
  MAX_SCALE,
  MIN_PINCH_SCALE,
  NO_ZOOM,
  clampZoom,
  dismissDim,
  dragAxis,
  isDoubleTap,
  isZoomed,
  pinch,
  settleZoom,
  shouldDismiss,
  swipeOffset,
  swipeTarget,
  toggleZoom,
  viewerCounter,
  zoomAround,
} from './image-viewer'

// En iPhone i høyden, og et liggende bilde som fyller bredden.
const BOX = { w: 400, h: 800 }
const WIDE = { w: 400, h: 250 }

/** Hvor et punkt på bildet (uskalert, fra midten) havner på skjermen. */
const onScreen = (z: { s: number; x: number; y: number }, p: { x: number; y: number }) => ({ x: z.s * p.x + z.x, y: z.s * p.y + z.y })

describe('clampZoom', () => {
  it('sentrerer et bilde som er mindre enn flaten', () => {
    expect(clampZoom({ s: 1, x: 50, y: -30 }, WIDE, BOX)).toEqual(NO_ZOOM)
  })

  it('lar ikke en kant slippe inn når bildet er zoomet', () => {
    // 2x: 800 px bredt i en 400 px flate → maks 200 px hver vei.
    expect(clampZoom({ s: 2, x: 500, y: 0 }, WIDE, BOX)).toEqual({ s: 2, x: 200, y: 0 })
    expect(clampZoom({ s: 2, x: -500, y: 0 }, WIDE, BOX).x).toBe(-200)
  })

  it('holder høyden i midten så lenge bildet er lavere enn flaten', () => {
    // 2x: 500 px høyt i en 800 px flate — ingenting å panorere loddrett.
    expect(clampZoom({ s: 2, x: 0, y: 120 }, WIDE, BOX).y).toBe(0)
    // 4x: 1000 px høyt → maks 100 px.
    expect(clampZoom({ s: 4, x: 0, y: 120 }, WIDE, BOX).y).toBe(100)
  })

  it('holder skalaen mellom 1 og maks', () => {
    expect(clampZoom({ s: 0.5, x: 0, y: 0 }, WIDE, BOX).s).toBe(1)
    expect(clampZoom({ s: 9, x: 0, y: 0 }, WIDE, BOX).s).toBe(MAX_SCALE)
  })

  it('gir aldri -0', () => {
    expect(Object.is(clampZoom({ s: 1, x: -5, y: -5 }, WIDE, BOX).x, 0)).toBe(true)
  })
})

describe('zoomAround og pinch', () => {
  it('holder punktet under fingeren i ro når skalaen endres', () => {
    const at = { x: 120, y: -40 }
    const z = zoomAround(NO_ZOOM, at, 3)
    expect(z.s).toBe(3)
    expect(onScreen(z, at)).toEqual(at)
  })

  it('virker også fra en zoomet tilstand', () => {
    const start = { s: 2, x: 40, y: 10 }
    const at = { x: -80, y: 60 }
    const pointOnImage = { x: (at.x - start.x) / start.s, y: (at.y - start.y) / start.s }
    const z = zoomAround(start, at, 3.5)
    expect(onScreen(z, pointOnImage).x).toBeCloseTo(at.x)
    expect(onScreen(z, pointOnImage).y).toBeCloseTo(at.y)
  })

  it('knip: punktet under midtpunktet følger fingrene', () => {
    const from = { x: 10, y: 20 }
    const to = { x: 60, y: -30 }
    const z = pinch(NO_ZOOM, from, to, 2)
    expect(z.s).toBe(2)
    expect(onScreen(z, from)).toEqual(to)
  })

  it('knip kan krympe litt under 1 og aldri over maks', () => {
    expect(pinch(NO_ZOOM, { x: 0, y: 0 }, { x: 0, y: 0 }, 0.1).s).toBe(MIN_PINCH_SCALE)
    expect(pinch(NO_ZOOM, { x: 0, y: 0 }, { x: 0, y: 0 }, 50).s).toBe(MAX_SCALE)
  })
})

describe('toggleZoom', () => {
  it('zoomer inn der man trykket', () => {
    const at = { x: 100, y: 0 }
    const z = toggleZoom(NO_ZOOM, at, WIDE, BOX)
    expect(z.s).toBe(DOUBLE_TAP_SCALE)
    expect(onScreen(z, at)).toEqual(at)
    expect(isZoomed(z)).toBe(true)
  })

  it('holder seg innenfor kantene også ved et trykk helt i hjørnet', () => {
    const z = toggleZoom(NO_ZOOM, { x: 200, y: 400 }, WIDE, BOX)
    expect(z).toEqual(clampZoom(z, WIDE, BOX))
  })

  it('zoomer helt ut igjen', () => {
    expect(toggleZoom({ s: 2.5, x: 30, y: 0 }, { x: 0, y: 0 }, WIDE, BOX)).toEqual(NO_ZOOM)
  })
})

describe('settleZoom', () => {
  it('spretter tilbake til 1 etter en kniping som endte nær eller under', () => {
    expect(settleZoom({ s: 0.7, x: 12, y: 3 }, WIDE, BOX)).toEqual(NO_ZOOM)
    expect(settleZoom({ s: 1.03, x: 12, y: 3 }, WIDE, BOX)).toEqual(NO_ZOOM)
  })

  it('beholder zoomen, men innenfor kantene', () => {
    expect(settleZoom({ s: 2, x: 900, y: 0 }, WIDE, BOX)).toEqual({ s: 2, x: 200, y: 0 })
  })
})

describe('dragAxis', () => {
  it('venter til fingeren har flyttet seg litt', () => {
    expect(dragAxis(3, 4)).toBeNull()
  })

  it('velger retningen som dominerer', () => {
    expect(dragAxis(-30, 8)).toBe('x')
    expect(dragAxis(5, 40)).toBe('y')
  })
})

describe('sveip', () => {
  it('følger fingeren fritt mellom to bilder', () => {
    expect(swipeOffset(-120, 1, 3)).toBe(-120)
    expect(swipeOffset(120, 1, 3)).toBe(120)
  })

  it('gir etter ved første og siste bilde', () => {
    expect(swipeOffset(100, 0, 3)).toBe(30)
    expect(swipeOffset(-100, 2, 3)).toBe(-30)
    // Ett bilde: begge veier er en kant.
    expect(swipeOffset(-100, 0, 1)).toBe(-30)
  })

  it('blar når det er dratt en femtedel av bredden', () => {
    expect(swipeTarget(-90, 600, 400, 0, 3)).toBe(1)
    expect(swipeTarget(90, 600, 400, 2, 3)).toBe(1)
  })

  it('blar på et kort, raskt sveip', () => {
    expect(swipeTarget(-40, 60, 400, 0, 3)).toBe(1)
  })

  it('blir stående på et kort, rolig drag', () => {
    expect(swipeTarget(-40, 600, 400, 0, 3)).toBe(0)
  })

  it('blar aldri forbi første eller siste', () => {
    expect(swipeTarget(200, 100, 400, 0, 3)).toBe(0)
    expect(swipeTarget(-200, 100, 400, 2, 3)).toBe(2)
  })
})

describe('dra for å lukke', () => {
  it('lukker når bildet er dratt langt nok, opp eller ned', () => {
    expect(shouldDismiss(130, 800)).toBe(true)
    expect(shouldDismiss(-130, 800)).toBe(true)
  })

  it('lukker på et raskt kast', () => {
    expect(shouldDismiss(60, 80)).toBe(true)
  })

  it('glir tilbake på et kort, rolig drag', () => {
    expect(shouldDismiss(60, 600)).toBe(false)
  })

  it('lysner bakgrunnen gradvis, men aldri helt', () => {
    expect(dismissDim(0)).toBe(1)
    expect(dismissDim(180)).toBeLessThan(1)
    expect(dismissDim(-5000)).toBeCloseTo(0.25)
  })
})

describe('isDoubleTap', () => {
  const first = { t: 1000, x: 100, y: 100 }

  it('kjenner igjen to trykk tett i tid og sted', () => {
    expect(isDoubleTap(first, { t: 1200, x: 110, y: 95 })).toBe(true)
  })

  it('avviser trykk som er for langt fra hverandre i tid eller sted', () => {
    expect(isDoubleTap(first, { t: 1400, x: 100, y: 100 })).toBe(false)
    expect(isDoubleTap(first, { t: 1100, x: 200, y: 100 })).toBe(false)
    expect(isDoubleTap(null, first)).toBe(false)
  })
})

describe('viewerCounter', () => {
  it('teller fra 1', () => {
    expect(viewerCounter(0, 3)).toBe('1 av 3')
    expect(viewerCounter(2, 3)).toBe('3 av 3')
  })
})
