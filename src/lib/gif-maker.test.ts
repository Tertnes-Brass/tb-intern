import { describe, expect, it } from 'vitest'
import {
  INITIAL_VIEW,
  MAX_GIF_SECONDS,
  MAX_ZOOM,
  MIN_CLIP_SECONDS,
  TRACK_SPAN_SECONDS,
  clampView,
  cropRect,
  fitTrim,
  formatClipTime,
  formatSeconds,
  frameOrder,
  frameTimes,
  initialTrim,
  isVideoFile,
  maxClipSeconds,
  moveTrimEdge,
  outputSize,
  panView,
  shiftTrim,
  smallerSize,
  trackWindow,
  withAspect,
  zoomView,
} from './gif-maker'

// En liggende 1920 × 1080-video og en stående iPhone-video.
const W = 1920
const H = 1080

describe('utsnittet', () => {
  it('«Original» uten zoom er hele videoen', () => {
    expect(cropRect(INITIAL_VIEW, W, H)).toEqual({ x: 0, y: 0, w: W, h: H })
  })

  it('en form som ikke passer, blir det største utsnittet med den formen, midt i', () => {
    expect(cropRect({ ...INITIAL_VIEW, aspect: '1:1' }, W, H)).toEqual({ x: 420, y: 0, w: 1080, h: 1080 })
    // Stående video, bred form: hele bredden.
    expect(cropRect({ ...INITIAL_VIEW, aspect: '16:9' }, 1080, 1920)).toEqual({ x: 0, y: 656.25, w: 1080, h: 607.5 })
  })

  it('zoom gjør utsnittet mindre, og det står alltid helt inne i videoen', () => {
    const r = cropRect({ aspect: 'original', zoom: 2, cx: 0, cy: 1 }, W, H)
    expect(r).toEqual({ x: 0, y: 540, w: 960, h: 540 })
    expect(cropRect({ aspect: 'original', zoom: 99, cx: 0.5, cy: 0.5 }, W, H).w).toBe(W / MAX_ZOOM)
  })

  it('midtpunktet lagres der utsnittet faktisk står (ingen død sone ved kanten)', () => {
    const v = clampView({ aspect: 'original', zoom: 2, cx: -3, cy: 0.5 }, W, H)
    expect(v.cx).toBe(0.25)
    // Uten zoom kan bildet ikke flyttes i det hele tatt.
    expect(panView(INITIAL_VIEW, 300, -200, 400, W, H)).toEqual(INITIAL_VIEW)
  })

  it('innholdet følger fingeren: dra til høyre viser mer til venstre', () => {
    const zoomed = { aspect: 'original' as const, zoom: 2, cx: 0.5, cy: 0.5 }
    // Utsnittet er 960 px bredt og vises 480 px bredt: 1 skjermpiksel = 2 videopiksler.
    const moved = panView(zoomed, 100, 0, 480, W, H)
    expect(cropRect(moved, W, H).x).toBe(480 - 200)
  })

  it('zoom med et fast punkt holder det stedet i videoen under fingeren', () => {
    const start = { ...INITIAL_VIEW, aspect: '1:1' as const }
    const before = cropRect(start, W, H)
    const u = 0.25
    const v = 0.75
    const point = { x: before.x + u * before.w, y: before.y + v * before.h }
    const after = cropRect(zoomView(start, 2, u, v, W, H), W, H)
    expect(after.x + u * after.w).toBeCloseTo(point.x)
    expect(after.y + v * after.h).toBeCloseTo(point.y)
    expect(after.w).toBe(540)
  })

  it('ny form beholder zoom, men holder utsnittet inne', () => {
    const v = withAspect({ aspect: 'original', zoom: 1.5, cx: 0.9, cy: 0.5 }, '4:5', W, H)
    const r = cropRect(v, W, H)
    expect(v.zoom).toBe(1.5)
    expect(r.w / r.h).toBeCloseTo(4 / 5)
    expect(r.x + r.w).toBeLessThanOrEqual(W)
  })
})

describe('størrelsen på GIF-en', () => {
  it('lengste side blir høyst størrelsen, og et lite utsnitt forstørres aldri', () => {
    expect(outputSize({ w: 1920, h: 1080 }, 480)).toEqual({ width: 480, height: 270 })
    expect(outputSize({ w: 1080, h: 1920 }, 480)).toEqual({ width: 270, height: 480 })
    expect(outputSize({ w: 300, h: 200 }, 640)).toEqual({ width: 300, height: 200 })
  })

  it('går ned ett trinn om gangen', () => {
    expect(smallerSize('large')).toBe('medium')
    expect(smallerSize('medium')).toBe('small')
    expect(smallerSize('small')).toBeNull()
  })
})

