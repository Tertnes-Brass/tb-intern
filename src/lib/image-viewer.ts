/**
 * Reglene i bildeviseren (`src/components/ImageViewer.tsx`): zoom, knip,
 * panorering og når et sveip blar eller lukker. Rene funksjoner, så
 * geometrien kan testes uten nettleser.
 *
 * Koordinatene er i CSS-piksler med origo i MIDTEN av visningsflaten, og
 * bildet står sentrert der med `transform-origin: 50% 50%`. Et punkt `p` på
 * bildet (uskalert, relativt til midten) havner da på skjermen i `s·p + t`,
 * der `s` er skalaen og `t = (x, y)` forskyvningen.
 */

export type Zoom = { s: number; x: number; y: number }
export type Size = { w: number; h: number }
export type Point = { x: number; y: number }

export const NO_ZOOM: Zoom = { s: 1, x: 0, y: 0 }
export const MAX_SCALE = 4
export const DOUBLE_TAP_SCALE = 2.5
/** Under knipingen kan bildet krympes litt under 1, og spretter tilbake etterpå. */
export const MIN_PINCH_SCALE = 0.6

export function isZoomed(z: Zoom): boolean {
  return z.s > 1.01
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Holder bildet innenfor flaten: er det bredere (høyere) enn flaten, kan det
 * ikke dras så langt at en kant slipper inn; er det smalere, står det midt i.
 * `content` er bildets visningsstørrelse ved skala 1.
 */
export function clampZoom(z: Zoom, content: Size, box: Size): Zoom {
  const s = clamp(z.s, 1, MAX_SCALE)
  const maxX = Math.max(0, (content.w * s - box.w) / 2)
  const maxY = Math.max(0, (content.h * s - box.h) / 2)
  return { s, x: clamp(z.x, -maxX, maxX) || 0, y: clamp(z.y, -maxY, maxY) || 0 }
}

/** Ny skala med punktet `at` (på skjermen) stående stille under fingeren. */
export function zoomAround(z: Zoom, at: Point, scale: number): Zoom {
  const s = clamp(scale, MIN_PINCH_SCALE, MAX_SCALE)
  const cx = (at.x - z.x) / z.s
  const cy = (at.y - z.y) / z.s
  return { s, x: at.x - s * cx, y: at.y - s * cy }
}

/**
 * Knip: punktet som var under fingrenes midtpunkt da knipingen startet
 * (`from`), følger midtpunktet dit det er nå (`to`), og skalaen følger
 * avstanden mellom fingrene. Midtpunktet kan altså også panorere.
 */
export function pinch(start: Zoom, from: Point, to: Point, ratio: number): Zoom {
  const s = clamp(start.s * ratio, MIN_PINCH_SCALE, MAX_SCALE)
  const cx = (from.x - start.x) / start.s
  const cy = (from.y - start.y) / start.s
  return { s, x: to.x - s * cx, y: to.y - s * cy }
}

/** Dobbelttrykk: zoom inn der man trykket, eller helt ut igjen. */
export function toggleZoom(z: Zoom, at: Point, content: Size, box: Size): Zoom {
  if (isZoomed(z)) return NO_ZOOM
  return clampZoom(zoomAround(z, at, DOUBLE_TAP_SCALE), content, box)
}

/** Etter en kniping: tilbake til 1 hvis den endte nær (eller under) det, ellers innenfor kantene. */
export function settleZoom(z: Zoom, content: Size, box: Size): Zoom {
  if (z.s < 1.05) return NO_ZOOM
  return clampZoom(z, content, box)
}

/** Avstanden fingeren må flytte seg før vi bestemmer om det er et sveip, et drag ned eller et trykk. */
export const DRAG_SLOP = 8

export type DragAxis = 'x' | 'y'

export function dragAxis(dx: number, dy: number): DragAxis | null {
  if (Math.hypot(dx, dy) < DRAG_SLOP) return null
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
}

/**
 * Hvor langt flaten følger fingeren sidelengs. Ved første og siste bilde er
 * det ingenting å bla til, så den gir etter — men tydelig tregere.
 */
export function swipeOffset(dx: number, index: number, count: number): number {
  const atEdge = (dx > 0 && index === 0) || (dx < 0 && index === count - 1)
  return atEdge ? dx * 0.3 : dx
}

/**
 * Bildet man lander på når et sveip slippes: et neste/forrige når det er dratt
 * en femtedel av bredden, eller kort og raskt (`ms` er varigheten).
 */
export function swipeTarget(dx: number, ms: number, width: number, index: number, count: number): number {
  const velocity = dx / Math.max(1, ms)
  const far = Math.abs(dx) > width * 0.2
  const flick = Math.abs(dx) > 30 && Math.abs(velocity) > 0.4
  if (!far && !flick) return index
  return clamp(index + (dx < 0 ? 1 : -1), 0, count - 1)
}

/** Dra opp eller ned for å lukke — langt nok, eller raskt nok. */
export function shouldDismiss(dy: number, ms: number): boolean {
  const velocity = Math.abs(dy) / Math.max(1, ms)
  return Math.abs(dy) > 110 || (Math.abs(dy) > 40 && velocity > 0.5)
}

/** Hvor mørk bakgrunnen er mens bildet dras bort (1 = helt). */
export function dismissDim(dy: number): number {
  return 1 - Math.min(1, Math.abs(dy) / 360) * 0.75
}

/** Et dobbelttrykk: to trykk tett i tid og sted. */
export const DOUBLE_TAP_MS = 300
export const DOUBLE_TAP_DISTANCE = 40

export function isDoubleTap(previous: { t: number; x: number; y: number } | null, next: { t: number; x: number; y: number }): boolean {
  if (!previous) return false
  return next.t - previous.t < DOUBLE_TAP_MS && Math.hypot(next.x - previous.x, next.y - previous.y) < DOUBLE_TAP_DISTANCE
}

/** «2 av 5» — telleren øverst og navnet skjermleseren hører. */
export function viewerCounter(index: number, count: number): string {
  return `${index + 1} av ${count}`
}