describe('klippet', () => {
  const whole = trackWindow(0, 20)

  it('starter med de første fire sekundene, eller hele en kort video', () => {
    expect(initialTrim(20, '1')).toEqual({ start: 0, end: 4 })
    expect(initialTrim(2.5, '1')).toEqual({ start: 0, end: 2.5 })
  })

  it('lengste klipp følger farten', () => {
    expect(maxClipSeconds('1')).toBe(MAX_GIF_SECONDS)
    expect(maxClipSeconds('0.5')).toBe(MAX_GIF_SECONDS / 2)
    expect(maxClipSeconds('2')).toBe(MAX_GIF_SECONDS * 2)
  })

  it('den andre kanten følger med når klippet ellers blir for langt eller for kort', () => {
    const trim = { start: 2, end: 5 }
    expect(moveTrimEdge(trim, 'end', 14, whole, 8)).toEqual({ start: 6, end: 14 })
    expect(moveTrimEdge(trim, 'start', 4.9, whole, 8)).toEqual({ start: 4.9, end: 5.2 })
    expect(moveTrimEdge(trim, 'start', -3, whole, 8)).toEqual({ start: 0, end: 5 })
    expect(moveTrimEdge(trim, 'end', 99, whole, 8)).toEqual({ start: 12, end: 20 })
    const short = moveTrimEdge(trim, 'end', 1, whole, 8)
    expect(short.end - short.start).toBeCloseTo(MIN_CLIP_SECONDS)
  })

  it('hele klippet flyttes uten å endre lengde, og blir innenfor', () => {
    expect(shiftTrim({ start: 2, end: 5 }, 3, whole)).toEqual({ start: 5, end: 8 })
    expect(shiftTrim({ start: 2, end: 5 }, 30, whole)).toEqual({ start: 17, end: 20 })
    expect(shiftTrim({ start: 2, end: 5 }, -30, whole)).toEqual({ start: 0, end: 3 })
  })

  it('kortes ned når farten gjør lengste klipp kortere', () => {
    expect(fitTrim({ start: 1, end: 9 }, whole, maxClipSeconds('0.5'))).toEqual({ start: 1, end: 5 })
  })

  it('en video kortere enn korteste klipp kan likevel brukes', () => {
    const tiny = trackWindow(0, 0.2)
    expect(fitTrim({ start: 0, end: 0.2 }, tiny, 8)).toEqual({ start: 0, end: 0.2 })
    expect(moveTrimEdge({ start: 0, end: 0.2 }, 'start', 0.1, tiny, 8)).toEqual({ start: 0, end: 0.2 })
  })

  it('en lang video vises som et vindu, og klippet holdes inne i det', () => {
    expect(trackWindow(0, 12)).toEqual({ from: 0, to: 12 })
    expect(trackWindow(50, 65)).toEqual({ from: 65 - TRACK_SPAN_SECONDS, to: 65 })
    const win = trackWindow(30, 120)
    expect(fitTrim({ start: 2, end: 6 }, win, 8)).toEqual({ start: 30, end: 34 })
  })
})

describe('bildene og loopen', () => {
  it('jevnt fordelt over klippet, ~14 i sekundet ved vanlig fart', () => {
    const times = frameTimes({ start: 1, end: 2.4 }, '1')
    expect(times).toHaveLength(20)
    expect(times[0]).toBe(1)
    expect(times[19]).toBeCloseTo(2.33)
    // Dobbel fart: halvparten så mange bilder av samme klipp.
    expect(frameTimes({ start: 1, end: 2.4 }, '2')).toHaveLength(10)
    expect(frameTimes({ start: 1, end: 2.4 }, '0.5')).toHaveLength(40)
    expect(frameTimes({ start: 0, end: 0.01 }, '1')).toHaveLength(2)
  })

  it('frem og tilbake gjentar ikke endene', () => {
    expect(frameOrder(4, 'forward')).toEqual([0, 1, 2, 3])
    expect(frameOrder(4, 'reverse')).toEqual([3, 2, 1, 0])
    expect(frameOrder(4, 'pingpong')).toEqual([0, 1, 2, 3, 2, 1])
    expect(frameOrder(2, 'pingpong')).toEqual([0, 1])
  })
})

describe('visning', () => {
  it('tider med komma', () => {
    expect(formatClipTime(0)).toBe('0:00,0')
    expect(formatClipTime(4.24)).toBe('0:04,2')
    expect(formatClipTime(75.96)).toBe('1:16,0')
    expect(formatSeconds(2.84)).toBe('2,8 s')
  })

  it('kjenner igjen videoer, også uten type', () => {
    expect(isVideoFile({ type: 'video/quicktime', name: 'IMG_0001.MOV' })).toBe(true)
    expect(isVideoFile({ type: 'image/gif', name: 'x.gif' })).toBe(false)
    expect(isVideoFile({ type: '', name: 'IMG_0001.MOV' })).toBe(true)
    expect(isVideoFile({ type: '', name: 'bilde.jpg' })).toBe(false)
  })
})
